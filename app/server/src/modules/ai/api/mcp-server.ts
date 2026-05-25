/**
 * Factory for the MCP server instance. Constructs the `McpServer`, registers
 * the `planTrip` tool, and wires the elicit-resume loop. Transport-agnostic —
 * the caller picks how to expose it (HTTP, stdio, etc.).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ElicitRequestFormParams } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CitySchema, POISchema } from '#modules/places/types.js';
import { WeatherSchema } from '#modules/weather/types.js';
import { getPreferences, getConversation } from '#modules/user/domain/user-service.js';
import { graph } from '../agentic-trip-workflow/graph.js';
import type { AgentStateType } from '../agentic-trip-workflow/state.js';

const USER_ID = 'ashwin';

function newSessionId(): string {
    return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
                'Plan a multi-day trip to one of three cities (Bangalore, Mumbai, Barcelona). ' +
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
        async ({ userMessage }) => {
            const sessionId = newSessionId();
            let state: Record<string, unknown> = {
                userId: USER_ID,
                sessionId,
                userMessage,
            };

            // Loop: invoke graph; if it returns an elicit, ask the MCP client via
            // elicitInput and merge the response into state for the next invocation.
            // Cap iterations to avoid runaway loops if the agent keeps re-eliciting.
            for (let i = 0; i < 5; i++) {
                // Pre-fetch AMS context outside the graph each iteration so the new
                // assistant turn from the prior round (persisted by FollowUp's
                // appendTurn) is visible to the next TravelAgent + FollowUp run.
                const [preferences, conv] = await Promise.all([
                    getPreferences(USER_ID).catch(() => undefined),
                    getConversation(sessionId).catch(() => null),
                ]);
                const conversationHistory = (conv?.messages ?? []).map((m) => ({
                    role: m.role,
                    content: m.content,
                }));
                state = { ...state, preferences, conversationHistory };

                const result = (await graph.invoke(state)) as AgentStateType;

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
                console.log(`eliciting from client — session=${sessionId} user=${USER_ID} elicit=${JSON.stringify(elicitParams)}`);
                const reply = await server.server.elicitInput(elicitParams);

                if (reply.action === 'accept' && reply.content) {
                    const content = reply.content as Record<string, unknown>;
                    state = {
                        ...result,
                        userId: USER_ID,
                        sessionId,
                        userMessage: describeAcceptedContent(content),
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
                    state = {
                        ...result,
                        userId: USER_ID,
                        sessionId,
                        userMessage:
                            "I'd like to skip those details and continue with what we have.",
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

    return server;
}
