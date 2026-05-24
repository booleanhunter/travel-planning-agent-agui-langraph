import { z } from 'zod';
import {
    SystemMessage,
    HumanMessage,
    AIMessage,
    ToolMessage,
    type BaseMessage,
} from '@langchain/core/messages';
import { getChatModel } from '../../helpers/llm.js';
import { appendTurn, getConversation } from '../../../user/domain/user-service.js';
import type { AgentStateType } from '../state.js';
import type { ElicitPrimitiveSchema, ElicitSpec, POI } from '../../../../types.js';
import { makeUpdateItineraryTool } from '../tools.js';

// ----- Structured output for the final response --------------------------------------

const FollowUpOutput = z.object({
    textResponse: z
        .string()
        .describe(
            "The final resolution for the user. Build on the agent's most recent reply; reference what's known so far (destination, dates, places, weather).",
        ),
    suggestedActions: z
        .array(z.string())
        .describe(
            "Short follow-up chips the USER might tap to send as their next message — written in the user's first-person voice. " +
                'Each chip should read like something the user would naturally type or click. ' +
                'Good examples: "What should I pack?", "Make it more relaxed", "Save this trip", "Show me only cultural spots", "Plan a 3-day itinerary". ' +
                'Bad examples (do NOT use these patterns): "Share your interests", "Request places", "Pick a destination", "Get packing tips" — these are imperatives directed at the user, not user-voiced prompts. ' +
                'Return an empty array if no natural next step exists.',
        ),
});

// ----- System prompts -----------------------------------------------------------------

function buildSystemPrompt(state: AgentStateType): string {
    const candidateList = state.pois.length
        ? state.pois.map((p) => `  - ${p.id}: ${p.name}`).join('\n')
        : '  (none yet)';
    const pickedList = state.pickedPois.length
        ? state.pickedPois.map((p) => `  - ${p.id}: ${p.name}`).join('\n')
        : '  (none picked yet)';
    return [
        'You are a senior travel supervisor reviewing the chat history above.',
        'Provide a final resolution based on everything discussed so far.',
        "Build on the agent's most recent reply — do not repeat or contradict it,",
        'and do not ask for information already answered or visible in the conversation.',
        '',
        "`suggestedActions` should be written in the user's first-person voice — what they might tap to send next, not instructions to the user.",
        '',
        'Tool use rule for `updateItinerary`:',
        "Call it ONLY when the user's message NAMES specific places to add, remove, swap, or clear.",
        'Examples that SHOULD trigger a call: "add Cubbon Park", "remove MTR", "swap Koshy\'s for Karavalli".',
        'Examples that MUST NOT trigger a call: "plan a trip", "show me places", "suggest options", "what should I see", small talk, thanks.',
        'When called, pass the COMPLETE new picked set (replace semantics) using only poiIds from the candidate list below.',
        'Otherwise do not call the tool.',
        '',
        'Trip context so far:',
        `- Destination: ${state.destination ?? 'not chosen'}`,
        `- Dates: ${state.dates ? `${state.dates.start} → ${state.dates.end}` : 'not picked'}`,
        `- Interests: ${state.interests.length ? state.interests.join(', ') : 'none stated'}`,
        `- Weather: ${state.weather ? `${state.weather.condition} (${state.weather.high}°/${state.weather.low}°C)` : 'not looked up'}`,
        '',
        'Candidate places this turn:',
        candidateList,
        '',
        'Currently picked places:',
        pickedList,
    ].join('\n');
}

// ----- Elicit logic (mechanical, intent-aware) ----------------------------------------

const INTEREST_OPTIONS = [
    { value: 'food', label: 'Food & restaurants' },
    { value: 'landmarks', label: 'Famous landmarks' },
    { value: 'offbeat', label: 'Off the beaten path' },
    { value: 'slow', label: 'Slow & easygoing' },
    { value: 'outdoors', label: 'Outdoors & nature' },
    { value: 'nightlife', label: 'Nightlife & social' },
    { value: 'culture', label: 'Arts & culture' },
];

function requiredSlots(
    intent: AgentStateType['intent'],
): Array<'destination' | 'dates' | 'interests'> {
    switch (intent) {
        case 'researching':
            return ['destination'];
        case 'tripPreparation':
            return ['destination', 'dates'];
        case 'itineraryPlanning':
            return ['destination', 'dates', 'interests'];
        case 'general':
            return [];
    }
}

