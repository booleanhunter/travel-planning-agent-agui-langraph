import { Fragment, type ReactNode } from 'react';
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

const NODE_LABEL: Record<string, string> = {
    TravelAgent: 'Understanding your request',
    FollowUp: 'Composing response',
    // Tool dots (reserved for a follow-up that wires tool-level streaming via
    // graph.stream({ streamMode: ['updates', 'tools'] })). Labels pre-defined
    // so the UI is ready when those events start firing.
    'tool:searchPois': 'Searching for places',
    'tool:getPoiDetails': 'Looking up place',
    'tool:getWeather': 'Looking up weather',
    'tool:updateItinerary': 'Updating itinerary',
};

function DotsBlock({ dots }: { dots: Record<string, DotStatus> }) {
    const entries = Object.entries(dots);
    if (!entries.length) return null;
    return (
        <div className="toolrow-list">
            {entries.map(([name, status]) => (
                <div key={name} className="toolrow">
                    <span className={`toolrow-dot ${status}`} />
                    <span>{NODE_LABEL[name] ?? name}</span>
                </div>
            ))}
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
                            Hi Ashwin. Try <em>"plan a trip"</em> to get started.
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
