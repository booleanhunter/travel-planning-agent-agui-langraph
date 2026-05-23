import { searchPois } from "../../data/pois-redis.js";
import type { AgentStateType } from "../state.js";

export async function fetchRecs(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (!state.destination) return { pois: [] };
  const interestQuery = state.interests.length
    ? state.interests.join(" · ")
    : "popular places to visit";
  const pois = await searchPois({
    city: state.destination,
    interestQuery,
    k: 12,
  });
  return { pois };
}
