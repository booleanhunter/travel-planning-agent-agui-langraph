import { z } from "zod";
import { getChatModel } from "../../lib/llm.js";
import { searchUserPreferences, getConversation } from "../../memory/ams-client.js";
import type { AgentStateType } from "../state.js";

const SlotExtraction = z.object({
  destination: z.enum(["bangalore", "mumbai", "barcelona"]).nullable(),
  dates: z.object({ start: z.string(), end: z.string() }).nullable(),
  interests: z.array(z.string()),
  intent: z.enum(["plan", "pack", "refine", "other"]),
});

export async function routeIntent(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const [prefs, conv] = await Promise.all([
    searchUserPreferences(state.userId).catch(() => undefined),
    getConversation(state.sessionId).catch(() => null),
  ]);

  const llm = getChatModel().withStructuredOutput(SlotExtraction, { name: "extract_trip_slots" });
  const today = new Date().toISOString().split("T")[0];

  const recentTurns = (conv?.messages ?? [])
    .slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const prompt = `You extract structured trip details from the user's message.
Today's date is ${today}.
Resolve relative dates ("next week", "May 20") to absolute YYYY-MM-DD ISO strings.
Supported destinations: bangalore, mumbai, barcelona. Pick the closest match or null.
Output an array of interest descriptors (short tags like "food", "slow", "indie", "moody", "landmarks").
Intent: "plan" (new trip), "pack" (asking about packing/preparation), "refine" (adjusting vibe), "other".

${recentTurns ? `Recent conversation:\n${recentTurns}\n\n` : ""}User message: ${state.userMessage}`;

  const extracted = await llm.invoke(prompt);

  // Memory-sourced interests fill in only if the user didn't articulate any
  const memInterests = prefs?.recurringInterests ?? [];
  const interests = extracted.interests.length ? extracted.interests : memInterests;

  return {
    destination: extracted.destination ?? state.destination,
    dates: extracted.dates ?? state.dates,
    interests,
    intent: extracted.intent,
    preferences: prefs ?? state.preferences,
  };
}
