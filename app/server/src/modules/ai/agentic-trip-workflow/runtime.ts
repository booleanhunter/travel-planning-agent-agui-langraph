/**
 * Transport-agnostic planner turn runtime.
 *
 * One function both `api/chat.ts` (AG-UI / SSE) and `api/mcp-server.ts`
 * (MCP) call into. Pre-fetches AMS context, drives `graph.stream` with
 * `streamMode: "updates"`, fans per-node deltas out to caller-supplied
 * handlers, and returns the accumulated final state.
 *
 * The accumulated final state matches what `graph.invoke()` returns today
 * because we seed it by Zod-parsing the initial input — the schema's
 * declared defaults (e.g. `interests: []`, `pickedPois: []`) are applied
 * up front, then node deltas overwrite on top.
 *
 * Transport-specific concerns stay outside:
 *   - AG-UI: maps handler callbacks to AG-UI event types in `chat.ts`.
 *   - MCP: maps `onNodeStart` to `notifications/progress` (when the client
 *     passes a `progressToken`) and keeps the elicit-resume loop in
 *     `mcp-server.ts` — MCP and AG-UI elicit semantics differ at the
 *     transport layer and can't be unified here.
 */

import { graph, APP_NODES } from './graph.js';
import { AgentState, type AgentStateType } from './state.js';
import { getPreferences, getConversation } from '#modules/user/domain/user-service.js';

export interface PlannerStreamHandlers {
    onStart?: () => void;
    onNodeStart?: (nodeName: string) => void;
    onNodeUpdate?: (nodeName: string, delta: Partial<AgentStateType>) => void;
    onNodeFinish?: (nodeName: string) => void;
    onFinish?: (finalState: AgentStateType) => void;
    onError?: (err: Error) => void;
}

export interface PlannerInput {
    userId: string;
    sessionId: string;
    userMessage: string;
    /** Caller-supplied state to merge into the initial graph input. */
    state?: Record<string, unknown>;
}

const appNodeSet: ReadonlySet<string> = new Set(APP_NODES);

/**
 * Drive one planner turn. Returns the merged final state (equivalent to
 * what `graph.invoke()` would return today). Throws on graph error after
 * calling `onError` — caller catches and constructs a transport-native
 * error response.
 */
export async function streamPlannerTurn(
    input: PlannerInput,
    handlers: PlannerStreamHandlers = {},
): Promise<AgentStateType> {
    try {
        handlers.onStart?.();

        const [preferences, conv] = await Promise.all([
            getPreferences(input.userId).catch(() => undefined),
            getConversation(input.sessionId).catch(() => null),
        ]);
        const conversationHistory = (conv?.messages ?? []).map((m) => ({
            role: m.role,
            content: m.content,
        }));

        // Build the initial graph input. Caller `state` may include client-side
        // fields (e.g. `pickedPoiIds`) that AgentState doesn't declare; Zod
        // strips unknown keys during `.parse()`.
        const initialInput = {
            ...(input.state ?? {}),
            userId: input.userId,
            sessionId: input.sessionId,
            userMessage: input.userMessage,
            preferences,
            conversationHistory,
        };

        // Seed finalState with Zod-parsed defaults so declared-default fields
        // (`interests: []`, `pickedPois: []`, `pois: []`, `suggestedActions: []`)
        // exist even if no node emits them. Optional fields without defaults
        // (`destination`, `dates`, `elicit`, ...) stay undefined.
        let finalState: AgentStateType = AgentState.parse(initialInput);

        const stream = await graph.stream(initialInput, { streamMode: 'updates' });

        for await (const chunk of stream) {
            for (const [nodeName, delta] of Object.entries(chunk as Record<string, unknown>)) {
                if (!appNodeSet.has(nodeName)) continue;
                handlers.onNodeStart?.(nodeName);
                if (delta && typeof delta === 'object') {
                    const d = delta as Partial<AgentStateType>;
                    handlers.onNodeUpdate?.(nodeName, d);
                    finalState = { ...finalState, ...d };
                }
                handlers.onNodeFinish?.(nodeName);
            }
        }

        handlers.onFinish?.(finalState);
        return finalState;
    } catch (err) {
        handlers.onError?.(err as Error);
        throw err;
    }
}
