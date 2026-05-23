import { useCallback, useMemo, useState } from "react";
import { useAgentStream } from "./hooks/useAgentStream";
import { PromptInput } from "./components/PromptInput";
import { ChatSidebar } from "./components/ChatSidebar";
import type { City } from "./types";

export function App() {
  const stream = useAgentStream();
  const [destination, setDestination] = useState<City | undefined>();
  const [dates, setDates] = useState<{ start: string; end: string } | undefined>();
  const [interests, setInterests] = useState<string[]>([]);
  const [pickedPoiIds, setPickedPoiIds] = useState<string[]>([]);

  // Sync server-confirmed slot values from STATE_SNAPSHOT
  // (the graph returns the resolved destination/dates/interests after RouteIntent)
  // We trust the server here — keep client-side state minimal.

  const submit = useCallback(
    (text: string) =>
      stream.submitTurn({
        userMessage: text,
        destination,
        dates,
        interests,
        pickedPoiIds,
      }),
    [stream, destination, dates, interests, pickedPoiIds],
  );

  const followupSlot = useMemo(() => {
    if (!stream.suggestedActions.length || stream.running) return null;
    return (
      <div className="followup-chips">
        {stream.suggestedActions.map((chip) => (
          <button key={chip} className="followup-chip" onClick={() => submit(chip)}>
            {chip}
          </button>
        ))}
      </div>
    );
  }, [stream.suggestedActions, stream.running, submit]);

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
          {stream.pois.length === 0 && !stream.weather && (
            <div className="canvas-empty">
              <h2>Plan your trip</h2>
              <p>Type a prompt in the sidebar — try <em>"Plan a trip to Bangalore"</em>.</p>
            </div>
          )}
          {stream.error && <div style={{ color: "var(--red)" }}>Error: {stream.error}</div>}
          {stream.pois.length > 0 && (
            <div>
              <div className="section-title">Places</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {stream.pois.length} candidates. Detailed grid + composed itinerary coming next.
              </div>
            </div>
          )}
        </main>
        <ChatSidebar
          conversation={stream.conversation}
          dots={stream.dots}
          followupSlot={followupSlot}
          inputSlot={<PromptInput onSubmit={submit} disabled={stream.running} />}
        />
      </div>
    </div>
  );
}
