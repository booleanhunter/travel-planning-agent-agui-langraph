import { lookupWeather } from "../../data/weather.js";
import type { AgentStateType } from "../state.js";

export async function fetchWeather(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (!state.destination) return {};
  return { weather: lookupWeather(state.destination, state.dates?.start) };
}
