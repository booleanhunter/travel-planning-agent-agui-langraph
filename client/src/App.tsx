import { CanvasArea } from './features/canvas/CanvasArea.tsx';
import { ChatSidebar } from './features/chat/ChatSidebar.tsx';

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
                    <CanvasArea />
                </section>
                <ChatSidebar />
            </main>
        </div>
    );
}
