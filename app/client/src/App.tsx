import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentStream } from './hooks/useAgentStream';
import { PromptInput } from './components/PromptInput';
import { ChatSidebar } from './components/ChatSidebar';
import { ElicitChipCard } from './components/ElicitChipCard';
import { PointOfInterestGrid } from './components/PointOfInterestGrid';
import { PlanAccordion } from './components/PlanAccordion';
import { LiveRouteMap } from './components/LiveRouteMap';
import { WeatherCard } from './components/WeatherCard';
import { MemoryDrawer } from './components/MemoryDrawer';
import type { POI, PastTrip, City } from './types';

const USER_ID = 'ashwin';

export function App() {
    const stream = useAgentStream();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState<string | null>(null);

    const pickedPois = stream.pickedPois;
    const pickedIds = useMemo(() => pickedPois.map((p) => p.id), [pickedPois]);

    // Staging: which places the user currently has selected. Mirrors pickedPois on
    // every server-confirmed change, but the user can freely edit between commits.
    // Checkboxes + strip both reflect stagedPois. Server is NEVER touched until
    // the user clicks "Update plan".
    const [stagedPois, setStagedPois] = useState<POI[]>([]);
    useEffect(() => {
        setStagedPois(pickedPois);
    }, [pickedPois]);

    const stagedIds = useMemo(() => stagedPois.map((p) => p.id), [stagedPois]);

    const stagedDiffers = useMemo(() => {
        if (stagedPois.length !== pickedPois.length) return true;
        return stagedPois.some((p, i) => pickedPois[i]?.id !== p.id);
    }, [stagedPois, pickedPois]);

    // Pois shown in the grid: this turn's candidates + committed picks that fell
    // out of the latest fetch. Picks carry full POI data so we just include them.
    const gridPois: POI[] = useMemo(() => {
        const inStream = new Set(stream.pois.map((p) => p.id));
        const orphans = pickedPois.filter((p) => !inStream.has(p.id));
        return [...stream.pois, ...orphans];
    }, [stream.pois, pickedPois]);

    /** Build the "Here are the places I'd like to visit, in-order:" turn message
     *  and submit it. The agent's FollowUp LLM picks this up, calls
     *  `updateItinerary` with the matching place IDs, and Redis/state sync. */
    const submitPlanUpdate = useCallback(
        (picks: POI[]) => {
            let userMessage: string;
            if (picks.length === 0) {
                userMessage = "Please clear my plan — I don't want any places.";
            } else {
                const list = picks.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
                userMessage = `Here are the places I'd like to visit, in-order:\n${list}`;
            }
            return stream.submitTurn({ userMessage });
        },
        [stream],
    );

    const handleUpdatePlan = useCallback(() => {
        // Optimistically reflect the staged set as committed — server confirmation lands shortly.
        stream.setPickedPois(stagedPois);
        return submitPlanUpdate(stagedPois);
    }, [stagedPois, stream, submitPlanUpdate]);

    /** Checkbox click — purely local staging, no server call. */
    const togglePick = useCallback((poi: POI) => {
        setStagedPois((picks) => {
            const exists = picks.some((p) => p.id === poi.id);
            return exists ? picks.filter((p) => p.id !== poi.id) : [...picks, poi];
        });
    }, []);

    /** × on a strip pin — purely local unstaging, no server call. */
    const removePick = useCallback((poiId: string) => {
        setStagedPois((picks) => picks.filter((p) => p.id !== poiId));
    }, []);

    const submitFreeForm = useCallback(
        (text: string) => stream.submitTurn({ userMessage: text }),
        [stream],
    );

    const submitElicit = useCallback(
        (values: Record<string, unknown>) => {
            const destination = values.destination as City | undefined;
            const startDate = values.startDate as string | undefined;
            const endDate = values.endDate as string | undefined;
            const dates = startDate && endDate ? { start: startDate, end: endDate } : undefined;
            const interests = values.interests as string[] | undefined;

            const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
            const sentences: string[] = [];
            if (destination) sentences.push(`My destination is ${cap(destination)}.`);
            if (dates) sentences.push(`I plan to travel from ${dates.start} to ${dates.end}.`);
            if (interests?.length) sentences.push(`I am interested in ${interests.join(', ')}.`);

            const userMessage = sentences.length
                ? 'Here are the details: ' + sentences.join(' ')
                : 'Here are the details from the form.';

            stream.submitTurn({ userMessage, destination, dates, interests });
        },
        [stream],
    );

    const handleSave = useCallback(async () => {
        if (pickedPois.length === 0) return;
        setSaving(true);
        try {
            const res = await fetch('/api/user/save-trip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: USER_ID, tripId: stream.sessionId }),
            });
            if (res.ok) setSavedAt(new Date().toLocaleTimeString());
        } finally {
            setSaving(false);
        }
    }, [pickedPois.length, stream.sessionId]);

    const handleLoadTrip = useCallback(
        async (trip: PastTrip) => {
            setDrawerOpen(false);
            stream.resetCanvas();
            try {
                const res = await fetch('/api/user/load-trip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: USER_ID, tripId: trip.tripId }),
                });
                if (!res.ok) return;
                const data = (await res.json()) as {
                    trip: PastTrip;
                    conversationHistory: Array<{ role: string; content: string }>;
                };
                // Best-effort rehydrate: replay user's first message to refetch the candidates
                const firstUser = data.conversationHistory.find((m) => m.role === 'user');
                if (firstUser) {
                    await stream.submitTurn({
                        userMessage: firstUser.content,
                        destination: data.trip.city,
                        dates: data.trip.dates,
                    });
                }
                stream.setPickedPois(data.trip.pickedPois);
            } catch (err) {
                console.error('load-trip failed', err);
            }
        },
        [stream],
    );

    const elicitSlot = stream.elicit ? (
        <ElicitChipCard spec={stream.elicit} onSubmit={submitElicit} />
    ) : null;

    const followupSlot = useMemo(() => {
        if (stream.running) {
            return (
                <div className="agent-status">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="agent-status-text">Working on it…</span>
                </div>
            );
        }
        if (stream.suggestedActions.length) {
            return (
                <div className="followup-chips">
                    {stream.suggestedActions.map((chip) => (
                        <button
                            key={chip}
                            className="followup-chip"
                            onClick={() => submitFreeForm(chip)}
                        >
                            {chip}
                        </button>
                    ))}
                </div>
            );
        }
        return null;
    }, [stream.suggestedActions, stream.running, submitFreeForm]);

    const canvasEmpty =
        stream.pois.length === 0 && !stream.weather && !stream.running && !stream.error;

    return (
        <div className="app">
            <header className="header">
                <div className="header-left">
                    <button
                        className="hamburger"
                        aria-label="Open memory drawer"
                        aria-expanded={drawerOpen}
                        onClick={() => setDrawerOpen(true)}
                    >
                        ☰
                    </button>
                    <h1>Trip Itinerary Builder</h1>
                </div>
                <div className="header-user">
                    <span>Ashwin</span>
                </div>
            </header>
            <div className="main">
                <main className="canvas">
                    {canvasEmpty && (
                        <div className="canvas-empty">
                            <h2>Plan your trip</h2>
                            <p>
                                Type a prompt in the sidebar — try{' '}
                                <em>"Plan a trip to Bangalore"</em>.
                            </p>
                        </div>
                    )}
                    {stream.error && (
                        <div
                            style={{
                                color: 'var(--red)',
                                padding: 12,
                                border: '1px solid var(--red)',
                                borderRadius: 3,
                                marginBottom: 16,
                            }}
                        >
                            Error: {stream.error}
                        </div>
                    )}
                    {stream.weather && <WeatherCard weather={stream.weather} />}
                    {stream.pois.length > 0 && (
                        <>
                            <PlanAccordion
                                picked={stagedPois}
                                onRemovePick={removePick}
                                onSave={handleSave}
                                saving={saving}
                                savedAt={savedAt}
                                canMarkComplete={pickedPois.length > 0 && !stagedDiffers}
                                onUpdatePlan={handleUpdatePlan}
                                canUpdatePlan={stagedDiffers && !stream.running}
                            >
                                <PointOfInterestGrid
                                    pois={gridPois}
                                    pickedIds={stagedIds}
                                    sortByIds={pickedIds}
                                    onToggle={togglePick}
                                />
                            </PlanAccordion>
                            <LiveRouteMap picked={stagedPois} />
                        </>
                    )}
                </main>
                <ChatSidebar
                    conversation={stream.conversation}
                    elicitSlot={elicitSlot}
                    followupSlot={followupSlot}
                    inputSlot={<PromptInput onSubmit={submitFreeForm} disabled={stream.running} />}
                />
            </div>
            <MemoryDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                onLoadTrip={handleLoadTrip}
            />
        </div>
    );
}
