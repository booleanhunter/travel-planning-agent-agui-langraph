import { useCallback, useMemo, useState } from "react";
import { useAgentStream } from "./hooks/useAgentStream";
import { PromptInput } from "./components/PromptInput";
import { ChatSidebar } from "./components/ChatSidebar";
import { ElicitChipCard } from "./components/ElicitChipCard";
import { PointOfInterestGrid } from "./components/PointOfInterestGrid";
import { PlanAccordion } from "./components/PlanAccordion";
import { LiveRouteMap } from "./components/LiveRouteMap";
import { WeatherCard } from "./components/WeatherCard";
import { MemoryDrawer } from "./components/MemoryDrawer";
import type { POI, PastTrip, City, PickedPoi } from "./types";

const USER_ID = "ashwin";

export function App() {
  const stream = useAgentStream();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const pickedPois = stream.pickedPois;
  const pickedIds = useMemo(() => pickedPois.map((p) => p.poiId), [pickedPois]);
  // Full POI objects for the route map (needs lat/lng). When state.pois is empty
  // (e.g. after load-past-trip before a fresh fetch) the strip still shows names
  // from pickedPois, just the map won't render markers.
  const pickedFullPois: POI[] = useMemo(
    () => stream.pois.filter((p) => pickedIds.includes(p.id)),
    [stream.pois, pickedIds],
  );

  const togglePick = useCallback(
    (poi: POI) => {
      stream.setPickedPois((picks) => {
        const exists = picks.some((p) => p.poiId === poi.id);
        return exists
          ? picks.filter((p) => p.poiId !== poi.id)
          : [...picks, { poiId: poi.id, name: poi.name }];
      });
    },
    [stream],
  );

  const removePick = useCallback(
    (poiId: string) =>
      stream.setPickedPois((picks) => picks.filter((p) => p.poiId !== poiId)),
    [stream],
  );

  const submitFreeForm = useCallback((text: string) => stream.submitTurn({ userMessage: text }), [stream]);

  const submitElicit = useCallback(
    (values: Record<string, unknown>) => {
      const destination = values.destination as City | undefined;
      const datesRaw = values.dates as { start?: string; end?: string } | undefined;
      const dates = datesRaw?.start && datesRaw?.end
        ? { start: datesRaw.start, end: datesRaw.end }
        : undefined;
      const interests = values.interests as string[] | undefined;

      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      const sentences: string[] = [];
      if (destination)       sentences.push(`My destination is ${cap(destination)}.`);
      if (dates)             sentences.push(`I plan to travel from ${dates.start} to ${dates.end}.`);
      if (interests?.length) sentences.push(`I am interested in ${interests.join(", ")}.`);

      const userMessage = sentences.length
        ? "Here are the details: " + sentences.join(" ")
        : "Here are the details from the form.";

      stream.submitTurn({ userMessage, destination, dates, interests });
    },
    [stream],
  );

  const handleSave = useCallback(async () => {
    if (pickedPois.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/user/save-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID, tripId: stream.sessionId }),
      });
      if (res.ok) setSavedAt(new Date().toLocaleTimeString());
    } finally {
      setSaving(false);
    }
  }, [pickedPois.length, stream.sessionId]);

  const handleLoadTrip = useCallback(async (trip: PastTrip) => {
    setDrawerOpen(false);
    stream.resetCanvas();
    try {
      const res = await fetch("/api/user/load-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID, tripId: trip.tripId }),
      });
      if (!res.ok) return;
      const data = await res.json() as {
        trip: PastTrip;
        conversationHistory: Array<{ role: string; content: string }>;
      };
      // Best-effort rehydrate: replay user's first message to refetch the candidates
      const firstUser = data.conversationHistory.find((m) => m.role === "user");
      if (firstUser) {
        await stream.submitTurn({
          userMessage: firstUser.content,
          destination: data.trip.city,
          dates: data.trip.dates,
        });
      }
      stream.setPickedPois(data.trip.pickedPois);
    } catch (err) {
      console.error("load-trip failed", err);
    }
  }, [stream]);

  const elicitSlot = stream.elicit ? (
    <ElicitChipCard spec={stream.elicit} onSubmit={submitElicit} />
  ) : null;

  const followupSlot = useMemo(() => {
    if (!stream.suggestedActions.length || stream.running) return null;
    return (
      <div className="followup-chips">
        {stream.suggestedActions.map((chip) => (
          <button key={chip} className="followup-chip" onClick={() => submitFreeForm(chip)}>
            {chip}
          </button>
        ))}
      </div>
    );
  }, [stream.suggestedActions, stream.running, submitFreeForm]);

  const canvasEmpty = stream.pois.length === 0 && !stream.weather && !stream.running && !stream.error;

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
              <p>Type a prompt in the sidebar — try <em>"Plan a trip to Bangalore"</em>.</p>
            </div>
          )}
          {stream.error && (
            <div style={{ color: "var(--red)", padding: 12, border: "1px solid var(--red)", borderRadius: 3, marginBottom: 16 }}>
              Error: {stream.error}
            </div>
          )}
          {stream.weather && <WeatherCard weather={stream.weather} />}
          {stream.pois.length > 0 && (
            <>
              <PlanAccordion
                picked={pickedPois}
                onRemovePick={removePick}
                onSave={handleSave}
                saving={saving}
                savedAt={savedAt}
              >
                <PointOfInterestGrid pois={stream.pois} pickedIds={pickedIds} onToggle={togglePick} />
              </PlanAccordion>
              <LiveRouteMap picked={pickedFullPois} />
            </>
          )}
        </main>
        <ChatSidebar
          conversation={stream.conversation}
          dots={stream.dots}
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
