/**
 * Factory for the MCP server instance. Constructs the `McpServer`, registers
 * the `planTrip` tool, and wires the elicit-resume loop. Transport-agnostic —
 * the caller picks how to expose it (HTTP, stdio, etc.).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
    ElicitRequestFormParams,
    ElicitRequestURLParams,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CitySchema, POISchema } from '#modules/places/types.js';
import { WeatherSchema } from '#modules/weather/types.js';
import {
    awaitOAuthCompletion,
    cancelOAuthCompletion,
} from '#modules/calendar/domain/google-oauth-service.js';
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
            pois: result.pois.map((poi) => ({
                id: poi.id,
                name: poi.name,
                description:
                    poi.description.length > 140
                        ? poi.description.slice(0, 137) + '…'
                        : poi.description,
                rating: poi.rating,
                category: poi.category,
            })),
            pickedPois: result.pickedPois.map((poi) => ({ id: poi.id, name: poi.name })),
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
            for (let iteration = 0; iteration < 5; iteration++) {
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

                // Two elicit modes — `form` (chip-card-equivalent) and `url`
                // (OAuth flows). Different MCP elicit shapes; different
                // resume semantics on accept.
                if (result.elicit.mode === 'url') {
                    // URL-mode: open the consent URL in the MCP client, then
                    // wait out-of-band for /oauth/google/callback to resolve
                    // the in-process deferred keyed by elicitationId.
                    const { elicitationId, url, message } = result.elicit;
                    const completionNotifier =
                        server.server.createElicitationCompletionNotifier(elicitationId);
                    const tokenPromise = awaitOAuthCompletion(elicitationId, USER_ID);

                    const elicit: ElicitRequestURLParams = {
                        mode: 'url',
                        elicitationId,
                        url,
                        message,
                    };
                    console.log(
                        `eliciting URL from client — session=${sessionId} url=${url}`,
                    );
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
                            structuredContent: emptyStructured(),
                        };
                    }

                    // Wait for the OAuth callback to resolve.
                    try {
                        await tokenPromise;
                    } catch (err) {
                        return {
                            content: [
                                {
                                    type: 'text' as const,
                                    text: `OAuth flow failed: ${(err as Error).message}`,
                                },
                            ],
                            structuredContent: emptyStructured(),
                            isError: true,
                        };
                    }

                    // Notify the client the URL-mode flow is done (close any
                    // hanging consent dialog) — best-effort.
                    await completionNotifier().catch((err) =>
                        console.warn(
                            '[planTrip] completionNotifier failed:',
                            (err as Error).message,
                        ),
                    );

                    // Re-enter the graph with the same userMessage; this time
                    // saveTripToCalendar's getValidToken returns the cached
                    // token and the tool creates the event.
                    state = {
                        ...result,
                        elicit: undefined,
                    };
                    // userMessage stays the same — that's what triggered the
                    // calendar tool in the first place.
                    continue;
                }

                // Form-mode (the existing path).
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

    // Note: there is no standalone `saveTripToCalendar` MCP tool anymore.
    // The graph's `saveTripToCalendar` tool (bound in TravelAgent's ReAct
    // loop) reaches the same capability via `planTrip` — the agent's LLM
    // picks it when the user asks to save, the graph emits a URL-mode
    // elicit, and the planTrip resume loop above handles the OAuth dance.

    return server;
}
