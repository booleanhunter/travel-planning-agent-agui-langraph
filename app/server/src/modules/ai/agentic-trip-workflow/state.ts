import { z } from 'zod';
import { CitySchema, POISchema } from '#modules/places/catalog.js';
import { WeatherSchema } from '#modules/weather/types.js';
import type { UserPreferences } from '#modules/user/types.js';
import type { ElicitSpec } from './types.js';

/**
 * Agent state passed between nodes. Each turn is one-shot: the graph runs
 * end-to-end and the final state is returned to the transport. Persistence
 * between turns lives in Redis trip-store + AMS — never in the client
 * request body. `contextRetriever` is the single read point at graph entry;
 * `followUp` is the single write point at graph exit.
 */
export const AgentState = z.object({
    userId: z.string(),
    tripId: z.string(),
    userMessage: z.string(),

    // Slots — hydrated by contextRetriever from Redis trip-store, refreshed
    // by followUp's LLM extraction at the end of each turn.
    destination: CitySchema.optional(),
    dates: z.object({ start: z.string(), end: z.string() }).optional(),
    interests: z.array(z.string()).default([]),
    preferences: z.custom<UserPreferences>().optional(),
    /**
     * Conversation history hydrated by contextRetriever from AMS working
     * memory. Nodes consume directly — no in-node AMS reads.
     */
    conversationHistory: z
        .array(z.object({ role: z.string(), content: z.string() }))
        .default(() => []),
    pickedPois: z.array(POISchema).default(() => []),

    // One-shot flag: user clicked Skip on the previous turn's elicit.
    // FollowUp uses this to suppress re-eliciting the same slots this turn.
    // Per-turn only — client opts in by passing true on the decline turn.
    userDeclinedElicit: z.boolean().optional(),

    // Outputs — populated by TravelAgent's ReAct loop (via tool onApplied
    // callbacks) and FollowUp (suggestedActions, elicit).
    pois: z.array(POISchema).default(() => []),
    weather: WeatherSchema.optional(),
    response: z.string().optional(),
    suggestedActions: z.array(z.string()).default(() => []),
    elicit: z.custom<ElicitSpec>().optional(),
});

export type AgentStateType = z.infer<typeof AgentState>;
