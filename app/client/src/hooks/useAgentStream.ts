import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HttpAgent, type AgentSubscriber } from '@ag-ui/client';
import type { POI, Weather, ElicitSpec, DotStatus, City } from '../types';

interface ConversationEntry {
    role: 'user' | 'assistant';
    content: string;
    /** Tool-row dots accumulated while this turn ran. Only meaningful on user
     *  entries — the user msg "owns" the run that follows it. Assistant entries
     *  added by that run leave it undefined. */
    dots?: Record<string, DotStatus>;
}

interface AgentTurnInput {
    userMessage: string;
    destination?: City;
    dates?: { start: string; end: string };
    interests?: string[];
    pickedPois?: POI[];
    /** One-shot: tells server this turn is a decline of the prior elicit. */
    userDeclinedElicit?: boolean;
}

interface AgentStream {
    pois: POI[];
    weather: Weather | null;
    elicit: ElicitSpec | null;
    response: string;
    suggestedActions: string[];
    running: boolean;
    error: string | null;
    conversation: ConversationEntry[];
    pickedPois: POI[];
    setPickedPois: React.Dispatch<React.SetStateAction<POI[]>>;
    submitTurn: (input: AgentTurnInput) => Promise<void>;
    /** Cancel/dismiss the current elicit locally — no server call. */
    clearElicit: () => void;
    resetCanvas: () => void;
}

const USER_ID = 'ashwin';

function newSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useAgentStream(): AgentStream & {
    sessionId: string;
    setSessionId: (id: string) => void;
} {
    const [sessionId, setSessionId] = useState<string>(() => newSessionId());
    const agentRef = useRef<HttpAgent | null>(null);

    const [pois, setPois] = useState<POI[]>([]);
    const [weather, setWeather] = useState<Weather | null>(null);
    const [elicit, setElicit] = useState<ElicitSpec | null>(null);
    const [response, setResponse] = useState<string>('');
    const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
    const [running, setRunning] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [conversation, setConversation] = useState<ConversationEntry[]>([]);
    const [pickedPois, setPickedPois] = useState<POI[]>([]);
    // Resolved slots from RouteIntent — carried forward to subsequent turns
    const [resolvedSlots, setResolvedSlots] = useState<{
        destination?: City;
        dates?: { start: string; end: string };
        interests?: string[];
    }>({});

    useEffect(() => {
        agentRef.current = new HttpAgent({ url: '/api/chat' });
    }, []);

    const applyDelta = useCallback((delta: Record<string, unknown>) => {
        if (delta.pois !== undefined) setPois(delta.pois as POI[]);
        if (delta.weather !== undefined) setWeather(delta.weather as Weather);
        if (delta.elicit !== undefined) setElicit(delta.elicit as ElicitSpec);
        if (delta.response !== undefined) setResponse(delta.response as string);
        if (delta.suggestedActions !== undefined)
            setSuggestedActions(delta.suggestedActions as string[]);
        if (delta.destination !== undefined)
            setResolvedSlots((s) => ({ ...s, destination: delta.destination as City }));
        if (delta.dates !== undefined)
            setResolvedSlots((s) => ({
                ...s,
                dates: delta.dates as { start: string; end: string },
            }));
        if (delta.interests !== undefined)
            setResolvedSlots((s) => ({ ...s, interests: delta.interests as string[] }));
        if (Array.isArray(delta.pickedPois)) setPickedPois(delta.pickedPois as POI[]);
        // Note: the response → conversation push happens in the subscriber so we can
        // associate the message with the current turnId.
    }, []);

    const clearElicit = useCallback(() => setElicit(null), []);

    const resetCanvas = useCallback(() => {
        setPois([]);
        setWeather(null);
        setElicit(null);
        setResponse('');
        setSuggestedActions([]);
        setConversation([]);
        setPickedPois([]);
        setError(null);
        setResolvedSlots({});
        setSessionId(newSessionId());
    }, []);

    const submitTurn = useCallback(
        async (input: AgentTurnInput) => {
            const agent = agentRef.current;
            if (!agent) return;

            setRunning(true);
            setError(null);
            setElicit(null);

            // Append user message — dots accumulate on this entry as the run progresses.
            setConversation((prev) => [
                ...prev,
                { role: 'user', content: input.userMessage, dots: {} },
            ]);

            // Start from previously resolved slots, then let input override
            const stateToSend: Record<string, unknown> = {
                userId: USER_ID,
                ...resolvedSlots,
            };
            if (input.destination) stateToSend.destination = input.destination;
            if (input.dates) stateToSend.dates = input.dates;
            if (input.interests?.length) stateToSend.interests = input.interests;
            const effectivePicked = input.pickedPois ?? pickedPois;
            if (effectivePicked.length) stateToSend.pickedPois = effectivePicked;
            if (input.userDeclinedElicit) stateToSend.userDeclinedElicit = true;

            agent.threadId = sessionId;
            agent.setMessages([
                ...conversation.map((m) => ({
                    id: `${Date.now()}`,
                    role: m.role,
                    content: m.content,
                })),
                { id: `${Date.now()}-u`, role: 'user', content: input.userMessage },
            ]);
            agent.setState(stateToSend);

            // Helper: update dots on the most recent user entry.
            const updateLatestUserDots = (stepName: string, status: DotStatus) =>
                setConversation((prev) => {
                    let idx = -1;
                    for (let i = prev.length - 1; i >= 0; i--) {
                        if (prev[i].role === 'user') {
                            idx = i;
                            break;
                        }
                    }
                    if (idx === -1) return prev;
                    return prev.map((e, i) =>
                        i === idx ? { ...e, dots: { ...(e.dots ?? {}), [stepName]: status } } : e,
                    );
                });

            const subscriber: AgentSubscriber = {
                onStepStartedEvent: ({ event }) => updateLatestUserDots(event.stepName, 'pending'),
                onStepFinishedEvent: ({ event }) => updateLatestUserDots(event.stepName, 'done'),
                onStateSnapshotEvent: ({ event }) => {
                    const snapshot = event.snapshot as Record<string, unknown>;
                    if (!snapshot || typeof snapshot !== 'object') return;
                    applyDelta(snapshot);
                    if (typeof snapshot.response === 'string' && snapshot.response.length > 0) {
                        const text = snapshot.response;
                        setConversation((prev) => [...prev, { role: 'assistant', content: text }]);
                    }
                },
                onRunErrorEvent: ({ event }) => {
                    setError(event.message ?? 'Unknown error');
                },
            };

            try {
                await agent.runAgent({}, subscriber);
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setRunning(false);
            }
        },
        [applyDelta, conversation, sessionId, pickedPois, resolvedSlots],
    );

    return {
        pois,
        weather,
        elicit,
        response,
        suggestedActions,
        running,
        error,
        conversation,
        pickedPois,
        setPickedPois,
        submitTurn,
        clearElicit,
        resetCanvas,
        sessionId,
        setSessionId,
    };
}
