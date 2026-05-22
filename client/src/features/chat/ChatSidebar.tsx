/**
 * ChatSidebar — the ~25% right-hand rail.
 *
 * Owns the chat thread + prompt input. CopilotKit v2 owns the transport: the
 * `useAgent` hook subscribes to the bound LangGraph agent (registered as
 * `itineraryPlanner` in itinerary-routes.ts) and re-renders on every
 * message/state notification. `useInterrupt` surfaces the
 * `requestTripBasicsFromUser` tool's `interrupt(payload)` as an inline chip
 * card via InlineVariableChips, with `renderInChat: false` so we place it
 * inside our own thread layout rather than CopilotChat's default surface.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgent, useInterrupt } from '@copilotkit/react-core/v2';
import type { AssistantMessage, Message, ToolMessage } from '@ag-ui/core';
import { InlineVariableChips } from '../elicit/InlineVariableChips.tsx';
import type { ElicitRequest } from '../elicit/types.ts';

// Agent name must match the key on CopilotRuntime({ agents: { ... } }) in
// server/src/index.ts. Without this, useAgent/useInterrupt resolve the
// implicit 'default' agent and throw "Agent 'default' not found".
const AGENT_ID = 'itineraryPlanner';

export function ChatSidebar() {
    const { agent } = useAgent({ agentId: AGENT_ID });
    const messages = (agent?.messages ?? []) as Message[];
    const isRunning = Boolean(agent?.isRunning);

    // Tool results stream in as `role: 'tool'` messages keyed by toolCallId.
    // Pre-index them so each assistant tool-call row can flip its status dot
    // from "running" to "done" the moment its result arrives.
    const toolResults = useMemo(() => {
        const map = new Map<string, ToolMessage>();
        for (const m of messages) {
            if (m.role === 'tool') map.set(m.toolCallId, m as ToolMessage);
        }
        return map;
    }, [messages]);

    // The generic "Thinking…" row is only useful when the agent is mid-turn
    // with no tool-call row to show progress. If the latest assistant message
    // has tool calls, those rows already convey state — avoid stacking two
    // indicators for the same activity.
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant') as
        | AssistantMessage
        | undefined;
    const showThinking = isRunning && !lastAssistant?.toolCalls?.length;

    // The tool's interrupt() payload is the ElicitRequest itself. The
    // @ag-ui/langgraph adapter JSON-stringifies non-string interrupt values
    // before dispatching them as CUSTOM events, so event.value arrives here
    // as a JSON string — parse it back to the object the chips expect.
    // Rendering inline (renderInChat: false) returns the element so we can
    // insert it into our own thread, mid-conversation, where the user
    // expects it. Declining maps to resolving with an empty object so the
    // tool resumes with no answers.
    const elicitElement = useInterrupt<void, false>({
        agentId: AGENT_ID,
        renderInChat: false,
        render: ({ event, resolve }) => {
            const request = parseElicitRequest(event.value);
            if (!request) return <></>;
            return (
                <InlineVariableChips
                    request={request}
                    onSubmit={(values) => resolve(values)}
                    onDecline={() => resolve({})}
                />
            );
        },
    });

    const [draft, setDraft] = useState('');
    const threadRef = useRef<HTMLDivElement>(null);

    // Auto-scroll on new messages or while the agent is streaming.
    useEffect(() => {
        if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }, [messages, isRunning, elicitElement]);

    const submit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const text = draft.trim();
        if (!text || !agent || isRunning) return;
        setDraft('');
        agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: text });
        try {
            await agent.runAgent();
        } catch (err) {
            console.error('[chat] agent run failed', err);
        }
    };

    return (
        <aside className="sidebar" aria-label="Assistant">
            <header className="sidebar-header">
                <p className="sidebar-label">Assistant</p>
            </header>

            <div className="sidebar-thread" ref={threadRef}>
                {messages.length === 0 && !elicitElement && (
                    <p className="placeholder">
                        Try: <em>Plan a trip to Bangalore</em>.
                    </p>
                )}
                {messages.map((msg) => (
                    <MessageRow key={msg.id} message={msg} toolResults={toolResults} />
                ))}
                {elicitElement && <div className="thread-elicit">{elicitElement}</div>}
                {showThinking && (
                    <div className="thread-tool thread-tool--running">
                        <span className="tool-dot tool-dot--running" aria-hidden="true" />
                        <span className="tool-label">Thinking…</span>
                    </div>
                )}
            </div>

            <form className="sidebar-input" onSubmit={submit}>
                <div className={`prompt-row${isRunning ? ' is-busy' : ''}`}>
                    <input
                        type="text"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={isRunning ? 'Thinking…' : 'Ask anything…'}
                        disabled={isRunning || !agent}
                        aria-label="Message"
                    />
                    <button
                        type="submit"
                        disabled={isRunning || !draft.trim() || !agent}
                        aria-label="Send"
                    >
                        <i className="ti ti-arrow-up" aria-hidden="true" />
                    </button>
                </div>
            </form>
        </aside>
    );
}

interface MessageRowProps {
    message: Message;
    toolResults: Map<string, ToolMessage>;
}

function MessageRow({ message, toolResults }: MessageRowProps) {
    const role = message.role;

    if (role === 'user') {
        const text = typeof message.content === 'string' ? message.content : '';
        return (
            <div className="thread-user">
                <div className="thread-bubble thread-bubble--user">{text}</div>
            </div>
        );
    }

    if (role === 'assistant') {
        const assistant = message as AssistantMessage;
        const text = typeof assistant.content === 'string' ? assistant.content : '';
        const calls = assistant.toolCalls ?? [];
        if (!text && calls.length === 0) return null;
        return (
            <div className="thread-agent">
                {text && <div className="thread-bubble thread-bubble--agent">{text}</div>}
                {calls.map((call) => {
                    const result = toolResults.get(call.id);
                    const done = Boolean(result);
                    const errored = Boolean(result?.error);
                    return (
                        <div
                            key={call.id}
                            className={`thread-tool thread-tool--${done ? 'done' : 'running'}`}
                            title={call.function.arguments}
                        >
                            <span
                                className={`tool-dot tool-dot--${done ? 'done' : 'running'}`}
                                aria-hidden="true"
                            />
                            <span className="tool-label">
                                {done ? (errored ? '✕ ' : '✓ ') : ''}
                                {call.function.name}
                            </span>
                        </div>
                    );
                })}
            </div>
        );
    }

    // tool results are surfaced inline under their assistant message via
    // toolResults; system / developer / reasoning / activity — hidden in v1.
    return null;
}

function parseElicitRequest(value: unknown): ElicitRequest | null {
    const obj = typeof value === 'string' ? safeJsonParse(value) : value;
    if (obj && typeof obj === 'object' && Array.isArray((obj as ElicitRequest).fields)) {
        return obj as ElicitRequest;
    }
    console.warn('[chat] elicit interrupt missing fields[]', value);
    return null;
}

function safeJsonParse(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}
