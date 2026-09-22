import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { config } from '#config';
import { commitPicks, getTrip } from '#modules/trips/domain/trips-service.js';
import { searchPois } from '#modules/places/domain/places-service.js';
import { getWeather } from '#modules/weather/domain/weather-service.js';
import { CitySchema, INTEREST_VALUES, type POI, type City } from '#modules/places/catalog.js';
import type { Weather } from '#modules/weather/types.js';
import {
    getValidToken,
    registerPendingFlow,
} from '#modules/calendar/domain/google-oauth-service.js';
import { createEventForTrip } from '#modules/calendar/domain/calendar-service.js';
import type { AgentStateType } from './state.js';
import type { URLElicitSpec } from './types.js';

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
                state.tripId,
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
                places: pois.map((poi) => ({ id: poi.id, name: poi.name, category: poi.category, description: poi.description, rating: poi.rating })),
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

/**
 * Build the `saveTripToCalendar` tool. The agent calls this when the user
 * wants to export their trip to Google Calendar.
 *
 * The tool accepts the trip identifier plus optional overrides for
 * destination + dates. LLM-supplied args take priority over the persisted
 * trip — this lets the agent pass freshly-extracted info from the current
 * user message (e.g. dates from a chip-card submission) even if it hasn't
 * been written to Redis yet.
 *
 * If we have a valid cached Google token, the tool creates the calendar
 * event directly. Otherwise it signals URL-mode elicitation: the tool
 * body builds an OAuth start URL with a fresh elicitationId, hands the
 * elicit spec to `onElicitNeeded` (which the calling node uses to set
 * `state.elicit`), and returns `needsAuth: true`. The wait-for-OAuth
 * happens at the transport layer; this tool body never blocks.
 */
export function makeSaveTripToCalendarTool(
    userId: string,
    onElicitNeeded: (elicit: URLElicitSpec) => void,
) {
    return tool(
        async ({
            tripId,
            destination,
            startDate,
            endDate,
        }: {
            tripId: string;
            destination?: City;
            startDate?: string;
            endDate?: string;
        }) => {
            console.log(
                `🔧 [tools] saveTripToCalendar — user=${userId} tripId=${tripId} args=${JSON.stringify({ destination, startDate, endDate })}`,
            );
            const trip = await getTrip(userId, tripId);
            if (!trip) {
                return {
                    saved: false,
                    error: `No trip found with id "${tripId}" for user ${userId}.`,
                };
            }

            // LLM-supplied args win over persisted trip values — the LLM may
            // have read fresh info from this turn's user message that hasn't
            // been persisted to Redis yet (the trip-store write happens later
            // in followUp).
            const tripDestination = destination ?? trip.destination;
            const finalDates =
                startDate && endDate ? { start: startDate, end: endDate } : trip.dates;

            if (!finalDates) {
                return {
                    saved: false,
                    error:
                        'No travel dates available. Ask the user for startDate and endDate, then ' +
                        'call this tool again INCLUDING them as args.',
                };
            }

            // 1. Already have a valid token? Create directly.
            const token = await getValidToken(userId);
            if (token) {
                try {
                    const event = await createEventForTrip(token.accessToken, {
                        ...trip,
                        destination: tripDestination,
                        dates: finalDates,
                    });
                    console.log(
                        `🔧 [tools] saveTripToCalendar — created ${event.id} for ${userId}/${tripId}`,
                    );
                    return {
                        saved: true,
                        eventLink: event.htmlLink,
                        destination: tripDestination,
                        dates: finalDates,
                    };
                } catch (err) {
                    return {
                        saved: false,
                        error: `Google Calendar API failed: ${(err as Error).message}`,
                    };
                }
            }

            // 2. No token — signal URL-mode elicit via the host node.
            const elicitationId = randomUUID();
            const startUrl = `${config.publicBaseUrl}/oauth/google/start?elicitationId=${elicitationId}`;
            registerPendingFlow(elicitationId, userId);
            onElicitNeeded({
                mode: 'url',
                url: startUrl,
                elicitationId,
                message:
                    `To save "Trip to ${tripDestination}" to your Google Calendar, ` +
                    'sign in with Google to grant calendar permission.',
            });
            return {
                saved: false,
                needsAuth: true,
                message:
                    'I need permission to add events to your Google Calendar. ' +
                    'A sign-in prompt is now open.',
            };
        },
        {
            name: 'saveTripToCalendar',
            description:
                "Save a trip to the user's Google Calendar as an all-day event. " +
                "Pass `tripId`. For the in-progress trip use the current planning-slot tripId " +
                "(named in the system prompt). For past trips use the seeded id " +
                '(e.g. "seed-ashwin-bangalore"). ' +
                "If the user mentioned travel dates or a destination THIS turn (e.g. via a chip-card " +
                "submission or 'I'll travel from X to Y'), ALWAYS include them as startDate, endDate, " +
                "and destination args — they may not yet be persisted in the trip-store. The tool " +
                'falls back to the persisted trip values only if you do not supply them. ' +
                "If the tool returns `needsAuth: true`, do NOT call it again — tell the user to " +
                'complete the sign-in prompt that appeared. ' +
                "If it returns `error: 'No travel dates...'`, ask the user for dates and call again WITH them.",
            schema: z.object({
                tripId: z.string().describe('The trip to save. For the in-progress trip use the planning-slot tripId from the system prompt; for past trips use the seeded id.'),
                destination: CitySchema.optional().describe(
                    'Override destination if the user mentioned a different city this turn.',
                ),
                startDate: z
                    .string()
                    .optional()
                    .describe(
                        'ISO YYYY-MM-DD trip start date. Pass this if the user mentioned it this turn, ' +
                            'even if you think it was saved before.',
                    ),
                endDate: z
                    .string()
                    .optional()
                    .describe('ISO YYYY-MM-DD trip end date.'),
            }),
        },
    );
}
