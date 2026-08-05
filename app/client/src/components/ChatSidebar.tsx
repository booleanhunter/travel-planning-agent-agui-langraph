import { Fragment, useRef, type ReactNode } from 'react';
import type { DotStatus } from '../types';

interface ConversationEntry {
    role: 'user' | 'assistant';
    content: string;
    dots?: Record<string, DotStatus>;
}

interface Props {
    conversation: ConversationEntry[];
    /** Inline elicit card (rendered between turns when slots are missing) */
    elicitSlot?: ReactNode;
    /** Follow-up chips slot (rendered after the agent's last response) */
    followupSlot?: ReactNode;
    /** Prompt input slot (footer) */
    inputSlot: ReactNode;
}

// A node's label is either a fixed string or a pool — when it's a pool,
// we pick one entry at random per turn (cached per dot so the choice
// doesn't re-roll on status changes). Pools keep the dot row from
// reading the same on every turn.
const NODE_LABEL: Record<string, string | string[]> = {
    ContextRetriever: [
        'Applying your preferences',
        'Skimming through the chat',
        'Reviewing our conversation',
    ],
    TravelAgent: [
        'Understanding your request',
        'Thinking it through',
        'Working things out',
    ],
    FollowUp: ['Putting it together', 'Lining up next steps', 'Drafting next steps'],
    // Tool dots (reserved for a follow-up that wires tool-level streaming via
    // graph.stream({ streamMode: ['updates', 'tools'] })). Labels pre-defined
    // so the UI is ready when those events start firing.
    'tool:searchPois': 'Searching for places',
    'tool:getPoiDetails': 'Looking up place',
    'tool:getWeather': 'Looking up weather',
    'tool:updateItinerary': 'Updating itinerary',
};

function labelFor(name: string): string {
    const entry = NODE_LABEL[name];
    if (Array.isArray(entry)) {
        return entry[Math.floor(Math.random() * entry.length)];
    }
    return entry ?? name;
}

function DotsBlock({ dots }: { dots: Record<string, DotStatus> }) {
    const entries = Object.entries(dots);
    // Cache the picked label per dot name so the random pick doesn't
    // re-roll on every status change (pending → active → done would
    // otherwise flicker between pool entries).
    const labelCache = useRef<Map<string, string>>(new Map());
    if (!entries.length) return null;
    return (
        <div className="toolrow-list">
            {entries.map(([name, status]) => {
                let label = labelCache.current.get(name);
                if (!label) {
                    label = labelFor(name);
                    labelCache.current.set(name, label);
                }
                return (
                    <div key={name} className="toolrow">
                        <span className={`toolrow-dot ${status}`} />
                        <span>{label}</span>
                    </div>
                );
            })}
        </div>
    );
}

export function ChatSidebar({ conversation, elicitSlot, followupSlot, inputSlot }: Props) {
    return (
        <aside className="sidebar">
            <div className="sidebar-messages">
                {conversation.length === 0 && !elicitSlot && (
                    <div className="msg msg-agent">
                        <div className="msg-bubble">
                            Hi Ashwin 👋. Looking to plan your next trip?
                            <ul className="capabilities">
                                <li>Plan a trip to any city in the catalogue</li>
                                <li>Find places to visit and check the weather</li>
                                <li>Build a day-by-day itinerary</li>
                                <li>Save the trip to your Google Calendar</li>
                            </ul>
                        </div>
                    </div>
                )}

                {conversation.map((entry, index) => (
                    <Fragment key={index}>
                        <div className={`msg msg-${entry.role}`}>
                            <div className="msg-bubble">{entry.content}</div>
                        </div>
                        {entry.role === 'user' && entry.dots && <DotsBlock dots={entry.dots} />}
                    </Fragment>
                ))}

                {elicitSlot}
                {followupSlot}
            </div>
            <div className="sidebar-input-wrap">{inputSlot}</div>
        </aside>
    );
}
