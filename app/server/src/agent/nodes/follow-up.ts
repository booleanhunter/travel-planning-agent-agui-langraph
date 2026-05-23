import { z } from "zod";
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { getChatModel } from "../../lib/llm.js";
import { appendTurn } from "../../memory/ams-client.js";
import type { AgentStateType } from "../state.js";
import type { ElicitField, ElicitSpec } from "../../types.js";

const FollowUpOutput = z.object({
  textResponse: z.string().describe(
    "The substantive reply to the user. Under 60 words. Reference the data that was fetched (POIs / weather) when relevant. When the system is about to render an elicit form (slots are missing), just briefly acknowledge what you'd like to know — don't pretend to have data.",
  ),
  suggestedActions: z.array(z.string()).describe(
    "1-3 short chip labels for one-tap follow-up actions, e.g. 'What should I pack?', 'Make it more relaxed', 'Save this trip'. Empty array if none make sense (e.g. when an elicit form is about to render).",
  ),
});

// ----- Elicit logic (mechanical, not LLM-generated) -----------------------------------

const INTEREST_OPTIONS = [
  { value: "food",      label: "Food & restaurants" },
  { value: "landmarks", label: "Famous landmarks" },
  { value: "offbeat",   label: "Off the beaten path" },
  { value: "slow",      label: "Slow & easygoing" },
  { value: "outdoors",  label: "Outdoors & nature" },
  { value: "nightlife", label: "Nightlife & social" },
  { value: "culture",   label: "Arts & culture" },
];

function buildElicit(state: AgentStateType): ElicitSpec | undefined {
  const fields: ElicitField[] = [];

  if (!state.destination) {
    fields.push({
      name: "destination",
      type: "enum",
      label: "Where to?",
      required: true,
      options: [
        { value: "bangalore", label: "Bangalore" },
        { value: "mumbai",    label: "Mumbai" },
        { value: "barcelona", label: "Barcelona" },
      ],
    });
  }

  if (!state.dates) {
    fields.push({
      name: "dates",
      type: "date-range",
      label: "When?",
      helpText: "Specific dates let me factor in weather. Skip if you're flexible.",
    });
  }

  // Interests are only required for the "plan" intent — pack/continue don't need them.
  if (state.intent === "plan" && !state.interests.length) {
    const memInterests = state.preferences?.recurringInterests ?? [];
    fields.push({
      name: "interests",
      type: "multi-enum",
      label: "What are you in the mood for?",
      options: INTEREST_OPTIONS,
      default: memInterests,
      prefilledFromMemory: memInterests.length > 0,
    });
  }

  if (!fields.length) return undefined;
  return {
    message: "A few quick details so I can plan your day:",
    fields,
  };
}

// ----- The node -----------------------------------------------------------------------

function buildSystemPrompt(state: AgentStateType, willElicit: boolean): string {
  const lines: string[] = [
    `You are a friendly travel agent. The user is in the middle of planning a trip.`,
    `Current intent: ${state.intent}.`,
    state.destination ? `Destination: ${state.destination}.` : "Destination not yet chosen.",
    state.dates ? `Dates: ${state.dates.start} → ${state.dates.end}.` : "Dates not yet picked.",
    state.interests.length ? `Interests: ${state.interests.join(", ")}.` : "",
    state.weather ? `Weather: ${state.weather.condition} (${state.weather.high}°/${state.weather.low}°C, ${Math.round(state.weather.precipitationChance * 100)}% chance of rain).` : "",
    state.pois.length ? `${state.pois.length} candidate places have been surfaced.` : "",
    "",
    willElicit
      ? "The system is about to render a small form asking the user for the missing details. Briefly acknowledge what you'd like to know — do NOT list places or weather. Keep it under 30 words. Suggested actions: empty array."
      : state.intent === "pack"
        ? "Suggest 5-7 packing items as a short comma-separated list, derived from weather + interests. Suggested actions: 1-2 chips like 'Refine the vibe', 'Save this trip'."
        : state.intent === "continue"
          ? "Acknowledge the update and invite the user to pick from the candidates. Suggested actions: 1-2 chips like 'What should I pack?', 'Make it more relaxed'."
          : "Brief one-paragraph response acknowledging the plan and inviting them to pick places. Suggested actions: 1-2 chips like 'What should I pack?', 'Save this trip'.",
  ];
  return lines.filter(Boolean).join("\n");
}

export async function followUp(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const elicit = buildElicit(state);
  const willElicit = elicit !== undefined;

  const messages: BaseMessage[] = [
    new SystemMessage(buildSystemPrompt(state, willElicit)),
    new HumanMessage(state.userMessage),
  ];
  // Include TravelAgent's acknowledgment if it was set this turn
  if (state.response) {
    messages.push(new AIMessage(state.response));
  }

  const llm = getChatModel().withStructuredOutput(FollowUpOutput, { name: "follow_up" });
  const out = await llm.invoke(messages);

  // Mirror the turn to AMS working memory (fire-and-forget).
  // We append both the user's message and the final assistant response.
  // TravelAgent's acknowledgment is intentionally not persisted to AMS in v1 —
  // keeps the conversation transcript at one assistant message per turn.
  appendTurn(state.sessionId, state.userId, [
    { role: "user", content: state.userMessage },
    { role: "assistant", content: out.textResponse },
  ]).catch((err) => console.error("[appendTurn] failed:", (err as Error).message));

  return {
    response: out.textResponse,
    suggestedActions: out.suggestedActions,
    elicit,
  };
}
