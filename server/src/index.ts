import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { CopilotRuntime, InMemoryAgentRunner } from '@copilotkit/runtime/v2';
import { createCopilotEndpointExpress } from '@copilotkit/runtime/v2/express';
import { LangGraphAgent } from '@copilotkit/runtime/langgraph';
import type { RunAgentInput } from '@ag-ui/client';
import { config } from './config.ts';
import { handleError } from './lib/errors.ts';
import { userRoutes } from './modules/user/api/user-routes.ts';
import { itineraryRoutes } from './modules/itinerary/api/itinerary-routes.ts';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Health check — used by smoke tests + dev verification
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'trip-itinerary-builder-server',
        version: '0.1.0',
        config: {
            hasOpenAi: Boolean(config.openai.apiKey),
            hasGoogleMaps: Boolean(config.googleMaps.apiKey),
            hasTavily: Boolean(config.tavily.apiKey),
            memoryServerUrl: config.agentMemoryServer.url,
        },
    });
});

// CopilotKit v2 runtime — the v2 SSE runtime speaks AG-UI directly to the
// browser, so the LangGraph agent's event stream is forwarded as-is (no
// service adapter, no GraphQL bridge). The agent itself is hosted by
// `langgraphjs dev` on port 8123 (see `server/langgraph.json` + the
// `dev:agent` npm script); LangGraphAgent talks to that LangGraph Platform
// API and the runtime relays its events to the v2 React client.
//
// `streamMode` is pinned to include both `events` and `messages-tuple`.
// The `events` stream is what drives `handleSingleEvent` — without it, the
// adapter's run loop never assigns `activeRun.nodeName`, the
// `!this.activeRun.nodeName` guard fires on every messages tuple, and
// every TEXT_MESSAGE_*/TOOL_CALL_ARGS dispatch is silently dropped. The
// symptom is a single `MESSAGES_SNAPSHOT` at the end of the run with no
// per-token deltas — the UI shows "Thinking…" for the full tool latency
// and then jumps straight to the final answer.
//
// `dispatchEvent` is overridden to drop the diagnostic `RAW` events and
// strip the `rawEvent` field from every semantic event. The adapter
// mirrors each upstream `on_chat_model_stream` payload (with all of its
// langgraph metadata, checkpoint paths, `additional_kwargs.tool_calls`,
// `versions`, etc.) both as a standalone `RAW` event and as a `rawEvent`
// blob on every TEXT_MESSAGE_*/TOOL_CALL_*/STATE_SNAPSHOT/CUSTOM event.
// Nothing on the client reads either; they only inflate SSE frame size.
class StreamModePinnedAgent extends LangGraphAgent {
    dispatchEvent(event: { type?: string; rawEvent?: unknown } & Record<string, unknown>) {
        if (event?.type === 'RAW') return true;
        if (event && 'rawEvent' in event) {
            const { rawEvent: _rawEvent, ...rest } = event;
            return super.dispatchEvent(rest as Parameters<LangGraphAgent['dispatchEvent']>[0]);
        }
        return super.dispatchEvent(event as Parameters<LangGraphAgent['dispatchEvent']>[0]);
    }

    run(input: RunAgentInput) {
        return super.run({
            ...input,
            forwardedProps: {
                ...input.forwardedProps,
                streamMode: ['events', 'values', 'updates', 'messages-tuple'],
            },
        });
    }
}

const copilotRuntime = new CopilotRuntime({
    agents: {
        itineraryPlanner: new StreamModePinnedAgent({
            deploymentUrl: config.langgraphServer.url,
            graphId: 'itineraryPlanner',
        }),
    },
    runner: new InMemoryAgentRunner(),
});

app.use(
    createCopilotEndpointExpress({
        runtime: copilotRuntime,
        basePath: '/api/itinerary/copilotkit',
    }),
);

// Module routes
app.use('/api/user', userRoutes);
app.use('/api/itinerary', itineraryRoutes);

// Centralised typed-error middleware — maps AppError to its HTTP status.
app.use(handleError);

app.listen(config.serverPort, () => {
    console.log(`✓ ${config.appName} server listening on http://localhost:${config.serverPort}`);
    console.log(`  Health check: http://localhost:${config.serverPort}/api/health`);
});
