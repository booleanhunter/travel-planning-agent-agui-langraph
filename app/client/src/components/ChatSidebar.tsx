import { Fragment, type ReactNode } from "react";
import type { DotStatus } from "../types";

interface Props {
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  dots: Record<string, DotStatus>;
  /** Inline elicit card (rendered between turns when slots are missing) */
  elicitSlot?: ReactNode;
  /** Follow-up chips slot (rendered after the agent's last response) */
  followupSlot?: ReactNode;
  /** Prompt input slot (footer) */
  inputSlot: ReactNode;
}

const NODE_LABEL: Record<string, string> = {
  TravelAgent:  "extracting slots…",
  FetchRecs:    "searching places",
  FetchWeather: "looking up weather",
  FollowUp:     "composing response",
};

export function ChatSidebar({ conversation, dots, elicitSlot, followupSlot, inputSlot }: Props) {
  const dotEntries = Object.entries(dots);

  // Index of the most recent user message — dots render right after it,
  // so the visual flow is: user msg → tool-row dots → assistant msg.
  let lastUserIndex = -1;
  for (let i = conversation.length - 1; i >= 0; i--) {
    if (conversation[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  const dotsBlock = dotEntries.length > 0 ? (
    <div className="toolrow-list">
      {dotEntries.map(([name, status]) => (
        <div key={name} className="toolrow">
          <span className={`toolrow-dot ${status}`} />
          <span>{name}</span>
          <span style={{ marginLeft: "auto", color: "var(--text-soft)" }}>
            {status === "pending" ? NODE_LABEL[name] ?? "…" : ""}
          </span>
        </div>
      ))}
    </div>
  ) : null;

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
            {i === lastUserIndex && dotsBlock}
          </Fragment>
        ))}

        {/* If the latest entry IS a user message, dots render above via lastUserIndex.
            If there are no conversation entries yet but a run is mid-flight (rare), drop them at the bottom. */}
        {lastUserIndex === -1 && dotsBlock}

        {elicitSlot}
        {followupSlot}
      </div>
      <div className="sidebar-input-wrap">{inputSlot}</div>
    </aside>
  );
}
