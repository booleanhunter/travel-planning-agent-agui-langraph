import { z } from 'zod';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getChatModel } from '#modules/ai/helpers/llm.js';
import { appendTurn } from '#modules/user/domain/user-service.js';
import { ensureDraft } from '#modules/trips/domain/trips-service.js';
import { CitySchema, CITY_DISPLAY_NAMES, type City } from '#modules/places/types.js';
import type { AgentStateType, ToolCallRecord } from '../state.js';
import type { ElicitPrimitiveSchema, ElicitSpec } from '../types.js';

// ----- Interest options (kept in sync with tools.ts INTEREST_VALUES) -----------------

const INTEREST_OPTIONS = [
    { value: 'food', label: 'Food & restaurants' },
    { value: 'landmarks', label: 'Famous landmarks' },
    { value: 'offbeat', label: 'Off the beaten path' },
    { value: 'slow', label: 'Slow & easygoing' },
    { value: 'outdoors', label: 'Outdoors & nature' },
    { value: 'nightlife', label: 'Nightlife & social' },
    { value: 'culture', label: 'Arts & culture' },
];

// ----- Slot derivation from tool-call args ------------------------------------------

interface DerivedSlots {
    destination?: City;
    dates?: { start: string; end: string };
    interests: string[];
}

function extractSlotsFromToolCalls(toolCalls: ToolCallRecord[], state: AgentStateType): DerivedSlots {
    // Start from current state, override with this turn's tool-call args.
    const slots: DerivedSlots = {
        destination: state.destination,
        dates: state.dates,
        interests: state.interests,
    };

    for (const toolCall of toolCalls) {
        const args = toolCall.args ?? {};
        // Destination flows from any tool that takes a city arg —
        // searchPois (discovery), getPoiDetails (lookup), getWeather (climate).
        if (
            toolCall.name === 'searchPois' ||
            toolCall.name === 'getPoiDetails' ||
            toolCall.name === 'getWeather'
        ) {
            if (typeof args.city === 'string') slots.destination = args.city as City;
        }
        // Interests come only from searchPois (where the LLM passes the
        // canonical tag list).
        if (toolCall.name === 'searchPois') {
            if (Array.isArray(args.interests) && args.interests.length) {
                slots.interests = args.interests as string[];
            }
        }
        // Dates come only from getWeather (the only tool that takes them).
        if (toolCall.name === 'getWeather') {
            const startDate = typeof args.startDate === 'string' ? args.startDate : undefined;
            const endDate = typeof args.endDate === 'string' ? args.endDate : undefined;
            if (startDate && endDate) slots.dates = { start: startDate, end: endDate };
        }
    }

    return slots;
}

// ----- Rule-based elicit (no `intent` field; infer from which tools ran) ------------

