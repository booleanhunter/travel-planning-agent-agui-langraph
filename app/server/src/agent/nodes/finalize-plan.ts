import { getChatModel } from "../../lib/llm.js";
import { appendTurn } from "../../memory/ams-client.js";
import type { AgentStateType } from "../state.js";

export async function finalizePlan(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const llm = getChatModel();
  const w = state.weather;
  const isPack = state.intent === "pack";

  const summaryPrompt = isPack
    ? `Suggest a short packing list (5-7 items) for a trip to ${state.destination}, dates ${state.dates?.start} to ${state.dates?.end}.
Weather: ${w?.condition} (${w?.high}°/${w?.low}°C, ${Math.round((w?.precipitationChance ?? 0) * 100)}% chance of rain).
Interests: ${state.interests.join(", ")}.
Format as a brief comma-separated list. Under 50 words total.`
    : `You're a friendly trip planner. The user wants to visit ${state.destination} (${state.dates?.start} to ${state.dates?.end}).
Weather: ${w?.condition} (${w?.high}°/${w?.low}°C). Interests: ${state.interests.join(", ")}.
I've surfaced ${state.pois.length} candidate places. Write a brief one-paragraph response acknowledging the plan and inviting them to pick. Under 50 words.`;

  const response = await llm.invoke(summaryPrompt);
  const responseText = typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);

  const suggestedActions = isPack
    ? ["Refine the vibe", "Save this trip"]
    : ["What should I pack?", "Make it more relaxed", "Save this trip"];

  // Fire-and-forget: append the turn to AMS working memory
  appendTurn(state.sessionId, state.userId, [
    { role: "user", content: state.userMessage },
    { role: "assistant", content: responseText },
  ]).catch((err) => console.error("[appendTurn] failed:", (err as Error).message));

  return {
    response: responseText,
    suggestedActions,
  };
}
