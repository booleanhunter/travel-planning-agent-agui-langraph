import { getWeather } from '#modules/weather/domain/weather-service.js';
import type { AgentStateType } from '../state.js';

export async function fetchWeather(state: AgentStateType): Promise<Partial<AgentStateType>> {
    if (!state.destination) {
        console.log(`\n⛅ [fetch-weather] skipped — no destination set`);
        return {};
    }
    const weather = getWeather(state.destination, state.dates?.start);
    console.log(
        `\n⛅ [fetch-weather] city=${state.destination} month=${weather.month} → ${weather.condition} (${weather.high}°/${weather.low}°C, ${Math.round(weather.precipitationChance * 100)}% rain)`,
    );
    return { weather };
}
