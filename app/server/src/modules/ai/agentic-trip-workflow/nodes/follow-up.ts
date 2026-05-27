/**
 * Last graph node — synthesize the turn.
 *
 * One LLM call (structured output) does four things in parallel:
 *   - Extract slot values from the full conversation (user message + agent
 *     reply this turn + prior history). Replaces the brittle tool-call-args
 *     inspection we had before.
 *   - Decide whether the user needs more info via a chip card (elicit).
 *   - List which fields the chip card should ask for.
 *   - Generate 2-4 user-voice followup suggestion chips.
 *
 * Then persist any new slot values to the Redis trip-store (`ensureDraft`)
 * and append this turn to AMS working memory. The persistence write is the
 * counterpart to `contextRetriever`'s read.
 */

import { z } from 'zod';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { getChatModel } from '#modules/ai/helpers/llm.js';
import { appendTurn } from '#modules/user/domain/user-service.js';
import { ensureDraft } from '#modules/trips/domain/trips-service.js';
import { CitySchema, CITY_DISPLAY_NAMES, type City } from '#modules/places/types.js';
import type { AgentStateType } from '../state.js';
import type { ElicitPrimitiveSchema, ElicitSpec } from '../types.js';

// ----- Interest options (kept in sync with tools.ts INTEREST_VALUES) ----------

const INTEREST_OPTIONS = [
    { value: 'food', label: 'Food & restaurants' },
    { value: 'landmarks', label: 'Famous landmarks' },
    { value: 'offbeat', label: 'Off the beaten path' },
    { value: 'slow', label: 'Slow & easygoing' },
    { value: 'outdoors', label: 'Outdoors & nature' },
    { value: 'nightlife', label: 'Nightlife & social' },
    { value: 'culture', label: 'Arts & culture' },
];

const INTEREST_VALUES = INTEREST_OPTIONS.map((option) => option.value) as [
    string,
    ...string[],
];

// ----- Structured output schema ----------------------------------------------

const FollowUpOutput = z.object({
    destination: CitySchema.nullable().describe(
        "Destination city for the trip. Extract from THIS turn's user message, the agent's reply, and prior conversation. Null only if truly unknown.",
    ),
    startDate: z
        .string()
        .nullable()
        .describe('Trip start date as ISO YYYY-MM-DD if known; null otherwise.'),
    endDate: z.string().nullable().describe('Trip end date as ISO YYYY-MM-DD if known; null otherwise.'),
    interests: z
        .array(z.enum(INTEREST_VALUES))
        .describe(
            'Interest tags from the canonical list. Read from the conversation; empty array if unknown.',
        ),
    needsMoreInfo: z
        .boolean()
        .describe(
            'True only if the user is trying to plan/research a trip and important slots are still missing. False if the user just completed an action (commit picks, save trip), asked a question that the agent already answered, or is making small talk.',
        ),
    missingFields: z
        .array(z.enum(['destination', 'dates', 'interests']))
        .describe(
            'Which fields to ask for via the chip card. Only populated when needsMoreInfo is true.',
        ),
    suggestedActions: z
        .array(z.string())
        .describe(
            "2-4 short user-voice followup chips (e.g. 'What should I pack?', 'Show me more food spots'). Written in first-person — what the user would tap. Empty array if no natural followup.",
        ),
});

// ----- Elicit construction (rule-based JSON Schema) --------------------------

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

// ----- System prompt ---------------------------------------------------------

