import dotenv from 'dotenv';

dotenv.config();

function warnIfMissing(name: string): string {
    const v = process.env[name];
    if (!v) console.warn(`⚠  ${name} is not set — features depending on it will fail.`);
    return v ?? '';
}

export const config = {
    appName: process.env.APP_NAME ?? 'Trip Itinerary Builder',
    serverPort: Number(process.env.SERVER_PORT ?? 3000),

    openai: {
        apiKey: warnIfMissing('OPENAI_API_KEY'),
        model: process.env.MODEL_NAME ?? 'gpt-4o-mini',
    },

    redis: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    },

    agentMemoryServer: {
        url: process.env.AGENT_MEMORY_SERVER_URL ?? 'http://localhost:8000',
    },

    googleMaps: {
        apiKey: warnIfMissing('GOOGLE_MAPS_API_KEY'),
    },

    tavily: {
        apiKey: warnIfMissing('TAVILY_API_KEY'),
    },

    langgraphServer: {
        // The `langgraphjs dev` CLI server (port 8123 in dev). The Express
        // server's CopilotRuntime talks to this via @copilotkit/runtime/langgraph.
        url: process.env.LANGGRAPH_SERVER_URL ?? 'http://127.0.0.1:8123',
    },
} as const;

export type Config = typeof config;
