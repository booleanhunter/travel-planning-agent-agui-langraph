import type { City } from '#modules/places/types.js';
import type { Weather } from '../types.js';
import { lookupWeather as repoLookupWeather } from '../data/weather-repository.js';

export function getWeather(city: City, isoDate?: string): Weather | undefined {
    return repoLookupWeather(city, isoDate);
}
