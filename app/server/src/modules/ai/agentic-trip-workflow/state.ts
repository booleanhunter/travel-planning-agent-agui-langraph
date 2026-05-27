import { z } from 'zod';
import { CitySchema, POISchema } from '#modules/places/types.js';
import { WeatherSchema } from '#modules/weather/types.js';
import type { UserPreferences } from '#modules/user/types.js';
import type { ElicitSpec } from './types.js';

/**
 * Record of one tool call the LLM made during a turn. FollowUp reads
 * this to extract slots (e.g. destination from `searchPois`'s `city` arg)
 * and to decide whether the agent did any work this turn at all.
 */
export interface ToolCallRecord {
    name: string;
    args: Record<string, unknown>;
}

/**
 * Agent state passed between nodes. Each turn is one-shot: the graph runs
 * end-to-end and the final state is returned to the client. State that
 * survives between turns lives on the client (and in AMS for cross-session).
 */
export const AgentState = z.object({
    userId: z.string(),
    sessionId: z.string(),
    userMessage: z.string(),

    // Slots — set by FollowUp from TravelAgent's tool-call args (or carried in
    // from the client across turns).
    destination: CitySchema.optional(),
    dates: z.object({ start: z.string(), end: z.string() }).optional(),
    interests: z.array(z.string()).default([]),
    preferences: z.custom<UserPreferences>().optional(),
    /**
     * Conversation history pre-fetched outside the graph (from AMS working
     * memory). Nodes consume this directly — no in-node AMS reads.
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

    /**
     * Record of which tools the LLM called in TravelAgent this turn. Read by
     * FollowUp to extract slots (from tool args) and to decide whether the
     * agent did any work — zero tool calls + destination missing → elicit.
     */
    toolCalls: z.custom<ToolCallRecord[]>().default(() => [] as ToolCallRecord[]),
});

export type AgentStateType = z.infer<typeof AgentState>;
