/**
 * `afterAgent` middleware that mirrors each turn's working state into the Redis
 * Agent Memory Server (AMS) for inspection. The graph is still checkpointed by
 * `MemorySaver` — AMS is a sidecar surface (`curl :8000/v1/working-memory/...`
 * or `redis-cli`) so the conversation and durable channels are observable while
 * the UI is still a skeleton.
 *
 * Write-only on purpose: nothing reads back into agent state yet. AMS failures
 * are logged and swallowed so a downed sidecar can never break a turn.
 */

import type { BaseMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';
import type { MemoryMessage } from 'agent-memory-client';
import { z } from 'zod/v4';
import { putWorkingMemory } from '../../infrastructure/agent-memory-server-client.ts';

type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

const ROLE_BY_TYPE: Record<string, MemoryMessage['role']> = {
    human: 'user',
    ai: 'assistant',
    tool: 'tool',
    system: 'system',
};

function toMemoryMessage(message: BaseMessage): MemoryMessage {
    const role = ROLE_BY_TYPE[message.getType()] ?? 'assistant';
    const rawContent =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    // AMS rejects empty content. Pure tool-call assistant turns have
    // content === "" (the model "said" tool calls, not text), so synthesize
    // a placeholder that preserves the trace in AMS.
    const content = rawContent && rawContent.trim() ? rawContent : placeholderFor(message);
    return { role, content, id: message.id };
}

function placeholderFor(message: BaseMessage): string {
    const toolCalls = (message as { tool_calls?: Array<{ name?: string }> }).tool_calls;
    if (toolCalls && toolCalls.length) {
        const names = toolCalls.map((c) => c.name ?? '?').join(', ');
        return `[tool_calls: ${names}]`;
    }
    return `[${message.getType()}: empty]`;
}

// `JSON.parse(JSON.stringify(...))` strips functions, undefineds, and class
// instances down to plain JSON — the AMS `data` field is typed as JSONValue and
// the channel values (ItineraryDay[], TripEssential records, weather) are
// already plain objects so this is lossless in practice.
function toJsonValue(value: unknown): JsonValue | undefined {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as JsonValue;
}

interface ItineraryAgentState {
    userId?: string;
    sessionId?: string;
    messages?: BaseMessage[];
    itinerary?: unknown;
    tripEssentials?: unknown;
    candidatePois?: unknown;
    weather?: unknown;
    pendingElicitation?: unknown;
}

// Middleware only sees the channels declared in its own stateSchema — without
// this, the `afterAgent` state would be `{ messages }` only and userId /
// sessionId / the durable channels would be undefined. The schema mirrors
// (a read-only projection of) the relevant ItineraryAnnotation fields.
const persistSchema = z.object({
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    itinerary: z.unknown().optional(),
    tripEssentials: z.unknown().optional(),
    candidatePois: z.unknown().optional(),
    weather: z.unknown().optional(),
    pendingElicitation: z.unknown().optional(),
});

export const persistToAmsMiddleware = createMiddleware({
    name: 'PersistToAmsMiddleware',
    stateSchema: persistSchema,
    afterAgent: async (rawState, runtime) => {
        const state = rawState as ItineraryAgentState;
        // Real UI turns route through CopilotKit and the AG-UI protocol, which
        // doesn't populate our custom `userId`/`sessionId` state channels — only
        // direct LangGraph SDK callers (smoke scripts) set them today. The
        // LangGraph thread_id IS set on every turn (it's CopilotKit's session
        // identifier in this stack) so it's the right fallback for AMS keying.
        const threadId = runtime?.configurable?.thread_id;
        const sessionId = state.sessionId ?? threadId;
        if (!sessionId) return;
        const userId = state.userId ?? 'anonymous';

        const data: Record<string, JsonValue> = {};
        for (const key of ['itinerary', 'tripEssentials', 'candidatePois', 'weather', 'pendingElicitation'] as const) {
            const projected = toJsonValue(state[key]);
            if (projected !== undefined) data[key] = projected;
        }

        const t0 = Date.now();
        try {
            const messages = (state.messages ?? []).map(toMemoryMessage);
            await putWorkingMemory({ sessionId, userId, messages, data });
            const dataKeys = Object.keys(data);
            // eslint-disable-next-line no-console
            console.log(
                `💾 ams [sid=${sessionId.slice(0, 8)}…] ${messages.length} msgs, data: ${dataKeys.join(',') || '-'}  (${Date.now() - t0}ms)`,
            );
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[ams-sidecar] putWorkingMemory failed', {
                sessionId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    },
});