function buildSystemPrompt(state: AgentStateType): string {
    const lines: string[] = [
        'You are the synthesis step after a travel agent has run for the current turn.',
        "Your job is to extract structured slot values from the full conversation, decide whether the agent should ask for more info via a chip card, and propose user-voice followup chips.",
        '',
        'Decision rules for needsMoreInfo:',
        '- TRUE when the user is trying to plan/research but key slots are unset and the agent has not already gathered them.',
        '- FALSE when the user just executed an action (named places to add, saved to calendar) or made small talk or asked a question the agent already answered.',
        '- FALSE if the agent\'s reply just answered a research question that did not need slot info.',
        '',
        'Slot extraction:',
        '- destination: one of 33 supported city ids (lowercase, hyphenated multi-word: e.g. "bangalore", "new-york"). Look in the user message, agent reply, and prior history.',
        '- dates: ISO YYYY-MM-DD start + end. Resolve relative phrases ("next month", "in October") against today.',
        '- interests: canonical tags from {food, landmarks, offbeat, slow, outdoors, nightlife, culture}.',
        '',
        'suggestedActions: 2-4 short first-person chips the USER might tap next ("Make it more relaxed", "What should I pack?", "Show me cultural spots"). Empty array if no natural followup.',
        '',
        `Today is ${new Date().toISOString().split('T')[0]}.`,
    ];

    // Carry-in context — what's already known from contextRetriever's hydration.
    const ctx: string[] = [];
    if (state.destination) ctx.push(`destination=${state.destination}`);
    if (state.dates) ctx.push(`dates=${state.dates.start} to ${state.dates.end}`);
    if (state.interests.length) ctx.push(`interests=[${state.interests.join(', ')}]`);
    if (state.pickedPois.length) ctx.push(`picked=${state.pickedPois.length} places`);
    if (state.preferences?.recurringInterests?.length) {
        ctx.push(`memory.recurringInterests=[${state.preferences.recurringInterests.join(', ')}]`);
    }
    if (ctx.length) {
        lines.push('', `Already-known context (carry forward unless this turn changed it): ${ctx.join('; ')}.`);
    }

    return lines.join('\n');
}

// ----- The node --------------------------------------------------------------

export async function followUp(state: AgentStateType): Promise<Partial<AgentStateType>> {
    console.log(
        `\n💬 [follow-up] entry — destination=${state.destination ?? '—'} pois=${state.pois.length} picked=${state.pickedPois.length} priorMessages=${state.conversationHistory.length}`,
    );

    // Build the conversation the LLM sees: history + this turn's user message
    // + the agent's reply (if any).
    const priorMessages = state.conversationHistory.map((message) =>
        message.role === 'user'
            ? new HumanMessage(message.content)
            : new AIMessage(message.content),
    );
    const messages = [
        new SystemMessage(buildSystemPrompt(state)),
        ...priorMessages,
        new HumanMessage(state.userMessage),
        ...(state.response ? [new AIMessage(state.response)] : []),
    ];

    const out = await getChatModel()
        .withStructuredOutput(FollowUpOutput, { name: 'follow_up' })
        .invoke(messages)
        .catch((err) => {
            console.warn('[follow-up] LLM call failed:', (err as Error).message);
            return {
                destination: null,
                startDate: null,
                endDate: null,
                interests: [] as string[],
                needsMoreInfo: false,
                missingFields: [] as Array<'destination' | 'dates' | 'interests'>,
                suggestedActions: [] as string[],
            };
        });

    // Merge: LLM extraction wins for any field it set; otherwise carry from
    // state (which was hydrated by contextRetriever).
    const destination = (out.destination ?? state.destination) as City | undefined;
    const dates = out.startDate && out.endDate
        ? { start: out.startDate, end: out.endDate }
        : state.dates;
    const interests = out.interests.length ? out.interests : state.interests;

    console.log(
        `[follow-up] slots — destination=${destination ?? '—'} dates=${dates ? `${dates.start}→${dates.end}` : '—'} interests=[${interests.join(',')}] needsMoreInfo=${out.needsMoreInfo}`,
    );

    // Persist the working trip draft to Redis (idempotent).
    if (destination) {
        await ensureDraft(state.userId, state.tripId, {
            destination,
            startDate: dates?.start,
            endDate: dates?.end,
            interests,
        }).catch((err) =>
            console.error('[follow-up] ensureDraft failed:', (err as Error).message),
        );
    }

    // Elicit: URL-mode set by TravelAgent takes priority (don't override with
    // a rule-based form elicit). Otherwise honor the LLM's needsMoreInfo
    // decision, unless the user explicitly declined this turn.
    let elicit: ElicitSpec | undefined = state.elicit;
    if (!elicit && out.needsMoreInfo && !state.userDeclinedElicit) {
        elicit = buildElicit(out.missingFields, state.preferences);
        if (elicit) {
            console.log(`[follow-up] elicit — fields=[${out.missingFields.join(',')}]`);
        }
    }

    // Persist this turn's user + assistant message to AMS working memory.
    if (state.response) {
        appendTurn(state.tripId, state.userId, [
            { role: 'user', content: state.userMessage },
            { role: 'assistant', content: state.response },
        ]).catch((err) => console.error('[follow-up] appendTurn failed:', (err as Error).message));
    }

    return {
        destination,
        dates,
        interests,
        suggestedActions: out.suggestedActions,
        elicit,
    };
}
