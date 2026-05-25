import { z } from 'zod';
import { CitySchema, POISchema } from '#modules/places/types.js';
import { WeatherSchema } from '#modules/weather/types.js';
import type { UserPreferences } from '#modules/user/types.js';
import type { ElicitSpec } from './types.js';

/**
 * Agent state passed between nodes. Each turn is one-shot: the graph runs
 * end-to-end and the final state is returned to the client. State that
 * survives between turns lives on the client (and in AMS for cross-session).
 */
export const AgentState = z.object({
    userId: z.string(),
    sessionId: z.string(),
    userMessage: z.string(),

    // Slots — extracted by TravelAgent, possibly carried in from the client
    intent: z
        .enum(['researching', 'tripPreparation', 'itineraryPlanning', 'general'])
        .default('general'),
    destination: CitySchema.optional(),
    dates: z.object({ start: z.string(), end: z.string() }).optional(),
    interests: z.array(z.string()).default([]),
    preferences: z.custom<UserPreferences>().optional(),
    pickedPois: z.array(POISchema).default(() => []),

    // One-shot flag: user clicked Skip on the previous turn's elicit.
    // FollowUp uses this to suppress re-eliciting the same slots this turn.
    // Per-turn only — client opts in by passing true on the decline turn.
    userDeclinedElicit: z.boolean().optional(),

    // Outputs — populated by Fetch* and Finalize* nodes
    pois: z.array(POISchema).default(() => []),
    weather: WeatherSchema.optional(),
    response: z.string().optional(),
    suggestedActions: z.array(z.string()).default(() => []),
    elicit: z.custom<ElicitSpec>().optional(),
});

export type AgentStateType = z.infer<typeof AgentState>;
