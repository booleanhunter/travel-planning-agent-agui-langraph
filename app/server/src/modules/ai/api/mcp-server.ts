/**
 * Factory for the MCP server instance. Constructs the `McpServer`, registers
 * the `planTrip` tool, and wires the elicit-resume loop. Transport-agnostic —
 * the caller picks how to expose it (HTTP, stdio, etc.).
 */

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
    ElicitRequestFormParams,
    ElicitRequestURLParams,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { config } from '#config';
import { CitySchema, POISchema } from '#modules/places/types.js';
import { WeatherSchema } from '#modules/weather/types.js';
import { getTrip } from '#modules/trips/domain/trips-service.js';
import {
    awaitOAuthCompletion,
    cancelOAuthCompletion,
    getValidToken,
} from '#modules/calendar/domain/google-oauth-service.js';
import { createEventForTrip } from '#modules/calendar/domain/calendar-service.js';
import { streamPlannerTurn } from '../agentic-trip-workflow/runtime.js';
import type { AgentStateType } from '../agentic-trip-workflow/state.js';

const USER_ID = 'ashwin';

/**
 * Fixed sessionId — one slot per user. Across multiple planTrip calls on a
 * single MCP connection, AMS conversation history accumulates and the
 * trip-store carries the in-progress draft. Reset (via the web UI) clears it.
 */
const SESSION_ID = 'newSessionId';

// ----- Output schema for `planTrip` -------------------------------------------------
// Declared on the tool so MCP-aware clients can render/parse the structured data
// natively. See https://modelcontextprotocol.io/specification/draft/server/tools
// (search "outputSchema").
//
// Sub-shapes are derived from the canonical domain types via .pick() — single
// source of truth, no duplicate field declarations.

const PoiShape = POISchema.pick({
    id: true,
    name: true,
    description: true,
    rating: true,
    category: true,
});

const PickedPoiShape = POISchema.pick({ id: true, name: true });

const planTripOutputSchema = {
    destination: CitySchema.optional(),
    dates: z.object({ start: z.string(), end: z.string() }).optional(),
    interests: z.array(z.string()),
    weather: WeatherSchema.optional(),
    pois: z.array(PoiShape),
    pickedPois: z.array(PickedPoiShape),
    suggestedActions: z.array(z.string()),
    response: z.string(),
};

/** Default empty shape — used by early-return paths (cancel, loop exceeded). */
function emptyStructured() {
    return {
        interests: [],
        pois: [],
        pickedPois: [],
        suggestedActions: [],
        response: '',
    };
}

/**
 * Pack the agent's final state into an MCP tool result. The human-readable
 * `content` carries the prose; `structuredContent` carries the parsed data
 * matching `planTripOutputSchema` so MCP-aware clients can render or reason
 * about the actual POIs / weather / trip context without re-deriving them.
 */
function buildToolResult(result: AgentStateType) {
    return {
        content: [{ type: 'text' as const, text: result.response ?? '(no response)' }],
        structuredContent: {
            destination: result.destination,
            dates: result.dates,
            interests: result.interests,
            weather: result.weather,
            pois: result.pois.map((p) => ({
                id: p.id,
                name: p.name,
                description:
                    p.description.length > 140
                        ? p.description.slice(0, 137) + '…'
                        : p.description,
                rating: p.rating,
                category: p.category,
            })),
            pickedPois: result.pickedPois.map((p) => ({ id: p.id, name: p.name })),
            suggestedActions: result.suggestedActions,
            response: result.response ?? '',
        },
    };
}

/**
 * Build a userMessage from the elicit `content` object so the LLM has
 * something natural-language to react to in the next graph invocation.
 */
function describeAcceptedContent(content: Record<string, unknown>): string {
    const parts: string[] = [];
    const dest = content.destination;
    if (typeof dest === 'string') parts.push(`My destination is ${dest}.`);
    const start = content.startDate as string | undefined;
    const end = content.endDate as string | undefined;
    if (start && end) parts.push(`I plan to travel from ${start} to ${end}.`);
    const interests = content.interests;
    if (Array.isArray(interests) && interests.length) {
        parts.push(`I'm interested in ${interests.join(', ')}.`);
    }
    return parts.length
        ? `Here are the details: ${parts.join(' ')}`
        : 'Continuing with the details I provided.';
}

