/**
 * Per-turn console timeline for the itinerary agent — gives the langgraph dev
 * pane visibility into which tools fire, with what args, and how long they
 * take. Mirrors the "emoji-prefixed log at every strategic boundary" pattern
 * from the redish reference codebase.
 *
 * Centralised in middleware (`beforeAgent` / `wrapToolCall` / `afterAgent`) so
 * the 8 individual tools stay unchanged; per-tool emojis match the icons used
 * in the system prompt for quick visual scanning.
 */

import type { Command } from '@langchain/langgraph';
import { ToolMessage, type AIMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';

const TOOL_ICON: Record<string, string> = {
    searchAndRankPointsOfInterest: '🗺️ ',
    lookupWeather: '🌤️ ',
    addPointOfInterestToItinerary: '📅',
    removePointOfInterestFromItinerary: '🗑️ ',
    searchProducts: '🛍️ ',
    addItemToTripEssentials: '🧳',
    removeItemFromTripEssentials: '❌',
    requestTripBasicsFromUser: '❓',
};

// Compact thread/session id for log lines — full uuid is too noisy.
function shortId(id: string | undefined): string {
    if (!id) return 'unknown';
    return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

// One-line preview of tool args / message content; long values get truncated.
function preview(value: unknown, limit = 120): string {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    if (!s) return '';
    return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

interface TurnContext {
    startedAt: number;
    startMsgCount: number;
    tools: string[];
}

// Thread-id → in-flight turn context. We don't have per-turn middleware
// instances so we key off the langgraph thread; concurrent turns on the same
// thread would clash but the agent serialises them at the checkpointer level.
const turns = new Map<string, TurnContext>();

interface AgentStateWithMessages {
    messages?: { content?: unknown; getType?: () => string }[];
}

export const observabilityMiddleware = createMiddleware({
    name: 'ObservabilityMiddleware',
    beforeAgent: (rawState, runtime) => {
        const state = rawState as AgentStateWithMessages;
        const threadId = runtime?.configurable?.thread_id ?? 'unknown';
        const lastUser = [...(state.messages ?? [])]
            .reverse()
            .find((m) => m.getType?.() === 'human');
        // eslint-disable-next-line no-console
        console.log(`▶ turn [sid=${shortId(threadId)}] user: ${preview(lastUser?.content, 100)}`);
        turns.set(threadId, {
            startedAt: Date.now(),
            startMsgCount: state.messages?.length ?? 0,
            tools: [],
        });
    },

    // Tool failures (e.g. model hallucinates an arg key, Zod rejects) MUST NOT
    // crash the run — the AG-UI stream would abort mid-message and the user
    // would see the chat go silent. Catch here and return a status='error'
    // ToolMessage so the agent sees the failure in conversation history and
    // can self-correct on its next step.
    wrapToolCall: async (request, handler) => {
        const name = request.toolCall.name;
        const icon = TOOL_ICON[name] ?? '🔧';
        const threadId = request.runtime?.configurable?.thread_id ?? 'unknown';
        const t0 = Date.now();
        // eslint-disable-next-line no-console
        console.log(`${icon} ${name} ${preview(request.toolCall.args, 140)}`);
        try {
            const result: ToolMessage | Command = await handler(request);
            const ms = Date.now() - t0;
            const update = (result as { update?: { messages?: ToolMessage[] } }).update;
            const resultMsg = update?.messages?.[0] as ToolMessage | undefined;
            const content = (resultMsg ?? (result as ToolMessage)).content;
            // eslint-disable-next-line no-console
            console.log(`  ✓ ${name} → ${preview(content, 100)}  (${ms}ms)`);
            turns.get(threadId)?.tools.push(name);
            return result;
        } catch (err) {
            const ms = Date.now() - t0;
            const msg = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console
            console.log(`  ✗ ${name} → ${preview(msg, 200)}  (${ms}ms)`);
            turns.get(threadId)?.tools.push(`${name}!err`);
            return new ToolMessage({
                content: JSON.stringify({ error: msg }),
                tool_call_id: request.toolCall.id,
                status: 'error',
            });
        }
    },

    afterAgent: (rawState, runtime) => {
        const state = rawState as AgentStateWithMessages;
        const threadId = runtime?.configurable?.thread_id ?? 'unknown';
        const ctx = turns.get(threadId);
        if (!ctx) return;
        turns.delete(threadId);

        const totalMs = Date.now() - ctx.startedAt;
        const msgDelta = (state.messages?.length ?? 0) - ctx.startMsgCount;
        // Collapse repeated tool calls into `name×N` for readability.
        const counts = new Map<string, number>();
        for (const t of ctx.tools) counts.set(t, (counts.get(t) ?? 0) + 1);
        const summary = [...counts.entries()]
            .map(([name, n]) => (n > 1 ? `${name}×${n}` : name))
            .join(',');
        const lastAi = [...(state.messages ?? [])]
            .reverse()
            .find((m) => m.getType?.() === 'ai') as AIMessage | undefined;
        const reply = preview(lastAi?.content, 100);
        // eslint-disable-next-line no-console
        console.log(
            `◀ turn [sid=${shortId(threadId)}] tools=[${summary}] +${msgDelta} msgs  (${(totalMs / 1000).toFixed(1)}s)` +
                (reply ? `\n  reply: ${reply}` : ''),
        );
    },
});
