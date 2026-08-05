import {
    SystemMessage,
    HumanMessage,
    AIMessage,
    ToolMessage,
    type BaseMessage,
} from '@langchain/core/messages';
import { getChatModel } from '#modules/ai/helpers/llm.js';
import type { POI } from '#modules/places/types.js';
import type { Weather } from '#modules/weather/types.js';
import { CITY_DISPLAY_NAMES } from '#modules/places/types.js';
import type { AgentStateType } from '../state.js';
import type { ElicitSpec, URLElicitSpec } from '../types.js';
import {
    makeSearchPoisTool,
    makeGetPoiDetailsTool,
    makeGetWeatherTool,
    makeUpdateItineraryTool,
    makeSaveTripToCalendarTool,
} from '../tools.js';

// ----- System prompt -----------------------------------------------------------

const SYSTEM_PROMPT = (today: string, state: AgentStateType) => {
    const lines = [
        `You are a friendly travel-planning agent for a 33-city catalogue (India, East/SE Asia, Europe, MENA, Americas, Oceania). Today's date is ${today}.`,
        '',
        'You have these tools:',
        '- **searchPois** — DISCOVERY. Find places to visit in a city, ranked by interest. Use when the user is browsing/planning broadly ("plan a trip", "what is there to do in X").',
        '- **getPoiDetails** — LOOKUP. Find a SPECIFIC named place in a city and get its real `id`. Use BEFORE updateItinerary whenever the user names places to add — you need real ids, not names or numbers.',
        '- **getWeather** — climate data for a city + optional travel dates. Use for trip prep, packing questions, or to add weather context to planning.',
        '- **updateItinerary** — replace the user\'s picked-places set. Pass `pickedPois` as `[{poiId, name}]` using REAL ids from getPoiDetails (or from a prior searchPois result in the conversation). NEVER pass list indices like "1", "2" as ids — they are not real ids.',
        `- **saveTripToCalendar** — save the user's current trip to their Google Calendar. Pass \`tripId\` (use "${state.tripId}" for the current planning slot, or a seeded id like "seed-ashwin-bangalore" for past trips). ALSO pass \`destination\`, \`startDate\`, \`endDate\` as args WHENEVER the user mentioned them in this turn (e.g. via a chip-card submission or a sentence like "I'll travel from June 1 to June 5"). The tool prefers your args over the persisted trip — they may not yet be saved to Redis. If the tool returns \`needsAuth: true\`, do NOT call it again — compose a brief message asking the user to complete the sign-in prompt. If it returns \`error: "No travel dates..."\`, ask the user for dates instead of re-calling blindly.`,
        '',
        'Decision rules:',
        '1. If the user needs places but you don\'t know the destination, do NOT call any tool — just ask them where they want to go in your response.',
        '2. If you have a destination AND the user is browsing/discovering, call searchPois with their interests.',
        '3. For trip-planning intent (concrete travel dates implied), call searchPois AND getWeather in parallel — emit both tool calls in one turn.',
        '4. For research questions ("what is there to do in X"), call only searchPois.',
        '5. For weather/packing questions, call only getWeather.',
        '6. When the user NAMES specific places to add/swap/remove (e.g. "Set my picked places to: Spice Terrace, Olive Beach"): FIRST call getPoiDetails ONCE per place the USER NAMED (parallel is fine) to resolve each into a real `id`. THEN call updateItinerary with EXACTLY those ids — pass the full new picked set the user named, nothing more. DO NOT add other places from the conversation history that the user did NOT name in the current message. DO NOT look up places the user did not name.',
        '7. When the user asks to save their trip to Google Calendar: call saveTripToCalendar with `tripId` PLUS any destination/dates the user mentioned in this turn (don\'t omit them just because they "should already be saved"). Pass them as `destination`, `startDate`, `endDate` args. If it returns `needsAuth: true`, do NOT call any more tools — short reply: "I need your Google sign-in to save the trip, please complete the prompt." If it returns `saved: true`, confirm with the event link. If it returns an error about missing data, ask the user for that data — don\'t blindly re-call the tool with the same args.',
        '8. For small talk or thanks, do not call any tool.',
        '9. After tool results come back, compose a friendly, conversational reply summarizing what you found or did.',
        '',
        'Use prior conversation context (above) to fill in slots the user mentioned earlier — do not re-ask for information already in the chat.',
    ];

    // Current trip context — helps the LLM make decisions without re-eliciting
    const ctx: string[] = [];
    if (state.destination) {
        ctx.push(`destination=${CITY_DISPLAY_NAMES[state.destination] ?? state.destination}`);
    }
    if (state.dates) ctx.push(`dates=${state.dates.start} to ${state.dates.end}`);
    if (state.interests.length) ctx.push(`interests=[${state.interests.join(', ')}]`);
    if (state.pickedPois.length) {
        ctx.push(`currently picked=[${state.pickedPois.map((poi) => poi.name).join(', ')}]`);
    }
    if (ctx.length) {
        lines.push('', `Trip context carried from earlier turns: ${ctx.join(', ')}.`);
    }

    // User preferences (from AMS long-term memory)
    const prefs = state.preferences;
    if (prefs) {
        const prefBits: string[] = [];
        if (prefs.groupSize) prefBits.push(`groupSize=${prefs.groupSize}`);
        if (prefs.budget) prefBits.push(`budget=${prefs.budget}`);
        if (prefs.recurringInterests?.length) {
            prefBits.push(`recurringInterests=[${prefs.recurringInterests.join(', ')}]`);
        }
        if (prefBits.length) {
            lines.push(`User preferences (from memory): ${prefBits.join(', ')}.`);
        }
    }

    if (state.pois.length) {
        lines.push(
            '',
            'Candidate places visible to the UI right now (you may reference these in your reply):',
            ...state.pois.slice(0, 12).map((poi) => `  - ${poi.id}: ${poi.name}`),
        );
    }

    return lines.join('\n');
};

