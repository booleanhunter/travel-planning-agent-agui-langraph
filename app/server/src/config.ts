import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from the workspace root (two levels above this file: src → server → app)
const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, '../../.env') });

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
}

export const config = {
    serverPort: Number(process.env.SERVER_PORT ?? 3000),
    modelName: process.env.MODEL_NAME ?? 'gpt-4o-mini',
    embeddingModel: 'text-embedding-3-small' as const,
    openaiApiKey: required('OPENAI_API_KEY'),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    // Redis Agent Memory (Iris) — hosted service reached via the
    // @redis-iris/agent-memory SDK. serverURL + storeId + apiKey are issued
    // for your Agent Memory service; there is no local default.
    agentMemory: {
        serverUrl: required('AGENT_MEMORY_SERVER_URL'),
        storeId: required('AGENT_MEMORY_STORE_ID'),
        apiKey: required('AGENT_MEMORY_API_KEY'),
    },
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
    googleOauth: {
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
        redirectUri:
            process.env.GOOGLE_OAUTH_REDIRECT_URI ?? 'http://localhost:3000/oauth/google/callback',
    },
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
};
