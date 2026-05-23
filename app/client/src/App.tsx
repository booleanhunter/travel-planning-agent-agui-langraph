import { useCallback, useMemo, useState } from "react";
import { useAgentStream } from "./hooks/useAgentStream";
import { PromptInput } from "./components/PromptInput";
import { ChatSidebar } from "./components/ChatSidebar";
import { ElicitChipCard } from "./components/ElicitChipCard";
import { PointOfInterestGrid } from "./components/PointOfInterestGrid";
import { ComposedItineraryPane } from "./components/ComposedItineraryPane";
import { LiveRouteMap } from "./components/LiveRouteMap";
import { WeatherCard } from "./components/WeatherCard";
import { MemoryDrawer } from "./components/MemoryDrawer";
import type { POI, PastTrip, City } from "./types";

const USER_ID = "ashwin";

export function App() {
  const stream = useAgentStream();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const pickedIds = stream.pickedIds;
  const picked: POI[] = useMemo(
    () => stream.pois.filter((p) => pickedIds.includes(p.id)),
    [stream.pois, pickedIds],
  );

  const togglePick = useCallback(
    (poi: POI) => {
      stream.setPickedIds((ids) =>
        ids.includes(poi.id) ? ids.filter((id) => id !== poi.id) : [...ids, poi.id],
      );
    },
    [stream],
  );

  const removePick = useCallback(
    (id: string) => stream.setPickedIds((ids) => ids.filter((x) => x !== id)),
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

  // Determine the city from the most recent POIs (server-confirmed)
  const currentCity: City | undefined = stream.pois[0]?.city;

  const handleSave = useCallback(async () => {
    if (!currentCity || picked.length === 0) return;
    setSaving(true);
    try {
      const body = {
        userId: USER_ID,
        sessionId: stream.sessionId,
        city: currentCity,
        dates: undefined,  // could capture from elicit submission if needed
        pickedPoiIds: pickedIds,
        summary: stream.response || `${picked.length} places in ${currentCity}`,
      };
      const res = await fetch("/api/user/save-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSavedAt(new Date().toLocaleTimeString());
      }
    } finally {
      setSaving(false);
    }
  }, [currentCity, picked.length, pickedIds, stream.response, stream.sessionId]);

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
        pickedPois: POI[];
      };
      // Best-effort rehydrate: replay user's first message to repopulate canvas
      const firstUser = data.conversationHistory.find((m) => m.role === "user");
      if (firstUser) {
        await stream.submitTurn({
          userMessage: firstUser.content,
          destination: data.trip.city,
          dates: data.trip.dates,
        });
      }
      stream.setPickedIds(data.trip.pickedPoiIds);
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
              <div className="section-title">Places</div>
              <PointOfInterestGrid pois={stream.pois} pickedIds={pickedIds} onToggle={togglePick} />
              <ComposedItineraryPane picked={picked} onRemove={removePick} />
              <LiveRouteMap picked={picked} />
              {picked.length > 0 && (
                <button
                  className="save-trip"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "Saving…" : savedAt ? `Saved at ${savedAt} — save again` : "Save this trip"}
                </button>
              )}
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
