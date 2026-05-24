import type { City, Weather } from '../types.js';

type Forecast = Omit<Weather, 'city' | 'month'>;

const WEATHER: Record<City, Record<number, Forecast>> = {
    bangalore: {
        1: { high: 28, low: 16, condition: 'cool & dry', precipitationChance: 0.05 },
        2: { high: 31, low: 17, condition: 'warm & dry', precipitationChance: 0.05 },
        3: { high: 33, low: 20, condition: 'hot & sunny', precipitationChance: 0.1 },
        4: { high: 34, low: 22, condition: 'hot, occasional showers', precipitationChance: 0.3 },
        5: { high: 32, low: 22, condition: 'warm, monsoon onset', precipitationChance: 0.5 },
        6: { high: 28, low: 21, condition: 'monsoon, frequent rain', precipitationChance: 0.8 },
        7: { high: 27, low: 20, condition: 'heavy monsoon', precipitationChance: 0.85 },
        8: { high: 27, low: 20, condition: 'monsoon', precipitationChance: 0.8 },
        9: { high: 28, low: 20, condition: 'monsoon tapering', precipitationChance: 0.6 },
        10: { high: 28, low: 20, condition: 'pleasant, some rain', precipitationChance: 0.4 },
        11: { high: 27, low: 18, condition: 'mild & dry', precipitationChance: 0.15 },
        12: { high: 26, low: 16, condition: 'cool & dry', precipitationChance: 0.05 },
    },
    mumbai: {
        1: { high: 30, low: 18, condition: 'warm & dry', precipitationChance: 0.02 },
        2: { high: 31, low: 19, condition: 'warm & dry', precipitationChance: 0.02 },
        3: { high: 33, low: 22, condition: 'hot & humid', precipitationChance: 0.05 },
        4: { high: 34, low: 25, condition: 'hot & humid', precipitationChance: 0.1 },
        5: { high: 34, low: 27, condition: 'very hot & humid', precipitationChance: 0.2 },
        6: { high: 32, low: 26, condition: 'monsoon onset', precipitationChance: 0.7 },
        7: { high: 30, low: 25, condition: 'heavy monsoon', precipitationChance: 0.9 },
        8: { high: 29, low: 25, condition: 'monsoon', precipitationChance: 0.85 },
        9: { high: 30, low: 24, condition: 'monsoon tapering', precipitationChance: 0.6 },
        10: { high: 33, low: 23, condition: 'hot, humid', precipitationChance: 0.2 },
        11: { high: 33, low: 21, condition: 'warm & pleasant', precipitationChance: 0.05 },
        12: { high: 31, low: 19, condition: 'warm & dry', precipitationChance: 0.02 },
    },
    barcelona: {
        1: { high: 13, low: 5, condition: 'cool, occasional rain', precipitationChance: 0.3 },
        2: { high: 14, low: 6, condition: 'cool', precipitationChance: 0.3 },
        3: { high: 17, low: 8, condition: 'mild', precipitationChance: 0.25 },
        4: { high: 19, low: 10, condition: 'spring, mild', precipitationChance: 0.3 },
        5: { high: 22, low: 14, condition: 'warm spring', precipitationChance: 0.25 },
        6: { high: 26, low: 18, condition: 'warm & sunny', precipitationChance: 0.15 },
        7: { high: 29, low: 21, condition: 'hot & sunny', precipitationChance: 0.1 },
        8: { high: 30, low: 22, condition: 'hot & sunny', precipitationChance: 0.1 },
        9: { high: 27, low: 19, condition: 'warm', precipitationChance: 0.25 },
        10: { high: 23, low: 15, condition: 'mild autumn', precipitationChance: 0.35 },
        11: { high: 18, low: 10, condition: 'cool, autumn rain', precipitationChance: 0.4 },
        12: { high: 14, low: 7, condition: 'cool & damp', precipitationChance: 0.35 },
    },
};

export function lookupWeather(city: City, isoDate?: string): Weather {
    const month = isoDate ? new Date(isoDate).getUTCMonth() + 1 : new Date().getUTCMonth() + 1;
    const m = Math.max(1, Math.min(12, month));
    const f = WEATHER[city][m];
    return { city, month: m, ...f };
}
