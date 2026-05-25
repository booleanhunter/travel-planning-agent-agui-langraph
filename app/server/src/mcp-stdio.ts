/**
 * Stdio MCP server entry point.
 *
 * Exposes the trip-planning agent as a real MCP server with one tool,
 * `planTrip`. Inside the tool body, if the agent's state returns an
 * `elicit`, we route it through MCP's `elicitInput` so the connected
 * client (e.g. MCP Inspector, Claude Desktop) renders the form, and we
 * merge the user's response back into state before re-invoking.
 *
 * Run: `npm run mcp:stdio -w server`
 * Connect from the MCP Inspector via stdio transport pointing at this script.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import './config.js'; // side-effect: loads .env
import { graph } from './modules/ai/agentic-trip-workflow/graph.js';
import type { AgentStateType } from './modules/ai/agentic-trip-workflow/state.js';
import type { ElicitRequestFormParams } from '@modelcontextprotocol/sdk/types.js';

// CRITICAL: stdio MCP uses stdout for JSON-RPC. Any agent console.log
// would corrupt the protocol. Redirect all .log to stderr at startup so
// the agent's internal traces remain visible without breaking the wire.
console.log = console.error.bind(console);
console.info = console.error.bind(console);

const USER_ID = 'ashwin';

function newSessionId(): string {
    return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    return parts.length ? `Here are the details: ${parts.join(' ')}` : 'Continuing with the details I provided.';
}

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
                .describe("The user's initial request, e.g. 'Plan a trip to Bangalore in June for food'"),
        },
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
            const result = (await graph.invoke(state)) as AgentStateType;

            if (!result.elicit) {
                // Done — return the agent's final response as MCP tool output.
                return {
                    content: [{ type: 'text', text: result.response ?? '(no response)' }],
                };
            }

            // Send elicitation to the client and wait for their response.
            // Prefer the agent's contextual `response` over the boilerplate elicit
            // message — the LLM's reply already explains what's being asked, in
            // conversational form, and it's how the web UI surfaces the same prompt.
            const elicitParams: ElicitRequestFormParams = {
                mode: 'form',
                message: result.response ?? result.elicit.message,
                requestedSchema: result.elicit
                    .requestedSchema as ElicitRequestFormParams['requestedSchema'],
            };
            const reply = await server.server.elicitInput(elicitParams);

            if (reply.action === 'accept' && reply.content) {
                const content = reply.content as Record<string, unknown>;
                state = {
                    ...result,
                    userId: USER_ID,
                    sessionId,
                    userMessage: describeAcceptedContent(content),
                    destination: (content.destination as string | undefined) ?? result.destination,
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
                    userMessage: "I'd like to skip those details and continue with what we have.",
                    elicit: undefined,
                    userDeclinedElicit: true,
                };
            } else {
                // cancel
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Planning cancelled — let me know when you want to start again.',
                        },
                    ],
                };
            }
        }

        return {
            content: [
                {
                    type: 'text',
                    text: 'Elicitation loop exceeded — giving up after 5 rounds.',
                },
            ],
            isError: true,
        };
    },
);

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[mcp-stdio] connected — waiting for client requests on stdio');
}

main().catch((err) => {
    console.error('[mcp-stdio] fatal:', err);
    process.exit(1);
});