function fieldsToElicit(
    toolCalls: ToolCallRecord[],
    slots: DerivedSlots,
    userMessage: string,
): Array<'destination' | 'dates' | 'interests'> {
    // Two tool categories drive the decision:
    //   - DISCOVERY (searchPois, getWeather): user is gathering info → may still
    //     be missing slots the elicit could fill.
    //   - ACTION (getPoiDetails, updateItinerary, saveTripToCalendar): user is
    //     past the info-gathering phase — they named places, committed picks,
    //     or saved the trip. Don't ask "Where to?" after that.
    const calledSearch = toolCalls.some((toolCall) => toolCall.name === 'searchPois');
    const calledWeather = toolCalls.some((toolCall) => toolCall.name === 'getWeather');
    const calledAction = toolCalls.some(
        (toolCall) =>
            toolCall.name === 'getPoiDetails' ||
            toolCall.name === 'updateItinerary' ||
            toolCall.name === 'saveTripToCalendar',
    );

    // Short-circuit: only action tools fired this turn → user is committing,
    // not exploring. No elicit, no matter what's missing from the slots.
    if (calledAction && !calledSearch && !calledWeather) {
        return [];
    }

    const missingDest = !slots.destination;
    const missingDates = !slots.dates;
    const missingInterests = !slots.interests.length;

    const fields: Array<'destination' | 'dates' | 'interests'> = [];

    // No tool calls at all + missing destination → user wants to plan but
    // hasn't said where. Treat as full planning intent and ask for everything.
    if (!calledSearch && !calledWeather && !calledAction && missingDest) {
        // Light heuristic: if the user used a planning verb, also ask for dates + interests.
        const planningVerbs = /\b(plan|trip|itinerary|visit|travel|go to|going to)\b/i;
        if (planningVerbs.test(userMessage)) {
            fields.push('destination');
            if (missingDates) fields.push('dates');
            if (missingInterests) fields.push('interests');
        } else {
            fields.push('destination');
        }
        return fields;
    }

    // Discovery tool calls happened → narrow elicit to what those tools imply.
    if (calledSearch && calledWeather) {
        // Likely full planning — ask for anything still missing.
        if (missingDest) fields.push('destination');
        if (missingDates) fields.push('dates');
        if (missingInterests) fields.push('interests');
    } else if (calledSearch) {
        // Researching — only destination + interests matter.
        if (missingDest) fields.push('destination');
        if (missingInterests) fields.push('interests');
    } else if (calledWeather) {
        // Trip prep — destination + dates.
        if (missingDest) fields.push('destination');
        if (missingDates) fields.push('dates');
    }
    return fields;
}

function buildElicit(
    fields: Array<'destination' | 'dates' | 'interests'>,
    preferences: AgentStateType['preferences'],
): ElicitSpec | undefined {
    if (!fields.length) return undefined;
    const properties: Record<string, ElicitPrimitiveSchema> = {};
    const required: string[] = [];

    if (fields.includes('destination')) {
        properties.destination = {
            type: 'string',
            title: 'Where to?',
            oneOf: CitySchema.options.map((id) => ({
                const: id,
                title: CITY_DISPLAY_NAMES[id],
            })),
        };
        required.push('destination');
    }
    if (fields.includes('dates')) {
        // MCP forbids nested objects in requestedSchema — flat fields.
        properties.startDate = {
            type: 'string',
            title: 'Start date',
            format: 'date',
            description: "Specific dates, for factoring in weather. Skip if you're flexible.",
        };
        properties.endDate = {
            type: 'string',
            title: 'End date',
            format: 'date',
        };
    }
    if (fields.includes('interests')) {
        const memInterests = preferences?.recurringInterests ?? [];
        properties.interests = {
            type: 'array',
            title: 'What are you in the mood for?',
            items: {
                anyOf: INTEREST_OPTIONS.map((option) => ({
                    const: option.value,
                    title: option.label,
                })),
            },
            ...(memInterests.length > 0 ? { default: memInterests } : {}),
        };
    }
    return {
        mode: 'form',
        message: 'A few quick details so I can plan your day:',
        requestedSchema: {
            type: 'object',
            properties,
            ...(required.length ? { required } : {}),
        },
    };
}

// ----- Small LLM call for suggestedActions ------------------------------------------

