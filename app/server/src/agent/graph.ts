import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state.js";
import { travelAgent } from "./nodes/travel-agent.js";
import { fetchRecs } from "./nodes/fetch-recs.js";
import { fetchWeather } from "./nodes/fetch-weather.js";
import { followUp } from "./nodes/follow-up.js";

/**
 * Branch on the classified intent + which slots are still missing.
 *
 *   continue           → FollowUp (no fetches)
 *   plan, slots filled → [FetchRecs ∥ FetchWeather] → FollowUp
 *   plan, slots missing → FollowUp (will populate elicit)
 *   pack, dest+dates   → FetchWeather → FollowUp
 *   pack, missing      → FollowUp (will populate elicit)
 */
function branchOnIntent(state: AgentStateType): "FollowUp" | "FetchWeather" | ["FetchRecs", "FetchWeather"] {
  if (state.intent === "continue") return "FollowUp";

  const haveDestination = !!state.destination;
  const haveDates = !!state.dates;

  if (!haveDestination || !haveDates) return "FollowUp";  // elicit branch

  if (state.intent === "pack") return "FetchWeather";

  // plan
  if (!state.interests.length) return "FollowUp";
  return ["FetchRecs", "FetchWeather"];
}

export const graph = new StateGraph(AgentState)
  .addNode("TravelAgent",  travelAgent)
  .addNode("FetchRecs",    fetchRecs)
  .addNode("FetchWeather", fetchWeather)
  .addNode("FollowUp",     followUp)
  .addEdge(START, "TravelAgent")
  .addConditionalEdges("TravelAgent", branchOnIntent, ["FollowUp", "FetchWeather", "FetchRecs"])
  .addEdge("FetchRecs",    "FollowUp")
  .addEdge("FetchWeather", "FollowUp")
  .addEdge("FollowUp",     END)
  .compile();

export const APP_NODES = ["TravelAgent", "FetchRecs", "FetchWeather", "FollowUp"] as const;
