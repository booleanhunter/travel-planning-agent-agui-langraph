/**
 * Transport-agnostic planner turn runtime.
 *
 * Both `api/chat.ts` (AG-UI / SSE) and `api/mcp-server.ts` (MCP) call into
 * this. The graph's first node (`contextRetriever`) handles state hydration
 * from Redis trip-store + AMS — the runtime itself just streams the graph.
 *
 * `streamMode: "updates"` emits per-node deltas. We seed `finalState` by
 * Zod-parsing the initial input so declared-default fields exist even when
 * no node emits them; deltas overwrite on top.
 *
 * Transport-specific concerns stay outside:
 *   - AG-UI: maps handler callbacks to AG-UI event types in `chat.ts`.
 *   - MCP: maps `onNodeStart` to `notifications/progress` (when the client
 *     passes a `progressToken`) and keeps the elicit-resume loop in
 *     `mcp-server.ts`.
 */

import { graph, APP_NODES } from './graph.js';
import { AgentState, type AgentStateType } from './state.js';

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
    tripId: string;
    userMessage: string;
    /** Optional one-shot fields a transport wants to inject (e.g. userDeclinedElicit). */
    state?: Record<string, unknown>;
}

const appNodeSet: ReadonlySet<string> = new Set(APP_NODES);

/**
 * Drive one planner turn. Returns the merged final state. Throws on graph
 * error after calling `onError` — caller catches and constructs a
 * transport-native error response.
 */
export async function streamPlannerTurn(
    input: PlannerInput,
    handlers: PlannerStreamHandlers = {},
): Promise<AgentStateType> {
    try {
        handlers.onStart?.();

        const initialInput = {
            ...(input.state ?? {}),
            userId: input.userId,
            tripId: input.tripId,
            userMessage: input.userMessage,
        };

        // Seed finalState with Zod-parsed defaults so declared-default fields
        // exist even if no node emits them.
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
