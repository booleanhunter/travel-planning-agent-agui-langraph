import type { ReactNode } from "react";
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
  RouteIntent: "extracting slots…",
  FetchRecs: "searching places",
  FetchWeather: "looking up weather",
  FinalizePlan: "composing response",
  FinalizeElicit: "asking for details",
};

export function ChatSidebar({ conversation, dots, elicitSlot, followupSlot, inputSlot }: Props) {
  const dotEntries = Object.entries(dots);

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
          <div key={i} className={`msg msg-${m.role}`}>
            <div className="msg-bubble">{m.content}</div>
          </div>
        ))}

        {dotEntries.length > 0 && (
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
        )}

        {elicitSlot}
        {followupSlot}
      </div>
      <div className="sidebar-input-wrap">{inputSlot}</div>
    </aside>
  );
}
