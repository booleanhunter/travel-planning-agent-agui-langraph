import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state.js";
import { routeIntent } from "./nodes/route-intent.js";
import { fetchRecs } from "./nodes/fetch-recs.js";
import { fetchWeather } from "./nodes/fetch-weather.js";
import { finalizePlan } from "./nodes/finalize-plan.js";
import { finalizeElicit } from "./nodes/finalize-elicit.js";

/**
 * Branch: if any required slot (destination, dates, interests) is missing,
 * route to FinalizeElicit. Otherwise fan out FetchRecs ∥ FetchWeather.
 */
function branchOnSlots(state: AgentStateType): "FinalizeElicit" | ["FetchRecs", "FetchWeather"] {
  const missing = !state.destination || !state.dates || !state.interests.length;
  return missing ? "FinalizeElicit" : ["FetchRecs", "FetchWeather"];
}

export const graph = new StateGraph(AgentState)
  .addNode("RouteIntent",    routeIntent)
  .addNode("FetchRecs",      fetchRecs)
  .addNode("FetchWeather",   fetchWeather)
  .addNode("FinalizePlan",   finalizePlan)
  .addNode("FinalizeElicit", finalizeElicit)
  .addEdge(START, "RouteIntent")
  .addConditionalEdges("RouteIntent", branchOnSlots, ["FinalizeElicit", "FetchRecs", "FetchWeather"])
  .addEdge("FetchRecs",      "FinalizePlan")
  .addEdge("FetchWeather",   "FinalizePlan")
  .addEdge("FinalizeElicit", END)
  .addEdge("FinalizePlan",   END)
  .compile();

export const APP_NODES = ["RouteIntent", "FetchRecs", "FetchWeather", "FinalizePlan", "FinalizeElicit"] as const;