const SuggestionsOutput = z.object({
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

function buildSuggestionsPrompt(
    slots: DerivedSlots,
    state: AgentStateType,
    response: string,
): string {
    const ctx: string[] = [];
    if (slots.destination)
        ctx.push(`Destination: ${CITY_DISPLAY_NAMES[slots.destination] ?? slots.destination}`);
    if (slots.dates) ctx.push(`Dates: ${slots.dates.start} → ${slots.dates.end}`);
    if (slots.interests.length) ctx.push(`Interests: ${slots.interests.join(', ')}`);
    if (state.weather)
        ctx.push(
            `Weather: ${state.weather.condition} (${state.weather.high}°/${state.weather.low}°C)`,
        );
    ctx.push(`Candidates this turn: ${state.pois.length}`);
    ctx.push(`Currently picked: ${state.pickedPois.length}`);

    return [
        'Generate 2-4 short follow-up chips a user might tap next.',
        'Write them in the user\'s first-person voice — what THEY would type or click.',
        'Build on the agent reply just shown — do not contradict it or repeat info already given.',
        'Return an empty array if no natural follow-up exists.',
        '',
        'Trip context:',
        ...ctx.map((line) => `  - ${line}`),
        '',
        `Agent reply: ${response || '(no reply)'}`,
    ].join('\n');
}

// ----- The node ----------------------------------------------------------------------

export async function followUp(state: AgentStateType): Promise<Partial<AgentStateType>> {
    console.log(
        `\n💬 [follow-up] entry — toolCalls=${state.toolCalls.length} destination=${state.destination ?? '—'} pois=${state.pois.length} weather=${state.weather ? 'yes' : 'no'} picked=${state.pickedPois.length}`,
    );

    // 1. Extract slots from TravelAgent's tool-call args.
    const slots = extractSlotsFromToolCalls(state.toolCalls, state);
    console.log(
        `[follow-up] slots — destination=${slots.destination ?? '—'} dates=${slots.dates ? `${slots.dates.start}→${slots.dates.end}` : '—'} interests=[${slots.interests.join(',')}]`,
    );

    // 2. Persist the working trip draft to Redis whenever we know the destination.
    //    Idempotent — safe to call every turn.
    if (slots.destination) {
        await ensureDraft(state.userId, state.sessionId, {
            city: slots.destination,
            startDate: slots.dates?.start,
            endDate: slots.dates?.end,
            interests: slots.interests,
        }).catch((err) =>
            console.error('[follow-up] ensureDraft failed:', (err as Error).message),
        );
    }

    // 3. Decide if we need to elicit anything from the user.
    //    If TravelAgent already set a URL-mode elicit (e.g. saveTripToCalendar
    //    needs OAuth), keep that and don't override with a rule-based form
    //    elicit. URL-mode takes priority because the user can't proceed
    //    without that out-of-band flow.
    let elicit: ElicitSpec | undefined = state.elicit;
    if (!elicit && !state.userDeclinedElicit) {
        const fieldsNeeded = fieldsToElicit(state.toolCalls, slots, state.userMessage);
        elicit = buildElicit(fieldsNeeded, state.preferences);
        if (elicit) {
            console.log(`[follow-up] elicit — fields=[${fieldsNeeded.join(',')}]`);
        }
    } else if (elicit?.mode === 'url') {
        console.log(`[follow-up] keeping URL-mode elicit set by TravelAgent`);
    }

    // 4. One small LLM call for suggestedActions (always — the chips help the
    //    user even when an elicit is also on screen).
    const suggestionsModel = getChatModel().withStructuredOutput(SuggestionsOutput, {
        name: 'suggested_actions',
    });
    const out = await suggestionsModel
        .invoke([
            new SystemMessage(buildSuggestionsPrompt(slots, state, state.response ?? '')),
            new HumanMessage(state.userMessage),
        ])
        .catch((err) => {
            console.warn('[follow-up] suggestions failed:', (err as Error).message);
            return { suggestedActions: [] as string[] };
        });
    console.log(`[follow-up] suggestedActions=[${out.suggestedActions.join(',')}]`);

    // 5. Persist this turn to AMS working memory (fire-and-forget).
    if (state.response) {
        appendTurn(state.sessionId, state.userId, [
            { role: 'user', content: state.userMessage },
            { role: 'assistant', content: state.response },
        ]).catch((err) => console.error('[follow-up] appendTurn failed:', (err as Error).message));
    }

    return {
        destination: slots.destination,
        dates: slots.dates,
        interests: slots.interests,
        suggestedActions: out.suggestedActions,
        elicit,
    };
}
