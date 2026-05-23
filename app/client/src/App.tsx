import { useCallback, useMemo } from "react";
import { useAgentStream } from "./hooks/useAgentStream";
import { PromptInput } from "./components/PromptInput";
import { ChatSidebar } from "./components/ChatSidebar";
import { ElicitChipCard } from "./components/ElicitChipCard";
import { PointOfInterestGrid } from "./components/PointOfInterestGrid";
import { ComposedItineraryPane } from "./components/ComposedItineraryPane";
import { LiveRouteMap } from "./components/LiveRouteMap";
import { WeatherCard } from "./components/WeatherCard";
import type { POI } from "./types";

export function App() {
  const stream = useAgentStream();

  // Picked POIs are derived from stream.pois (most recent set) intersected with pickedIds.
  // pickedIds is client-side state — survives across turns within the session.
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
      const destination = (values.destination as POI["city"] | undefined) ?? undefined;
      const datesRaw = values.dates as { start?: string; end?: string } | undefined;
      const dates = datesRaw?.start && datesRaw?.end
        ? { start: datesRaw.start, end: datesRaw.end }
        : undefined;
      const interests = (values.interests as string[] | undefined) ?? undefined;
      stream.submitTurn({
        userMessage: "Here's what I picked from the form.",
        destination,
        dates,
        interests,
      });
    },
    [stream],
  );

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

  const canvasEmpty = stream.pois.length === 0 && !stream.weather && !stream.running;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <button className="hamburger" aria-label="Open memory drawer">☰</button>
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
            <div style={{ color: "var(--red)", padding: 12, border: "1px solid var(--red)", borderRadius: 3 }}>
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
    </div>
  );
}