function buildElicit(state: AgentStateType): ElicitSpec | undefined {
    const needed = requiredSlots(state.intent);
    const properties: Record<string, ElicitPrimitiveSchema> = {};
    const required: string[] = [];

    if (needed.includes('destination') && !state.destination) {
        properties.destination = {
            type: 'string',
            title: 'Where to?',
            oneOf: [
                { const: 'bangalore', title: 'Bangalore' },
                { const: 'mumbai', title: 'Mumbai' },
                { const: 'barcelona', title: 'Barcelona' },
            ],
        };
        required.push('destination');
    }
    if (needed.includes('dates') && !state.dates) {
        // MCP forbids nested objects in requestedSchema, so date range is two flat fields.
        properties.startDate = {
            type: 'string',
            title: 'Start date',
            format: 'date',
            description: "Specific dates let me factor in weather. Skip if you're flexible.",
        };
        properties.endDate = {
            type: 'string',
            title: 'End date',
            format: 'date',
        };
    }
    if (needed.includes('interests') && !state.interests.length) {
        const memInterests = state.preferences?.recurringInterests ?? [];
        properties.interests = {
            type: 'array',
            title: 'What are you in the mood for?',
            items: {
                anyOf: INTEREST_OPTIONS.map((o) => ({ const: o.value, title: o.label })),
            },
            ...(memInterests.length > 0 ? { default: memInterests } : {}),
        };
    }
    if (!Object.keys(properties).length) return undefined;
    return {
        message: 'A few quick details so I can plan your day:',
        requestedSchema: {
            type: 'object',
            properties,
            ...(required.length ? { required } : {}),
        },
    };
}

// ----- The node -----------------------------------------------------------------------

export async function followUp(state: AgentStateType): Promise<Partial<AgentStateType>> {
    console.log(
        `\n💬 [follow-up] entry — intent=${state.intent} destination=${state.destination ?? '—'} pois=${state.pois.length} weather=${state.weather ? 'yes' : 'no'} ack=${state.response ? 'yes' : 'no'} picked=${state.pickedPois.length}`,
    );

    const elicit = buildElicit(state);
    console.log(
        `[follow-up] elicit — ${elicit ? `fields=[${Object.keys(elicit.requestedSchema.properties).join(',')}]` : 'none'}`,
    );

    // Load prior conversation from AMS so the supervisor sees the full chat history.
    const conv = await getConversation(state.sessionId).catch(() => null);
    const priorMessages: BaseMessage[] = (conv?.messages ?? []).map((m) =>
        m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    );
    console.log(`[follow-up] AMS — prior messages=${priorMessages.length}`);

    const messages: BaseMessage[] = [
        new SystemMessage(buildSystemPrompt(state)),
        ...priorMessages,
        new HumanMessage(state.userMessage),
    ];
    if (state.response) {
        messages.push(new AIMessage(state.response)); // TravelAgent's reply this turn
    }

    // ----- Pass 1: bind the tool, run the LLM, let the tool do its work -----
    let appliedPicks: POI[] | undefined;
    const updateItineraryTool = makeUpdateItineraryTool(state, (picks) => {
        appliedPicks = picks;
    });

    const toolModel = getChatModel().bindTools([updateItineraryTool]);
    const toolResponse = await toolModel.invoke(messages);

    const toolCalls = toolResponse.tool_calls ?? [];
    const toolMessages: ToolMessage[] = [];
    for (const tc of toolCalls) {
        if (tc.name !== 'updateItinerary') continue;
        const result = await updateItineraryTool.invoke(tc);
        toolMessages.push(
            new ToolMessage({
                tool_call_id: tc.id ?? `${tc.name}-${Date.now()}`,
                content: typeof result === 'string' ? result : JSON.stringify(result),
            }),
        );
    }

    // ----- Pass 2: structured response -----
    const messagesForFinal: BaseMessage[] = toolMessages.length
        ? [...messages, toolResponse, ...toolMessages]
        : messages;

    const structuredModel = getChatModel().withStructuredOutput(FollowUpOutput, {
        name: 'follow_up',
    });
    const out = await structuredModel.invoke(messagesForFinal);
    console.log(`[follow-up] LLM — suggestedActions=[${out.suggestedActions.join(',')}]`);
    console.log(
        `[follow-up] reply: "${out.textResponse.slice(0, 120)}${out.textResponse.length > 120 ? '…' : ''}"`,
    );

    // Persist this turn to AMS working memory (fire-and-forget).
    const turnMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        { role: 'user', content: state.userMessage },
    ];
    if (state.response) turnMessages.push({ role: 'assistant', content: state.response });
    turnMessages.push({ role: 'assistant', content: out.textResponse });

    appendTurn(state.sessionId, state.userId, turnMessages).catch((err) =>
        console.error('[appendTurn] failed:', (err as Error).message),
    );

    const patch: Partial<AgentStateType> = {
        suggestedActions: out.suggestedActions,
        elicit,
    };
    if (appliedPicks) patch.pickedPois = appliedPicks;
    return patch;
}
