import { z } from "zod";
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { getChatModel } from "../../lib/llm.js";
import { appendTurn, getConversation } from "../../memory/ams-client.js";
import type { AgentStateType } from "../state.js";
import type { ElicitField, ElicitSpec } from "../../types.js";

const FollowUpOutput = z.object({
  textResponse: z.string().describe(
    "The final resolution for the user. Build on the agent's most recent reply; reference what's known so far (destination, dates, places, weather).",
  ),
  suggestedActions: z.array(z.string()).describe(
    'Short follow-up chips the USER might tap to send as their next message — written in the user\'s first-person voice. ' +
    'Each chip should read like something the user would naturally type or click. ' +
    'Good examples: "What should I pack?", "Make it more relaxed", "Save this trip", "Show me only cultural spots", "Plan a 3-day itinerary". ' +
    'Bad examples (do NOT use these patterns): "Share your interests", "Request places", "Pick a destination", "Get packing tips" — these are imperatives directed at the user, not user-voiced prompts. ' +
    "Return an empty array if no natural next step exists.",
  ),
});

function buildSystemPrompt(state: AgentStateType): string {
  return [
    "You are a senior travel supervisor reviewing the chat history above.",
    "Provide a final resolution based on everything discussed so far.",
    "Build on the agent's most recent reply — do not repeat or contradict it,",
    "and do not ask for information already answered or visible in the conversation.",
    "",
    "`suggestedActions` should be written in the user's first-person voice — what they might tap to send next, not instructions to the user.",
    "",
    "Trip context so far:",
    `- Destination: ${state.destination ?? "not chosen"}`,
    `- Dates: ${state.dates ? `${state.dates.start} → ${state.dates.end}` : "not picked"}`,
    `- Interests: ${state.interests.length ? state.interests.join(", ") : "none stated"}`,
    `- Weather: ${state.weather ? `${state.weather.condition} (${state.weather.high}°/${state.weather.low}°C)` : "not looked up"}`,
    `- Places surfaced: ${state.pois.length}`,
  ].join("\n");
}

// ----- Elicit logic (mechanical, intent-aware) ----------------------------------------

const INTEREST_OPTIONS = [
  { value: "food",      label: "Food & restaurants" },
  { value: "landmarks", label: "Famous landmarks" },
  { value: "offbeat",   label: "Off the beaten path" },
  { value: "slow",      label: "Slow & easygoing" },
  { value: "outdoors",  label: "Outdoors & nature" },
  { value: "nightlife", label: "Nightlife & social" },
  { value: "culture",   label: "Arts & culture" },
];

/**
 * Required slots per intent. Each intent's data fetch needs at least these.
 * `general` never elicits — it's small talk / form replies.
 */
function requiredSlots(intent: AgentStateType["intent"]): Array<"destination" | "dates" | "interests"> {
  switch (intent) {
    case "researching":       return ["destination"];
    case "tripPreparation":   return ["destination", "dates"];
    case "itineraryPlanning": return ["destination", "dates", "interests"];
    case "general":           return [];
  }
}

function buildElicit(state: AgentStateType): ElicitSpec | undefined {
  const needed = requiredSlots(state.intent);
  const fields: ElicitField[] = [];

  if (needed.includes("destination") && !state.destination) {
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

  if (needed.includes("dates") && !state.dates) {
    fields.push({
      name: "dates",
      type: "date-range",
      label: "When?",
      helpText: "Specific dates let me factor in weather. Skip if you're flexible.",
    });
  }

  if (needed.includes("interests") && !state.interests.length) {
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

export async function followUp(state: AgentStateType): Promise<Partial<AgentStateType>> {
  console.log(`[follow-up] entry — intent=${state.intent} destination=${state.destination ?? "—"} pois=${state.pois.length} weather=${state.weather ? "yes" : "no"} ack=${state.response ? "yes" : "no"}`);

  const elicit = buildElicit(state);
  console.log(`[follow-up] elicit — ${elicit ? `fields=[${elicit.fields.map((f) => f.name).join(",")}]` : "none"}`);

  // Load prior conversation from AMS so the supervisor sees the full chat history.
  const conv = await getConversation(state.sessionId).catch(() => null);
  const priorMessages: BaseMessage[] = (conv?.messages ?? []).map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );
  console.log(`[follow-up] AMS — prior messages=${priorMessages.length}`);

  const messages: BaseMessage[] = [
    new SystemMessage(buildSystemPrompt(state)),
    ...priorMessages,
    new HumanMessage(state.userMessage),
  ];
  if (state.response) {
    messages.push(new AIMessage(state.response));  // TravelAgent's reply this turn
  }

  const llm = getChatModel().withStructuredOutput(FollowUpOutput, { name: "follow_up" });
  const out = await llm.invoke(messages);
  console.log(`[follow-up] LLM — suggestedActions=[${out.suggestedActions.join(",")}]`);
  console.log(`[follow-up] reply: "${out.textResponse.slice(0, 120)}${out.textResponse.length > 120 ? "…" : ""}"`);

  // Mirror the turn to AMS working memory (fire-and-forget). Both assistant
  // messages from this turn — TravelAgent's reply (state.response, still the
  // ack at this point since FollowUp hasn't returned yet) and FollowUp's
  // resolution — get persisted so subsequent turns see the full transcript.
  const turnMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: state.userMessage },
  ];
  if (state.response) {
    turnMessages.push({ role: "assistant", content: state.response });  // TravelAgent's reply
  }
  turnMessages.push({ role: "assistant", content: out.textResponse });   // FollowUp's resolution

  appendTurn(state.sessionId, state.userId, turnMessages)
    .catch((err) => console.error("[appendTurn] failed:", (err as Error).message));

  return {
    //response: out.textResponse,
    suggestedActions: out.suggestedActions,
    elicit,
  };
}
