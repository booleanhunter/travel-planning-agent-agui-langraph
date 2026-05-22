import { ChatSidebar } from './features/chat/ChatSidebar.tsx';

// userId / sessionId wiring lands in Phase 1 once the canvas mounts via
// useAgent and we plumb them into agent state through provider properties.
export default function App() {
    return (
        <div className="app">
            <header className="header">
                <div className="header-brand">
                    <button className="hamburger" aria-label="Open memory drawer" type="button">
                        <i className="ti ti-menu-2" aria-hidden="true" />
                    </button>
                    <div className="header-brand-mark">
                        <i className="ti ti-route" aria-hidden="true" />
                    </div>
                    <h1 className="header-title">Trip itinerary builder</h1>
                </div>
                <div className="header-user">
                    <span className="header-user-avatar">A</span>
                    <span>Ashwin</span>
                </div>
            </header>

            <main className="layout">
                <section className="canvas" aria-label="Trip workspace">
                    <div className="canvas-empty">
                        <i className="ti ti-map-pin canvas-empty-icon" aria-hidden="true" />
                        <p className="canvas-empty-text">
                            POI cards and your composed itinerary will appear here once you start a
                            trip.
                        </p>
                    </div>
                </section>
                <ChatSidebar />
            </main>
        </div>
    );
}
