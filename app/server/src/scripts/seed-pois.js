/**
 * seed-pois.js — ingest POIs from fixtures/pois.json into Redis.
 *
 * For each POI:
 *   1. Embed `name + description + category + city` via OpenAI's
 *      text-embedding-3-small (1536-dim).
 *   2. Write to Redis at  pointsOfInterest:{placeId}  as a HASH containing
 *      structural fields + the binary vector.
 *   3. Ensure the FT vector index `idx:pointsOfInterest` exists so
 *      hybrid (city TAG + KNN vector) search works.
 *
 * Reads:  server/fixtures/pois.json
 * Writes: Redis  pointsOfInterest:*  +  idx:pointsOfInterest
 *
 * Run:  npm run seed:pois -w server
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, SCHEMA_FIELD_TYPE, SCHEMA_VECTOR_FIELD_ALGORITHM } from 'redis';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// ----- env loading ---------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(HERE, '../../../.env'), quiet: true });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required (set in .env or environment).');
}

const POIS_PATH = resolve(HERE, '../../fixtures/pois.json');

// ----- Redis index settings ------------------------------------------------

const INDEX_NAME = 'idx:pointsOfInterest';
const KEY_PREFIX = 'pointsOfInterest:';
const VECTOR_DIM = 1536;

const SCHEMA = {
    name:        { type: SCHEMA_FIELD_TYPE.TEXT },
    description: { type: SCHEMA_FIELD_TYPE.TEXT },
    city:        { type: SCHEMA_FIELD_TYPE.TAG },
    category:    { type: SCHEMA_FIELD_TYPE.TAG },
    types:       { type: SCHEMA_FIELD_TYPE.TAG, SEPARATOR: '|' },
    rating:      { type: SCHEMA_FIELD_TYPE.NUMERIC },
    location:    { type: SCHEMA_FIELD_TYPE.GEO },
    vector: {
        type: SCHEMA_FIELD_TYPE.VECTOR,
        ALGORITHM: SCHEMA_VECTOR_FIELD_ALGORITHM.HNSW,
        TYPE: 'FLOAT32',
        DIM: VECTOR_DIM,
        DISTANCE_METRIC: 'COSINE',
    },
};

// ----- helpers --------------------------------------------------------------

async function ensureIndex(redis) {
    try {
        await redis.ft.create(INDEX_NAME, SCHEMA, { ON: 'HASH', PREFIX: KEY_PREFIX });
        console.log(`✓ Created index ${INDEX_NAME}`);
    } catch (err) {
        if (err.message?.includes('Index already exists')) {
            console.log(`✓ Index ${INDEX_NAME} already exists`);
        } else {
            throw err;
        }
    }
}

function vectorToBuffer(vec) {
    const buf = Buffer.alloc(vec.length * 4);
    vec.forEach((v, i) => buf.writeFloatLE(v, i * 4));
    return buf;
}

async function embedDescription(openai, poi) {
    const text = `${poi.name}. ${poi.description}. Category: ${poi.category}. City: ${poi.city}.`;
    const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
    });
    return res.data[0].embedding;
}

async function upsertPoi(redis, poi, vector) {
    await redis.hSet(KEY_PREFIX + poi.id, {
        name: poi.name,
        description: poi.description,
        city: poi.city,
        category: poi.category,
        types: poi.category,
        rating: String(poi.rating),
        location: `${poi.lng},${poi.lat}`,
        photoUrl: poi.photoUrl ?? '',
        lat: String(poi.lat),
        lng: String(poi.lng),
        vector,
    });
}

// ----- Entry point ----------------------------------------------------------

async function main() {
    const raw = await readFile(POIS_PATH, 'utf8');
    const { pois } = JSON.parse(raw);
    console.log(`Loaded ${pois.length} POIs from ${POIS_PATH}`);

    const redis = createClient({ url: REDIS_URL });
    redis.on('error', (err) => console.error('Redis error:', err));
    await redis.connect();

    await ensureIndex(redis);

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    let count = 0;
    for (const poi of pois) {
        const vec = await embedDescription(openai, poi);
        await upsertPoi(redis, poi, vectorToBuffer(vec));
        count++;
        if (count % 25 === 0) console.log(`  ${count}/${pois.length} embedded + written`);
    }

    console.log(`\n✓ Seeded ${count} POIs to Redis`);
    await redis.quit();
}

main().catch((err) => {
    console.error('seed-pois failed:', err);
    process.exit(1);
});
