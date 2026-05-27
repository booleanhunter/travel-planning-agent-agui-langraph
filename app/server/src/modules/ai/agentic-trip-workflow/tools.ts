import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { commitPicks } from '#modules/trips/domain/trips-service.js';
import { searchPois } from '#modules/places/domain/places-service.js';
import { getWeather } from '#modules/weather/domain/weather-service.js';
import { CitySchema, type POI, type City } from '#modules/places/types.js';
import type { Weather } from '#modules/weather/types.js';
import type { AgentStateType } from './state.js';

/**
 * Build the `updateItinerary` tool. The closure captures `state` so the LLM
 * doesn't need to pass user/session. `onApplied` lets the calling node
 * capture what was persisted, since the tool returns only a compact summary
 * to the LLM (to save tokens).
 */
export function makeUpdateItineraryTool(state: AgentStateType, onApplied: (picks: POI[]) => void) {
    return tool(
        async ({ pickedPois }: { pickedPois: Array<{ poiId: string; name: string }> }) => {
            const enriched = await commitPicks(
                state.userId,
                state.sessionId,
                pickedPois,
                state.pois,
                state.pickedPois,
            );
            onApplied(enriched);
            console.log(
                `🔧 [tools] updateItinerary — wrote ${enriched.length} picks (${enriched.map((poi) => poi.name).join(', ')})`,
            );
            return { updated: true, count: enriched.length };
        },
        {
            name: 'updateItinerary',
            description:
                "Replace the user's current picked-places set with the given list. " +
                "ONLY call this tool when the user's message NAMES specific places — examples: " +
                '"add Cubbon Park", "remove MTR", "swap Koshy\'s for Karavalli", "clear my picks". ' +
                'DO NOT call this for generic requests, browsing, small talk, or thanks. ' +
                'DO NOT auto-pick the candidates. ' +
                'Always pass the FULL new set, not a delta. Use poiIds from the candidate list.',
            schema: z.object({
                pickedPois: z.array(z.object({ poiId: z.string(), name: z.string() })),
            }),
        },
    );
}

// Canonical interest values matching the chip-card options. Keep in sync with
// follow-up.ts:INTEREST_OPTIONS — the LLM passes from this set so FollowUp's
// rule-based elicit knows whether `interests` is already filled.
const INTEREST_VALUES = [
    'food',
    'landmarks',
    'offbeat',
    'slow',
    'outdoors',
    'nightlife',
    'culture',
] as const;

/**
 * Build the `searchPois` tool. Wraps the existing vector-search service.
 * For DISCOVERY (broad interest-based browsing).
 *
 * Returns id+name+category pairs to the LLM so it has POI IDs in its
 * conversation history; the full POI[] with descriptions, photos, lat/lng
 * goes back to the node via `onApplied`.
 */
export function makeSearchPoisTool(onApplied: (pois: POI[]) => void) {
    return tool(
        async ({ city, interests }: { city: City; interests: string[] }) => {
            const interestQuery = interests.length ? interests.join(' · ') : 'popular places';
            console.log(
                `🔧 [tools] searchPois — city=${city} interests=[${interests.join(',')}]`,
            );
            const pois = await searchPois({ city, interestQuery, k: 12 });
            onApplied(pois);
            return {
                count: pois.length,
                places: pois.map((poi) => ({ id: poi.id, name: poi.name, category: poi.category })),
            };
        },
        {
            name: 'searchPois',
            description:
                'DISCOVERY: Browse places to visit in a city by interest category. ' +
                'Call this when the user is planning a trip, researching what to do somewhere, or asking ' +
                'for broad recommendations ("plan a trip to X", "what is there to do in Y"). ' +
                'Do NOT use this to look up a specific named place — use getPoiDetails for that. ' +
                'If the user has not specified a destination AND no destination is in the conversation ' +
                'history, do NOT call this tool — just ask them where they want to go in your reply.',
            schema: z.object({
                city: CitySchema.describe(
                    'The city the user wants to visit (e.g. "bangalore", "tokyo"). Must be one of the 33 supported city ids.',
                ),
                interests: z
                    .array(z.enum(INTEREST_VALUES))
                    .describe(
                        'Canonical interest tags inferred from the user\'s message and prior context. Empty array if the user gave no preferences.',
                    ),
            }),
        },
    );
}

/**
 * Build the `getPoiDetails` tool. LOOKUP — used when the user names a
 * specific place ("add Spice Terrace") and the LLM needs the real `id`
 * before calling updateItinerary.
 *
 * Implementation: same vector search as searchPois, but the embedding query
 * is the place name and k is smaller (top 10 candidates). Vector similarity
 * surfaces the actual place even if the user's spelling is imprecise.
 *
 * No `onApplied` — this is a pure read; state.pois (the UI grid) shouldn't
 * shift just because the LLM looked up a name.
 */
export function makeGetPoiDetailsTool() {
    return tool(
        async ({ city, placeName }: { city: City; placeName: string }) => {
            console.log(`🔧 [tools] getPoiDetails — city=${city} placeName="${placeName}"`);
            const pois = await searchPois({ city, interestQuery: placeName, k: 10 });
            return {
                count: pois.length,
                candidates: pois.map((poi) => ({
                    id: poi.id,
                    name: poi.name,
                    category: poi.category,
                    rating: poi.rating,
                })),
            };
        },
        {
            name: 'getPoiDetails',
            description:
                'LOOKUP: Find a specific named place in a city and return its real `id`. ' +
                'Call this BEFORE updateItinerary whenever the user names places to add (e.g. "add Spice Terrace") — ' +
                'you need real ids, not the names or list-numbers the user typed. ' +
                'Returns up to 10 candidates ranked by similarity to the name; pick the one that matches.',
            schema: z.object({
                city: CitySchema.describe('The city where the place is located.'),
                placeName: z
                    .string()
                    .describe(
                        'The name of the place to look up, exactly as the user mentioned it (e.g. "Spice Terrace").',
                    ),
            }),
        },
    );
}

/**
 * Build the `getWeather` tool. Wraps the existing hardcoded climate lookup.
 * Returns the weather object directly to the LLM (it's small).
 * `startDate` and `endDate` are captured by FollowUp from the tool-call args
 * to populate the trip's dates slot.
 */
export function makeGetWeatherTool(onApplied: (weather: Weather) => void) {
    return tool(
        async ({
            city,
            startDate,
        }: {
            city: City;
            startDate?: string;
            endDate?: string;
        }) => {
            const weather = getWeather(city, startDate);
            if (!weather) {
                console.log(`🔧 [tools] getWeather — no data for ${city}`);
                return { ok: false, message: `No climate data available for ${city}.` };
            }
            console.log(
                `🔧 [tools] getWeather — ${city} month=${weather.month} → ${weather.condition} (${weather.high}°/${weather.low}°C)`,
            );
            onApplied(weather);
            return weather;
        },
        {
            name: 'getWeather',
            description:
                'Get climate/weather data for a destination, optionally tailored to specific travel dates. ' +
                'Call this when the user is asking about weather, what to pack, or planning a trip where ' +
                'weather context would help. Pass startDate and endDate if the user mentioned them so the ' +
                'trip dates get captured.',
            schema: z.object({
                city: CitySchema.describe('The destination city.'),
                startDate: z
                    .string()
                    .optional()
                    .describe(
                        'Optional ISO date (YYYY-MM-DD) — first day of the trip. Used to pick the right month\'s climate.',
                    ),
                endDate: z
                    .string()
                    .optional()
                    .describe('Optional ISO date — last day of the trip.'),
            }),
        },
    );
}
