import { useCallback, useEffect, useRef, useState } from "react";
import { HttpAgent, type AgentSubscriber } from "@ag-ui/client";
import type { POI, Weather, ElicitSpec, DotStatus, City } from "../types";

interface AgentTurnInput {
  userMessage: string;
  destination?: City;
  dates?: { start: string; end: string };
  interests?: string[];
  pickedPoiIds?: string[];
}

interface AgentStream {
  pois: POI[];
  weather: Weather | null;
  elicit: ElicitSpec | null;
  response: string;
  suggestedActions: string[];
  dots: Record<string, DotStatus>;
  running: boolean;
  error: string | null;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  submitTurn: (input: AgentTurnInput) => Promise<void>;
  resetCanvas: () => void;
}

const USER_ID = "ashwin";

function newSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useAgentStream(): AgentStream & { sessionId: string; setSessionId: (id: string) => void } {
  const [sessionId, setSessionId] = useState<string>(() => newSessionId());
  const agentRef = useRef<HttpAgent | null>(null);

  const [pois, setPois] = useState<POI[]>([]);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [elicit, setElicit] = useState<ElicitSpec | null>(null);
  const [response, setResponse] = useState<string>("");
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
  const [dots, setDots] = useState<Record<string, DotStatus>>({});
  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);

  useEffect(() => {
    agentRef.current = new HttpAgent({ url: "/api/chat" });
  }, []);

  const applyDelta = useCallback((delta: Record<string, unknown>) => {
    if (delta.pois !== undefined) setPois(delta.pois as POI[]);
    if (delta.weather !== undefined) setWeather(delta.weather as Weather);
    if (delta.elicit !== undefined) setElicit(delta.elicit as ElicitSpec);
    if (delta.response !== undefined) setResponse(delta.response as string);
    if (delta.suggestedActions !== undefined) setSuggestedActions(delta.suggestedActions as string[]);
  }, []);

  const resetCanvas = useCallback(() => {
    setPois([]);
    setWeather(null);
    setElicit(null);
    setResponse("");
    setSuggestedActions([]);
    setDots({});
    setConversation([]);
    setError(null);
    setSessionId(newSessionId());
  }, []);

  const submitTurn = useCallback(
    async (input: AgentTurnInput) => {
      const agent = agentRef.current;
      if (!agent) return;

      setRunning(true);
      setError(null);
      setElicit(null);
      setDots({});

      // append user message to local transcript
      setConversation((prev) => [...prev, { role: "user", content: input.userMessage }]);

      const stateToSend: Record<string, unknown> = { userId: USER_ID };
      if (input.destination) stateToSend.destination = input.destination;
      if (input.dates) stateToSend.dates = input.dates;
      if (input.interests?.length) stateToSend.interests = input.interests;
      if (input.pickedPoiIds?.length) stateToSend.pickedPoiIds = input.pickedPoiIds;

      agent.threadId = sessionId;
      agent.setMessages([
        ...conversation.map((m) => ({ id: `${Date.now()}`, role: m.role, content: m.content })),
        { id: `${Date.now()}-u`, role: "user", content: input.userMessage },
      ]);
      agent.setState(stateToSend);

      const subscriber: AgentSubscriber = {
        onStepStartedEvent: ({ event }) => {
          setDots((d) => ({ ...d, [event.stepName]: "pending" }));
        },
        onStepFinishedEvent: ({ event }) => {
          setDots((d) => ({ ...d, [event.stepName]: "done" }));
        },
        onStateSnapshotEvent: ({ event }) => {
          const snapshot = event.snapshot as Record<string, unknown>;
          if (snapshot && typeof snapshot === "object") applyDelta(snapshot);
        },
        onRunFinishedEvent: () => {
          // capture the agent response into the transcript
          setResponse((respText) => {
            if (respText) {
              setConversation((prev) => [...prev, { role: "assistant", content: respText }]);
            }
            return respText;
          });
        },
        onRunErrorEvent: ({ event }) => {
          setError(event.message ?? "Unknown error");
        },
      };

      try {
        await agent.runAgent({}, subscriber);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setRunning(false);
      }
    },
    [applyDelta, conversation, sessionId],
  );

  return {
    pois,
    weather,
    elicit,
    response,
    suggestedActions,
    dots,
    running,
    error,
    conversation,
    submitTurn,
    resetCanvas,
    sessionId,
    setSessionId,
  };
}
