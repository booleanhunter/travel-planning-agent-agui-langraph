/**
 * Tool bindings for the single `itinerary_agent`.
 *
 * Eight tools total:
 *   - context gathering: searchAndRankPointsOfInterest, lookupWeather
 *   - itinerary writes:  addPointOfInterestToItinerary, removePointOfInterestFromItinerary
 *   - essentials writes: searchProducts, addItemToTripEssentials, removeItemFromTripEssentials
 *   - HITL:              requestTripBasicsFromUser
 *
 * The mutation tools are thin Zod-validated wrappers over the helpers in
 * `state.ts`; the read tools delegate to clients in `points-of-interest/data/`
 * and `infrastructure/`; the HITL tool calls `interrupt(elicit)` to pause the
 * graph and surface a structured request to whichever client surface is
 * driving the conversation.
 *
 * Thread id flows through `RunnableConfig.configurable.thread_id` — the LLM
 * never sees it or has to pass it.
 */

import { randomUUID } from 'node:crypto';
import { tool } from '@langchain/core/tools';
import { ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { ToolCall } from '@langchain/core/messages/tool';
import { Command, getCurrentTaskInput, interrupt } from '@langchain/langgraph';
import { z } from 'zod/v3';

import {
    unpinPointOfInterest,
    unmarkTripEssential,
    type ItineraryPointOfInterest,
    type ItineraryState,
    type TripEssential,
} from './state.ts';
import { buildTripBasicsElicit } from './elicit.ts';
import { embed } from '../../infrastructure/openai-embeddings-client.ts';
import {
    lookupWeather as fetchWeather,
    searchProducts as fetchProducts,
} from '../../infrastructure/web-search-client.ts';
import {
    searchPointsOfInterest,
    hasSufficientPointsOfInterest,
    cachePointOfInterest,
} from '../../points-of-interest/data/redis-points-of-interest-index.ts';
import {
    searchPlacesParallel,
    getPlaceDetails,
} from '../../points-of-interest/data/google-places-client.ts';
import { AppError, ErrorType } from '../../../lib/errors.ts';

function requireThreadId(config?: RunnableConfig): string {
    const threadId = config?.configurable?.thread_id as string | undefined;
    if (!threadId) {
        throw new AppError(
            'ValidationError',
            'thread_id missing from RunnableConfig',
            ErrorType.INVALID_INPUT,
        );
    }
    return threadId;
}

function requireToolCallId(config?: RunnableConfig): string {
    const toolCall = (config as { toolCall?: ToolCall } | undefined)?.toolCall;
    if (!toolCall?.id) {
        throw new AppError(
            'ValidationError',
            'toolCall.id missing from RunnableConfig (tool must be invoked through a ToolNode)',
            ErrorType.INVALID_INPUT,
        );
    }
    return toolCall.id;
}

const TimeOfDayEnum = z.enum(['morning', 'afternoon', 'evening', 'meal']);

// ─── HITL — elicit missing trip basics ─────────────────────────────────────

// Pauses the graph via `interrupt()`; the runtime adapter (CopilotKit / MCP)
// reads the payload from `graph.getState().tasks[].interrupts[].value` and
// surfaces it onto the client. On resume with `Command({ resume: values })`,
// `interrupt()` returns the user's submitted values and the tool emits a
// ToolMessage so the agent sees them in conversation history.
export const requestTripBasicsFromUserTool = tool(
    (input, config) => {
        const toolCallId = requireToolCallId(config);
        const elicit = buildTripBasicsElicit(input.missing);
        // First pass: throws GraphInterrupt; runtime checkpoints the payload.
        // Resume pass: returns the values the client submitted.
        const accepted = interrupt(elicit) as Record<string, unknown>;
        return new Command({
            update: {
                pendingElicitation: undefined,
                messages: [
                    new ToolMessage({
                        content: JSON.stringify({ accepted }),
                        tool_call_id: toolCallId,
                    }),
                ],
            },
        });
    },
    {
        name: 'requestTripBasicsFromUser',
        description:
            'Render an inline form asking the user for trip basics that are TRULY absent ' +
            'from the conversation. Use only when the user has asked to plan/build a trip ' +
            'AND at least one of {destination, dates} cannot be extracted from any prior ' +
            'message. Do NOT call for one-off questions ("what is the weather in X", ' +
            '"best places in Y") — answer those with the relevant tool directly. Do NOT ' +
            'include a key in `missing` if its value already appears anywhere in the ' +
            'conversation (in any case, in any phrasing). Calling this redundantly forces ' +
            'the user to re-enter data they already provided and is a UX failure.',
        schema: z.object({
            missing: z
                .array(z.enum(['destination', 'dates', 'interests']))
                .min(1)
                .describe(
                    'Trip basics to ask for, in display order. Include a key ONLY if the ' +
                    'value is absent from every prior user message. Per-key rules: ' +
                    '`destination` is present if ANY city/region/country name appears in ' +
                    'the conversation, regardless of case ("barcelona", "Tokyo", "the ' +
                    'Alps"). `dates` are present if the user gave any date, day, range, ' +
                    'month, or relative span ("june 3rd", "next weekend", "first week of ' +
                    'July", "5 days starting May 12"). `interests` are present if the ' +
                    'user named any activity, theme, or category ("food", "museums", ' +
                    '"nightlife", "hiking"); they are also OPTIONAL — only include in ' +
                    '`missing` if the user explicitly asked for a tailored recommendation.',
                ),
        }),
    },
);

// ─── context gathering ─────────────────────────────────────────────────────

// Both context-gathering tools are state-aware and idempotent: a cache hit on
// (destination, …) short-circuits the network/Redis work and returns the cached
// payload through a ToolMessage. This is what lets the planning prompt stay
// positive ("call these tools to gather context") instead of carrying
// negative constraints like "don't call this more than once" — the LLM is
// free to call them every turn; redundant calls are cheap.
export const searchAndRankPointsOfInterestTool = tool(
    async (input, config) => {
        const state = getCurrentTaskInput<ItineraryState>(config);
        const toolCallId = requireToolCallId(config);

        if (
            state.candidatePois?.destination === input.destination &&
            state.candidatePois.results.length > 0
        ) {
            return new Command({
                update: {
                    messages: [
                        new ToolMessage({
                            content: JSON.stringify({
                                cached: true,
                                destination: input.destination,
                                count: state.candidatePois.results.length,
                                results: state.candidatePois.results,
                            }),
                            tool_call_id: toolCallId,
                        }),
                    ],
                },
            });
        }

        const center = { latitude: input.latitude, longitude: input.longitude };
        const radius = input.radiusKm ?? 5;
        // Abundance gate — skip Places when the cache is already dense for this area.
        if (!(await hasSufficientPointsOfInterest(center, radius))) {
            const raw = await searchPlacesParallel([
                `${input.interestsQuery} in ${input.destination}`,
                `top attractions in ${input.destination}`,
                `popular ${input.interestsQuery} ${input.destination}`,
            ]);
            const detailed = await getPlaceDetails(raw.map((r) => r.placeId));
            await Promise.all(
                detailed.map(async (poi) => {
                    const embedding = await embed(`${poi.name}. ${poi.description ?? ''}`);
                    await cachePointOfInterest({ ...poi, embedding });
                }),
            );
        }
        const queryVector = await embed(input.interestsQuery);
        const results = await searchPointsOfInterest(queryVector, center, radius, input.typeTags);

        return new Command({
            update: {
                candidatePois: { destination: input.destination, results },
                messages: [
                    new ToolMessage({
                        // Stringify — OpenAI's `type` discriminator on content
                        // parts otherwise collides with the `types` field on
                        // each POI document.
                        content: JSON.stringify({
                            destination: input.destination,
                            count: results.length,
                            results,
                        }),
                        tool_call_id: toolCallId,
                    }),
                ],
            },
        });
    },
    {
        name: 'searchAndRankPointsOfInterest',
        description:
            'Find points of interest near a destination, ranked by relevance to the user\'s interests. ' +
            'Hybrid GEO + TAG + KNN over the cached index; fetches from Google Places on cache miss. ' +
            'Idempotent — repeat calls for the same destination return the cached results.',
        schema: z.object({
            destination: z.string().describe('city or area name, e.g. "Bangalore"'),
            latitude: z.number().describe('center latitude'),
            longitude: z.number().describe('center longitude'),
            interestsQuery: z
                .string()
                .describe('short phrase of interests, e.g. "moody indie cafes"'),
            radiusKm: z.number().optional().describe('search radius in km (default 5)'),
            typeTags: z.array(z.string()).optional().describe('Google place types to filter to'),
        }),
    },
);

export const lookupWeatherTool = tool(
    async ({ destination, days }, config) => {
        const state = getCurrentTaskInput<ItineraryState>(config);
        const toolCallId = requireToolCallId(config);
        const startDate = days[0]?.date ?? '';
        const endDate = days[days.length - 1]?.date ?? '';

        if (
            state.weather?.destination === destination &&
            state.weather.startDate === startDate &&
            state.weather.endDate === endDate &&
            state.weather.forecast.length > 0
        ) {
            return new Command({
                update: {
                    messages: [
                        new ToolMessage({
                            content: JSON.stringify({
                                cached: true,
                                forecast: state.weather.forecast,
                            }),
                            tool_call_id: toolCallId,
                        }),
                    ],
                },
            });
        }

        const forecast = await fetchWeather(destination, days);
        return new Command({
            update: {
                weather: { destination, startDate, endDate, forecast },
                messages: [
                    new ToolMessage({
                        content: JSON.stringify({ forecast }),
                        tool_call_id: toolCallId,
                    }),
                ],
            },
        });
    },
    {
        name: 'lookupWeather',
        description:
            'Look up the weather forecast for a destination across a list of dates. ' +
            'Idempotent — repeat calls for the same destination + date range return the cached forecast.',
        schema: z.object({
            destination: z.string(),
            days: z.array(z.object({ date: z.string().describe('ISO date, e.g. "2026-05-20"') })),
        }),
    },
);

// ─── itinerary writes ──────────────────────────────────────────────────────
// Add / mark tools return Commands so their state writes flow through the
// channel reducer in the same superstep — parallel tool calls compose
// correctly instead of racing on graph.updateState. Remove tools still call
// the snapshot-and-replace helpers; they're only invoked one-at-a-time on
// explicit user edits, where read-modify-write is fine.
export const addPointOfInterestToItineraryTool = tool(
    (input, config) => {
        const entry: ItineraryPointOfInterest = {
            id: randomUUID(),
            timeOfDay: input.timeOfDay,
            pointOfInterestId: input.pointOfInterestId,
            pointOfInterestName: input.pointOfInterestName,
            note: input.note,
        };
        return new Command({
            update: {
                itinerary: [{ dayId: input.dayId, date: input.date, entries: [entry] }],
                messages: [
                    new ToolMessage({
                        content: JSON.stringify({ pinned: entry, dayId: input.dayId }),
                        tool_call_id: requireToolCallId(config),
                    }),
                ],
            },
        });
    },
    {
        name: 'addPointOfInterestToItinerary',
        description: 'Pin a point of interest onto a specific day + time slot of the trip itinerary.',
        schema: z.object({
            dayId: z.string().describe('e.g. "day-1"'),
            date: z.string().optional().describe('ISO date — used when the day does not yet exist'),
            timeOfDay: TimeOfDayEnum,
            pointOfInterestId: z.string().describe('Google place_id'),
            pointOfInterestName: z.string(),
            note: z.string().optional(),
        }),
    },
);

export const removePointOfInterestFromItineraryTool = tool(
    async ({ dayId, entryId }, config) => {
        await unpinPointOfInterest(requireThreadId(config), dayId, entryId);
        return JSON.stringify({ removed: true, dayId, entryId });
    },
    {
        name: 'removePointOfInterestFromItinerary',
        description: 'Remove a previously pinned itinerary entry by its id.',
        schema: z.object({
            dayId: z.string(),
            entryId: z.string().describe('uuid returned by addPointOfInterestToItinerary'),
        }),
    },
);

// ─── essentials writes ─────────────────────────────────────────────────────

export const searchProductsTool = tool(
    async ({ query, maxResults }) => JSON.stringify(await fetchProducts(query, maxResults)),
    {
        name: 'searchProducts',
        description:
            'Search the web for a product to buy (used when surfacing trip-essential buy suggestions).',
        schema: z.object({
            query: z.string().describe('product search phrase, e.g. "compact travel umbrella"'),
            maxResults: z.number().optional().describe('default 3'),
        }),
    },
);

export const addItemToTripEssentialsTool = tool(
    ({ label, owned, productId }, config) => {
        const essential: TripEssential = {
            id: randomUUID(),
            label,
            owned: owned ?? false,
            productId,
        };
        return new Command({
            update: {
                tripEssentials: { [essential.id]: essential },
                messages: [
                    new ToolMessage({
                        content: JSON.stringify({ added: essential }),
                        tool_call_id: requireToolCallId(config),
                    }),
                ],
            },
        });
    },
    {
        name: 'addItemToTripEssentials',
        description:
            'Add a row to the trip-essentials list. Defaults to unchecked; pass owned=true if the user already has it.',
        schema: z.object({
            label: z.string().describe('display label, e.g. "rain jacket"'),
            owned: z.boolean().optional(),
            productId: z
                .string()
                .optional()
                .describe('optional product reference from searchProducts'),
        }),
    },
);

export const removeItemFromTripEssentialsTool = tool(
    async ({ essentialId }, config) => {
        await unmarkTripEssential(requireThreadId(config), essentialId);
        return JSON.stringify({ removed: true, essentialId });
    },
    {
        name: 'removeItemFromTripEssentials',
        description: 'Remove a row from the trip-essentials list by id.',
        schema: z.object({
            essentialId: z.string().describe('id returned by addItemToTripEssentials'),
        }),
    },
);

// ─── single tool group (bound to the agent in `agents.ts`) ─────────────────

export const itineraryAgentTools = [
    requestTripBasicsFromUserTool,
    searchAndRankPointsOfInterestTool,
    lookupWeatherTool,
    addPointOfInterestToItineraryTool,
    removePointOfInterestFromItineraryTool,
    searchProductsTool,
    addItemToTripEssentialsTool,
    removeItemFromTripEssentialsTool,
];
