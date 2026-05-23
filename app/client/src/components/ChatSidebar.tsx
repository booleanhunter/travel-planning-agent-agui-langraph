import { Fragment, type ReactNode } from "react";
import type { DotStatus } from "../types";

interface ConversationEntry {
  role: "user" | "assistant";
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
  TravelAgent:  "Understanding your request",
  FetchRecs:    "Searching for places",
  FetchWeather: "Looking up weather",
  FollowUp:     "Composing response",
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
              Hi Ashwin. Try <em>"Plan a trip to Bangalore"</em> to get started.
            </div>
          </div>
        )}

        {conversation.map((m, i) => (
          <Fragment key={i}>
            <div className={`msg msg-${m.role}`}>
              <div className="msg-bubble">{m.content}</div>
            </div>
            {m.role === "user" && m.dots && <DotsBlock dots={m.dots} />}
          </Fragment>
        ))}

        {elicitSlot}
        {followupSlot}
      </div>
      <div className="sidebar-input-wrap">{inputSlot}</div>
    </aside>
  );
}
