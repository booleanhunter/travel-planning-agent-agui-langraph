import { z } from "zod";
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { getChatModel } from "../../lib/llm.js";
import { searchUserPreferences, getConversation } from "../../memory/ams-client.js";
import type { AgentStateType } from "../state.js";

const TravelAgentOutput = z.object({
  acknowledgment: z.string().describe(
    "A short, friendly, conversational acknowledgment for the user — 1 sentence. Shown as a chat bubble immediately, before any data is fetched. Example: \"Got it, let me look at Bangalore for you.\" Do NOT promise specific places or weather — that comes later."
  ),
  intent: z.enum(["plan", "pack", "continue"]).describe(
    'Classification of what the user is doing this turn. "plan" = asking to plan or refine a trip. "pack" = asking about packing or preparation. "continue" = filling out a previous form / replying to a previous question (e.g. submission like "Here\'s what I picked from the form.").',
  ),
  destination: z.enum(["bangalore", "mumbai", "barcelona"]).nullable().describe(
    "City being planned. null if not mentioned in this turn AND not visible in the prior conversation.",
  ),
  dates: z.object({ start: z.string(), end: z.string() }).nullable().describe(
    "Travel dates as ISO YYYY-MM-DD strings. Resolve relative dates (\"next week\", \"May 20\") against today. null if unknown.",
  ),
  interests: z.array(z.string()).describe(
    "Short interest descriptors the user articulated this turn (e.g. food, slow, indie, moody, landmarks). Empty array if none mentioned.",
  ),
});

const SYSTEM_PROMPT = (today: string) => `You are a friendly travel agent helping plan trips to one of three cities: Bangalore, Mumbai, or Barcelona.
Today's date is ${today}.

Your job on each turn is to:
1. Acknowledge what the user said in 1 conversational sentence (acknowledgment field). Don't make promises about places or weather — those land in a later step.
2. Classify their intent: "plan" (new or refined trip), "pack" (packing / preparation), "continue" (replying to a previous form / question).
3. Extract any slots they mentioned: destination, dates, interests. Use the prior conversation context to fill in slots they mentioned earlier in this session.

Resolve relative dates against today (${today}). Return null for any slot not stated in this turn AND not in prior context.`;

export async function travelAgent(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const [prefs, conv] = await Promise.all([
    searchUserPreferences(state.userId).catch(() => undefined),
    getConversation(state.sessionId).catch(() => null),
  ]);

  const today = new Date().toISOString().split("T")[0];

  const priorMessages: BaseMessage[] = (conv?.messages ?? []).map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );

  const messages: BaseMessage[] = [
    new SystemMessage(SYSTEM_PROMPT(today)),
    ...priorMessages,
    new HumanMessage(state.userMessage),
  ];

  const llm = getChatModel().withStructuredOutput(TravelAgentOutput, { name: "travel_agent" });
  const out = await llm.invoke(messages);

  // Priority for slot merge: this turn's extraction > carried-in client state > memory
  const memInterests = prefs?.recurringInterests ?? [];
  const interests = out.interests.length
    ? out.interests
    : state.interests.length
      ? state.interests
      : memInterests;

  return {
    intent: out.intent,
    destination: out.destination ?? state.destination,
    dates: out.dates ?? state.dates,
    interests,
    preferences: prefs ?? state.preferences,
    response: out.acknowledgment,  // acknowledgment rides through the standard response channel
  };
}
