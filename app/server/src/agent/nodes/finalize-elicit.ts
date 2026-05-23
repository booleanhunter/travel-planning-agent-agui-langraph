import type { AgentStateType } from "../state.js";
import type { ElicitField, ElicitSpec } from "../../types.js";

const INTEREST_OPTIONS = [
  { value: "food",       label: "Food & restaurants" },
  { value: "landmarks",  label: "Famous landmarks" },
  { value: "offbeat",    label: "Off the beaten path" },
  { value: "slow",       label: "Slow & easygoing" },
  { value: "outdoors",   label: "Outdoors & nature" },
  { value: "nightlife",  label: "Nightlife & social" },
  { value: "culture",    label: "Arts & culture" },
];

export async function finalizeElicit(state: AgentStateType): Promise<Partial<AgentStateType>> {
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

  const memInterests = state.preferences?.recurringInterests ?? [];
  if (!state.interests.length) {
    fields.push({
      name: "interests",
      type: "multi-enum",
      label: "What are you in the mood for?",
      options: INTEREST_OPTIONS,
      default: memInterests,
      prefilledFromMemory: memInterests.length > 0,
    });
  }

  const elicit: ElicitSpec = {
    message: "A few quick details so I can plan your day:",
    fields,
  };

  return { elicit };
}