// ----- ReAct loop helpers ------------------------------------------------------

const MAX_ITERATIONS = 5;

function extractText(content: AIMessage['content']): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map((block) => {
            if (typeof block === 'string') return block;
            if (block && typeof block === 'object' && 'text' in block) {
                return (block as { text: string }).text;
            }
            return '';
        })
        .join('');
}

// ----- The node -----------------------------------------------------------------

export async function travelAgent(state: AgentStateType): Promise<Partial<AgentStateType>> {
    console.log(
        `\n🧭 [travel-agent] turn — tripId=${state.tripId} user=${state.userId} msg="${state.userMessage.slice(0, 80)}"`,
    );
    console.log(
        `[travel-agent] context — prior messages=${state.conversationHistory.length} preferences=${state.preferences ? 'yes' : 'none'} destination=${state.destination ?? '—'}`,
    );

    // Outputs collected via tool onApplied callbacks. Pre-seeded with current
    // state so a turn that doesn't re-fetch keeps prior values (e.g. user says
    // "add Cubbon Park" — we keep the existing pois + weather as-is for the UI).
    let collectedPois: POI[] = state.pois;
    let collectedWeather: Weather | undefined = state.weather;
    let collectedPicks: POI[] = state.pickedPois;
    // saveTripToCalendar's tool body calls onElicitNeeded when there's no
    // cached Google token, capturing the URL-mode elicit spec here so we
    // can attach it to the returned state delta.
    let capturedUrlElicit: URLElicitSpec | undefined;

    const tools = [
        makeSearchPoisTool((pois) => {
            collectedPois = pois;
        }),
        makeGetPoiDetailsTool(),
        makeGetWeatherTool((weather) => {
            collectedWeather = weather;
        }),
        makeUpdateItineraryTool(state, (picks) => {
            collectedPicks = picks;
        }),
        makeSaveTripToCalendarTool(state.userId, (elicit) => {
            capturedUrlElicit = elicit;
        }),
    ];

    // Erase the per-tool schema types — at the LLM dispatch boundary the
    // args are runtime-validated by each tool's own Zod schema, so we don't
    // need TS to track which tool takes which args at this layer.
    type InvokableTool = { name: string; invoke: (args: unknown) => Promise<unknown> };
    const toolByName: Map<string, InvokableTool> = new Map(
        tools.map((tool) => [tool.name, tool as unknown as InvokableTool]),
    );
    const today = new Date().toISOString().split('T')[0];

    const priorMessages: BaseMessage[] = state.conversationHistory.map((message) =>
        message.role === 'user'
            ? new HumanMessage(message.content)
            : new AIMessage(message.content),
    );

    const messages: BaseMessage[] = [
        new SystemMessage(SYSTEM_PROMPT(today, state)),
        ...priorMessages,
        new HumanMessage(state.userMessage),
    ];

    const llmWithTools = getChatModel().bindTools(tools);

    // Local record of which tools the LLM picked this turn — used at the end
    // to decide which fields to include in the returned state patch (only emit
    // pois/weather/picks if the corresponding tool actually fired).
    const recordedToolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let finalResponse = '';

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const response = await llmWithTools.invoke(messages);
        messages.push(response);

        const toolCalls = response.tool_calls ?? [];
        if (!toolCalls.length) {
            finalResponse = extractText(response.content);
            console.log(
                `[travel-agent] iter ${iteration} — done; response="${finalResponse.slice(0, 100)}${finalResponse.length > 100 ? '…' : ''}"`,
            );
            break;
        }

        console.log(
            `[travel-agent] iter ${iteration} — tool calls: ${toolCalls.map((toolCall) => toolCall.name).join(', ')}`,
        );

        // Run all tool calls in parallel; collect results in deterministic order.
        const toolMessages = await Promise.all(
            toolCalls.map(async (toolCall) => {
                recordedToolCalls.push({
                    name: toolCall.name,
                    args: toolCall.args as Record<string, unknown>,
                });
                const callId = toolCall.id ?? `${toolCall.name}-${Date.now()}`;
                const tool = toolByName.get(toolCall.name);
                if (!tool) {
                    return new ToolMessage({
                        tool_call_id: callId,
                        content: `Tool ${toolCall.name} not found.`,
                    });
                }
                try {
                    const result = await tool.invoke(toolCall.args);
                    return new ToolMessage({
                        tool_call_id: callId,
                        content: typeof result === 'string' ? result : JSON.stringify(result),
                    });
                } catch (err) {
                    console.warn(
                        `[travel-agent] tool ${toolCall.name} threw:`,
                        (err as Error).message,
                    );
                    return new ToolMessage({
                        tool_call_id: callId,
                        content: `Tool error: ${(err as Error).message}`,
                    });
                }
            }),
        );

        messages.push(...toolMessages);
    }

    if (!finalResponse) {
        console.warn(
            `[travel-agent] ReAct loop exited without final response (max ${MAX_ITERATIONS} iterations).`,
        );
        finalResponse = 'I ran into a snag answering that — could you try rephrasing?';
    }

    // Only emit fields that were actually produced by this turn's tool calls.
    // Omitting a field keeps the client's local value (the React store doesn't
    // wipe state when a STATE_SNAPSHOT chunk lacks a key). Critical because the
    // client doesn't send `pois` back on follow-up requests — if we emit
    // pois: [] on a turn that didn't search, the POI grid clears.
    const searchedThisTurn = recordedToolCalls.some(
        (toolCall) => toolCall.name === 'searchPois',
    );
    const weatherFetchedThisTurn = recordedToolCalls.some(
        (toolCall) => toolCall.name === 'getWeather',
    );
    const itineraryUpdatedThisTurn = recordedToolCalls.some(
        (toolCall) => toolCall.name === 'updateItinerary',
    );

    const patch: Partial<AgentStateType> = {
        response: finalResponse,
    };
    if (searchedThisTurn) patch.pois = collectedPois;
    if (weatherFetchedThisTurn) patch.weather = collectedWeather;
    if (itineraryUpdatedThisTurn) patch.pickedPois = collectedPicks;
    // URL-mode elicit emitted by saveTripToCalendar — FollowUp will preserve
    // this and not override with a rule-based form elicit (it checks for an
    // existing url-mode elicit on state).
    if (capturedUrlElicit) patch.elicit = capturedUrlElicit as ElicitSpec;
    return patch;
}
