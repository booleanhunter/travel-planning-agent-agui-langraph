/**
 * CanvasArea — the main work surface on the left ~75% of the screen.
 *
 * Owns the three canvas states keyed off agent message + itinerary state:
 *   1. Welcome (no messages yet) — the "Where are you going?" intro, example
 *      prompts, and recalled-memory strip. Matches the prototype.
 *   2. Itinerary placeholder (messages exist, no POIs pinned yet) — temporary;
 *      lives here until the POI / itinerary panes land in task #5.
 *   3. (Future) Composed itinerary — POI grid, day-by-day pane, map.
 *
 * Component lives outside ChatSidebar so the canvas can read agent state
 * directly via `useAgent` without prop-drilling.
 */

import { useAgent } from '@copilotkit/react-core/v2';
import { AGENT_ID } from '../chat/agent-id.ts';

const EXAMPLE_PROMPTS = [
    'Plan a trip to Barcelona',
    '5 days in Lisbon, lots of local food',
    'A slow week in indie coffee shops and bookshops',
];

// Stub: in the real demo this would be read from the Agent Memory Server. For
// the welcome state we just want the prototype's recalled-memory strip to look
// right; wiring the real preferences happens after the user-state pipeline.
const MEMORY_PREVIEW = ['foodie', 'solo', 'mid budget', '4 past trips'];

export function CanvasArea() {
    const { agent } = useAgent({ agentId: AGENT_ID });
    const messages = agent?.messages ?? [];

    if (messages.length === 0) {
        return <CanvasWelcome onPick={(text) => sendPrompt(agent, text)} />;
    }
    return <CanvasItineraryPlaceholder />;
}

interface CanvasWelcomeProps {
    onPick: (text: string) => void;
}

function CanvasWelcome({ onPick }: CanvasWelcomeProps) {
    return (
        <div className="canvas-welcome">
            <p className="canvas-welcome-eyebrow">Trip planner</p>
            <h2 className="canvas-welcome-heading">Where are you going?</h2>
            <p className="canvas-welcome-description">
                One sentence is enough. I'll figure out what's still missing and ask only for
                that — plus tune to the kind of day you're after.
            </p>
            <ul className="canvas-welcome-prompts" aria-label="Example prompts">
                {EXAMPLE_PROMPTS.map((text) => (
                    <li key={text}>
                        <button type="button" className="chip" onClick={() => onPick(text)}>
                            {text}
                        </button>
                    </li>
                ))}
            </ul>
            <p className="canvas-welcome-memory" role="status">
                <span className="canvas-welcome-memory-dot" aria-hidden="true" />
                <span className="canvas-welcome-memory-label">memory recalled</span>
                {MEMORY_PREVIEW.map((tag) => (
                    <span key={tag} className="canvas-welcome-memory-tag">
                        · {tag}
                    </span>
                ))}
            </p>
        </div>
    );
}

function CanvasItineraryPlaceholder() {
    return (
        <div className="canvas-empty">
            <i className="ti ti-map-pin canvas-empty-icon" aria-hidden="true" />
            <p className="canvas-empty-text">
                POI cards and your composed itinerary will appear here once you start a trip.
            </p>
        </div>
    );
}

type AgentRef = ReturnType<typeof useAgent>['agent'];

async function sendPrompt(agent: AgentRef, text: string): Promise<void> {
    if (!agent) return;
    agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: text });
    try {
        await agent.runAgent();
    } catch (err) {
        console.error('[canvas] agent run failed', err);
    }
}
