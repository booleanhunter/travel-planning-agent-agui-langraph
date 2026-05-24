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
    agentMemoryServerUrl: process.env.AGENT_MEMORY_SERVER_URL ?? 'http://localhost:8000',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
    cities: ['bangalore', 'mumbai', 'barcelona'] as const,
    seedPoiCountPerCity: 50,
};

export type City = (typeof config.cities)[number];
