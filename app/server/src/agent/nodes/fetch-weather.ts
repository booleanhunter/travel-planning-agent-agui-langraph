import { lookupWeather } from '../../data/weather.js';
import type { AgentStateType } from '../state.js';

export async function fetchWeather(state: AgentStateType): Promise<Partial<AgentStateType>> {
    if (!state.destination) {
        console.log(`[fetch-weather] skipped — no destination set`);
        return {};
    }
    const weather = lookupWeather(state.destination, state.dates?.start);
    console.log(
        `[fetch-weather] city=${state.destination} month=${weather.month} → ${weather.condition} (${weather.high}°/${weather.low}°C, ${Math.round(weather.precipitationChance * 100)}% rain)`,
    );
    return { weather };
}
