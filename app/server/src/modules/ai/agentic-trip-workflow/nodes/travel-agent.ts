import { z } from 'zod';
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { getChatModel } from '#modules/ai/helpers/llm.js';
import { getPreferences, getConversation } from '#modules/user/domain/user-service.js';
import { ensureDraft } from '#modules/trips/domain/trips-service.js';
import { CitySchema } from '#modules/places/types.js';
import type { AgentStateType } from '../state.js';

const TravelAgentOutput = z.object({
    textResponse: z
        .string()
        .describe(
            'A friendly, conversational reply to the user. Shown as a chat bubble immediately, before any data is fetched. Do NOT promise specific places or weather — those land in a later step.',
        ),
    intent: z
        .enum(['researching', 'tripPreparation', 'itineraryPlanning', 'general'])
        .describe(
            'Classification of what the user is doing this turn. ' +
                '"researching" = exploring places ("what is there to do in Bangalore", "tell me about the food scene"). ' +
                '"tripPreparation" = asking about weather, what to pack, logistics. ' +
                '"itineraryPlanning" = actively planning or refining a trip ("plan a trip to Bangalore", "build me a day"). ' +
                '"general" = anything else, including form submissions, small talk, or replies to a previous question.',
        ),
    destination: CitySchema.nullable().describe(
        'City being planned. null if not mentioned in this turn AND not visible in the prior conversation.',
    ),
    dates: z
        .object({ start: z.string(), end: z.string() })
        .nullable()
        .describe(
            'Travel dates as ISO YYYY-MM-DD strings. Resolve relative dates ("next week", "May 20") against today. null if unknown.',
        ),
    interests: z
        .array(z.string())
        .describe(
            'Short interest descriptors the user articulated this turn (e.g. food, slow, indie, moody, landmarks). Empty array if none mentioned.',
        ),
});

const SYSTEM_PROMPT = (
    today: string,
) => `You are a friendly travel agent helping plan trips to one of three cities: Bangalore, Mumbai, or Barcelona.
Today's date is ${today}.

Your job on each turn is to:
1. Reply to the user conversationally (textResponse field). Don't make promises about places or weather — those land in a later step.
2. Classify their intent: "researching" (exploring places), "tripPreparation" (weather / packing / logistics), "itineraryPlanning" (planning or refining a trip), or "general" (anything else, including form submissions and small talk).
3. Extract any slots they mentioned: destination, dates, interests. Use the prior conversation context to fill in slots they mentioned earlier in this session.

Resolve relative dates against today (${today}). Return null for any slot not stated in this turn AND not in prior context.`;

export async function travelAgent(state: AgentStateType): Promise<Partial<AgentStateType>> {
    console.log(
        `\n🧭 [travel-agent] turn — session=${state.sessionId} user=${state.userId} msg="${state.userMessage.slice(0, 80)}"`,
    );

    const [prefs, conv] = await Promise.all([
        getPreferences(state.userId).catch(() => undefined),
        getConversation(state.sessionId).catch(() => null),
    ]);
    console.log(
        `[travel-agent] AMS — prior messages=${conv?.messages?.length ?? 0} preferences=${prefs ? JSON.stringify(prefs) : 'none'}`,
    );

    const today = new Date().toISOString().split('T')[0];

    const priorMessages: BaseMessage[] = (conv?.messages ?? []).map((m) =>
        m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    );

    const messages: BaseMessage[] = [
        new SystemMessage(SYSTEM_PROMPT(today)),
        ...priorMessages,
        new HumanMessage(state.userMessage),
    ];

    const llm = getChatModel().withStructuredOutput(TravelAgentOutput, { name: 'travel_agent' });
    const out = await llm.invoke(messages);
    console.log(
        `[travel-agent] LLM — intent=${out.intent} destination=${out.destination ?? '—'} dates=${out.dates ? `${out.dates.start}→${out.dates.end}` : '—'} interests=[${out.interests.join(',')}]`,
    );
    console.log(
        `[travel-agent] reply: "${out.textResponse.slice(0, 120)}${out.textResponse.length > 120 ? '…' : ''}"`,
    );

    // Priority for slot merge: this turn's extraction > carried-in client state > memory
    const memInterests = prefs?.recurringInterests ?? [];
    const interests = out.interests.length
        ? out.interests
        : state.interests.length
          ? state.interests
          : memInterests;

    const resolvedDestination = out.destination ?? state.destination;
    const resolvedDates = out.dates ?? state.dates;

    // Upsert a draft trip record in Redis with whatever we know so far.
    // Idempotent — safe to call every turn.
    await ensureDraft(state.userId, state.sessionId, {
        city: resolvedDestination,
        startDate: resolvedDates?.start,
        endDate: resolvedDates?.end,
    }).catch((err) => console.error('[travel-agent] ensureDraft failed:', (err as Error).message));

    return {
        intent: out.intent,
        destination: resolvedDestination,
        dates: resolvedDates,
        interests,
        preferences: prefs ?? state.preferences,
        // response: out.textResponse, // Don't store this agent's reply in state — it's ephemeral, only for this turn's UI. Storing it causes weirdness because it doesn't have access to all tools.
    };
}
