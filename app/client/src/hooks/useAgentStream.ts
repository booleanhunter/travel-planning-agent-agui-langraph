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
    /**
     * Tracked from streaming snapshots for display in the UI (TripHeaderCard
     * pills). Server is the source of truth; these reflect whatever the
     * server has emitted via STATE_SNAPSHOT events.
     */
    destination: City | null;
    dates: { start: string; end: string } | null;
    interests: string[];
    submitTurn: (input: AgentTurnInput) => Promise<void>;
    /** Cancel/dismiss the current elicit locally — no server call. */
    clearElicit: () => void;
    resetCanvas: () => void;
    /**
     * When the current elicit is URL-mode, this is the userMessage that
     * triggered it. Used to auto-resubmit after the OAuth flow completes.
     * Null when no URL-mode elicit is pending.
     */
    pendingTurnMessage: string | null;
}

/**
 * userId comes from the `?user=` URL param so the demo can switch personas
 * (ashwin / bhavana / kyle) without rebuilding. Defaults to 'ashwin'.
 */
function readUserIdFromUrl(): string {
    if (typeof window === 'undefined') return 'ashwin';
    const u = new URLSearchParams(window.location.search).get('user');
    return u?.trim() || 'ashwin';
}

/**
 * tripId is fixed per user. AMS conversation + trip-store working slot persist
 * across page reloads. Reset (via the memory drawer) wipes them.
 */
const TRIP_ID = 'newTripId';

export function useAgentStream(): AgentStream & {
    userId: string;
    tripId: string;
} {
    const [userId] = useState<string>(() => readUserIdFromUrl());
    const tripId = TRIP_ID;
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
    const [pendingTurnMessage, setPendingTurnMessage] = useState<string | null>(null);
    const inFlightMessageRef = useRef<string | null>(null);

    // Slot state — populated from server streaming snapshots, used for the
    // TripHeaderCard pills. NOT sent back to the server (server reads from
    // Redis trip-store via contextRetriever).
    const [destination, setDestination] = useState<City | null>(null);
    const [dates, setDates] = useState<{ start: string; end: string } | null>(null);
    const [interests, setInterests] = useState<string[]>([]);

    useEffect(() => {
        agentRef.current = new HttpAgent({ url: '/api/chat' });
    }, []);

    const applyDelta = useCallback((delta: Record<string, unknown>) => {
        if (delta.pois !== undefined) setPois(delta.pois as POI[]);
        if (delta.weather !== undefined) setWeather(delta.weather as Weather);
        if (delta.elicit !== undefined) {
            const newElicit = delta.elicit as ElicitSpec | null;
            setElicit(newElicit);
            if (newElicit?.mode === 'url' && inFlightMessageRef.current) {
                setPendingTurnMessage(inFlightMessageRef.current);
            }
        }
        if (delta.response !== undefined) setResponse(delta.response as string);
        if (delta.suggestedActions !== undefined)
            setSuggestedActions(delta.suggestedActions as string[]);
        if (delta.destination !== undefined) setDestination(delta.destination as City);
        if (delta.dates !== undefined)
            setDates(delta.dates as { start: string; end: string });
        if (delta.interests !== undefined) setInterests(delta.interests as string[]);
        if (Array.isArray(delta.pickedPois)) setPickedPois(delta.pickedPois as POI[]);
    }, []);

    const clearElicit = useCallback(() => {
        setElicit(null);
        setPendingTurnMessage(null);
    }, []);

    const resetCanvas = useCallback(() => {
        setPois([]);
        setWeather(null);
        setElicit(null);
        setResponse('');
        setSuggestedActions([]);
        setConversation([]);
        setPickedPois([]);
        setDestination(null);
        setDates(null);
        setInterests([]);
        setError(null);
        setPendingTurnMessage(null);
    }, []);

    const submitTurn = useCallback(
        async (input: AgentTurnInput) => {
            const agent = agentRef.current;
            if (!agent) return;

            inFlightMessageRef.current = input.userMessage;

            setRunning(true);
            setError(null);
            setElicit(null);
            setPendingTurnMessage(null);

            // Append user message — dots accumulate on this entry as the run progresses.
            setConversation((prev) => [
                ...prev,
                { role: 'user', content: input.userMessage, dots: {} },
            ]);

            // No slot fields — server reloads them from Redis trip-store via
            // contextRetriever. Just identity + one-shot flags.
            const stateToSend: Record<string, unknown> = { userId };
            if (input.userDeclinedElicit) stateToSend.userDeclinedElicit = true;

            agent.threadId = tripId;
            agent.setMessages([
                ...conversation.map((message) => ({
                    id: `${Date.now()}`,
                    role: message.role,
                    content: message.content,
                })),
                { id: `${Date.now()}-u`, role: 'user', content: input.userMessage },
            ]);
            agent.setState(stateToSend);

            // Helper: update dots on the most recent user entry.
            const updateLatestUserDots = (stepName: string, status: DotStatus) =>
                setConversation((prev) => {
                    let lastUserIdx = -1;
                    for (let index = prev.length - 1; index >= 0; index--) {
                        if (prev[index].role === 'user') {
                            lastUserIdx = index;
                            break;
                        }
                    }
                    if (lastUserIdx === -1) return prev;
                    return prev.map((entry, index) =>
                        index === lastUserIdx
                            ? { ...entry, dots: { ...(entry.dots ?? {}), [stepName]: status } }
                            : entry,
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
        [applyDelta, conversation, tripId, userId],
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
        destination,
        dates,
        interests,
        submitTurn,
        clearElicit,
        resetCanvas,
        pendingTurnMessage,
        userId,
        tripId,
    };
}
