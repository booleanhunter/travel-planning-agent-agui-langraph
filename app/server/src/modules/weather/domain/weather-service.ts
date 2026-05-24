import type { City, Weather } from '../../../types.js';
import { lookupWeather as repoLookupWeather } from '../data/weather-repository.js';

export function getWeather(city: City, isoDate?: string): Weather {
    return repoLookupWeather(city, isoDate);
}