export function createMcpServer(): McpServer {
    const server = new McpServer({
        name: 'trip-itinerary-builder',
        version: '0.1.0',
    });

    server.registerTool(
        'planTrip',
        {
            title: 'Plan a trip',
            description:
                'Use this tool to plan a trip to one of 33 cities worldwide (India, Asia, Europe, MENA, Americas, Oceania). ' +
                'If destination, dates, or interests are missing, the tool will elicit them from the client.',
            inputSchema: {
                userMessage: z
                    .string()
                    .describe(
                        "The user's initial request, e.g. 'Plan a trip to Bangalore in June for food'",
                    ),
            },
            outputSchema: planTripOutputSchema,
        },
        async ({ userMessage }, extra) => {
            const sessionId = SESSION_ID;
            let currentUserMessage = userMessage;
            let state: Record<string, unknown> = {};

            // If the MCP client passed a progressToken in _meta, push per-node
            // progress notifications on the in-flight SSE stream. Most clients
            // today don't pass one — this is opt-in and silently no-ops otherwise.
            // `progress` is a monotonic counter (per the spec's expectation); we
            // don't know the exact total ahead of time because the graph branches
            // on intent, so we omit `total` and let the client render a bouncing
            // indicator if it likes.
            const progressToken = extra._meta?.progressToken;
            let progress = 0;
            const handlers =
                progressToken !== undefined
                    ? {
                          onNodeStart: async (nodeName: string) => {
                              progress += 1;
                              await extra
                                  .sendNotification({
                                      method: 'notifications/progress',
                                      params: {
                                          progressToken,
                                          progress,
                                          message: `${nodeName}…`,
                                      },
                                  })
                                  .catch((err) =>
                                      console.warn(
                                          '[planTrip] progress notification failed:',
                                          (err as Error).message,
                                      ),
                                  );
                          },
                      }
                    : {};

            // Loop: drive the planner; if it returns an elicit, ask the MCP client
            // via elicitInput and merge the response into state for the next round.
            // Cap iterations to avoid runaway loops if the agent keeps re-eliciting.
            for (let i = 0; i < 5; i++) {
                const result = await streamPlannerTurn(
                    {
                        userId: USER_ID,
                        sessionId,
                        userMessage: currentUserMessage,
                        state,
                    },
                    handlers,
                );

                if (!result.elicit) {
                    console.log(`no elicit requested, returning result`);
                    return buildToolResult(result);
                }

                // Prefer the agent's contextual `response` over the boilerplate elicit
                // message — the LLM's reply already explains what's being asked.
                const elicitParams: ElicitRequestFormParams = {
                    mode: 'form',
                    message: result.response ?? result.elicit.message,
                    requestedSchema: result.elicit
                        .requestedSchema as ElicitRequestFormParams['requestedSchema'],
                };
                console.log(
                    `eliciting from client — session=${sessionId} user=${USER_ID} elicit=${JSON.stringify(elicitParams)}`,
                );
                const reply = await server.server.elicitInput(elicitParams);

                if (reply.action === 'accept' && reply.content) {
                    const content = reply.content as Record<string, unknown>;
                    currentUserMessage = describeAcceptedContent(content);
                    state = {
                        ...result,
                        destination:
                            (content.destination as string | undefined) ?? result.destination,
                        dates:
                            content.startDate && content.endDate
                                ? { start: content.startDate, end: content.endDate }
                                : result.dates,
                        interests: Array.isArray(content.interests)
                            ? (content.interests as string[])
                            : result.interests,
                        elicit: undefined,
                        userDeclinedElicit: false,
                    };
                } else if (reply.action === 'decline') {
                    currentUserMessage =
                        "I'd like to skip those details and continue with what we have.";
                    state = {
                        ...result,
                        elicit: undefined,
                        userDeclinedElicit: true,
                    };
                } else {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: 'Planning cancelled — let me know when you want to start again.',
                            },
                        ],
                        structuredContent: emptyStructured(),
                    };
                }
            }

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: 'Elicitation loop exceeded — giving up after 5 rounds.',
                    },
                ],
                structuredContent: emptyStructured(),
                isError: true,
            };
        },
    );

    // ----- saveTripToCalendar — the URL-mode elicitation showcase ----------------
    //
    // Demonstrates MCP elicitation `mode: "url"` for an OAuth-style auth flow.
    // If the user already has a Google token cached, we skip straight to creating
    // the event; otherwise we ask the client to open accounts.google.com and wait
    // out-of-band for our /oauth/google/callback to receive the code, exchange it
    // for a token, and resolve our deferred.

    server.registerTool(
        'saveTripToCalendar',
        {
            title: 'Save a trip to Google Calendar',
            description:
                'Add a saved trip (from this user\'s trip history) to their Google Calendar as ' +
                'an all-day event spanning the trip dates. If we don\'t have a Google access ' +
                'token cached for this user, the tool will request one via MCP URL-mode ' +
                'elicitation (the client will open accounts.google.com for the user to authorize).',
            inputSchema: {
                tripId: z
                    .string()
                    .describe(
                        "Trip identifier — e.g. 'newSessionId' for the current planning slot, " +
                            "or 'seed-ashwin-bangalore' for a past trip from the user's history.",
                    ),
            },
        },
        async ({ tripId }) => {
            const userId = USER_ID;
            const trip = await getTrip(userId, tripId);
            if (!trip) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `No trip found with id "${tripId}" for user ${userId}.`,
                        },
                    ],
                    isError: true,
                };
            }
            if (!trip.dates) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: 'This trip has no dates set — cannot create a calendar event.',
                        },
                    ],
                    isError: true,
                };
            }

            // 1. Already have a valid token? Use it directly.
            let token = await getValidToken(userId);

            // 2. No token → URL-mode elicit.
            if (!token) {
                const elicitationId = randomUUID();
                const startUrl = `${config.publicBaseUrl}/oauth/google/start?elicitationId=${elicitationId}`;
                const completionNotifier =
                    server.server.createElicitationCompletionNotifier(elicitationId);

                const tokenPromise = awaitOAuthCompletion(elicitationId, userId);

                const elicit: ElicitRequestURLParams = {
                    mode: 'url',
                    elicitationId,
                    url: startUrl,
                    message:
                        `To save "Trip to ${trip.city}" to your Google Calendar, ` +
                        'I need permission to add events. Click below to sign in.',
                };
                const reply = await server.server.elicitInput(elicit);

                if (reply.action !== 'accept') {
                    cancelOAuthCompletion(elicitationId);
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: 'Calendar save cancelled — Google sign-in was declined.',
                            },
                        ],
                    };
                }

                // Wait out-of-band for /oauth/google/callback to resolve.
                try {
                    token = await tokenPromise;
                } catch (err) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Calendar save failed: ${(err as Error).message}`,
                            },
                        ],
                        isError: true,
                    };
                }

                // Notify the client that the URL-mode flow is done — best-effort.
                await completionNotifier().catch((err) =>
                    console.warn(
                        '[saveTripToCalendar] completionNotifier failed:',
                        (err as Error).message,
                    ),
                );
            }

            // 3. Token in hand — create the event.
            try {
                const event = await createEventForTrip(token.accessToken, trip);
                console.log(
                    `🔧 [tools] saveTripToCalendar — created ${event.id} for ${userId}/${trip.tripId}`,
                );
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text:
                                `✓ Added "Trip to ${trip.city}" (${trip.dates.start} → ${trip.dates.end}) ` +
                                `to your Google Calendar.\n${event.htmlLink}`,
                        },
                    ],
                };
            } catch (err) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Calendar API call failed: ${(err as Error).message}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    );

    return server;
}
