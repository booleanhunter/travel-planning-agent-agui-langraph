import { z } from "zod";
import type { POI, Weather, ElicitSpec, UserPreferences } from "../types.js";

/**
 * Agent state passed between nodes. Each turn is one-shot: the graph runs
 * end-to-end and the final state is returned to the client. State that
 * survives between turns lives on the client (and in AMS for cross-session).
 */
export const AgentState = z.object({
  userId: z.string(),
  sessionId: z.string(),
  userMessage: z.string(),

  // Slots — extracted by TravelAgent, possibly carried in from the client
  intent: z.enum(["researching", "tripPreparation", "itineraryPlanning", "general"]).default("general"),
  destination: z.enum(["bangalore", "mumbai", "barcelona"]).optional(),
  dates: z.object({ start: z.string(), end: z.string() }).optional(),
  interests: z.array(z.string()).default([]),
  preferences: z.custom<UserPreferences>().optional(),
  pickedPois: z.custom<POI[]>().default(() => []),

  // Outputs — populated by Fetch* and Finalize* nodes
  pois: z.custom<POI[]>().default(() => []),
  weather: z.custom<Weather>().optional(),
  response: z.string().optional(),
  suggestedActions: z.array(z.string()).default(() => []),
  elicit: z.custom<ElicitSpec>().optional(),
});

export type AgentStateType = z.infer<typeof AgentState>;
