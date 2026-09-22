/**
 * seed-user-data.js — ingest persona data from datasets/users.json.
 *
 * For each user defined in the dataset:
 *   - Writes preference memories to Agent Memory long-term memory.
 *   - For each past trip:
 *       - Joins pickedPoiIds against datasets/pois.json to materialize full POI
 *         records.
 *       - Writes a complete trip record to Redis trip-store (HASH) so the
 *         memory drawer can list it. Listing is by KEYS pattern; no index SET.
 *       - ALSO writes a trip-summary memory to Agent Memory with topics
 *         ['trip_history', destination, ...interests] so the future
 *         getPreviousTrips tool can find it via semantic search.
 *
 * Memory record IDs are DETERMINISTIC (`<userId>:pref:<n>`, `<userId>:trip:<id>`).
 * The SDK's bulkCreateLongTermMemories treats `id` as a client-provided key for
 * idempotent creation, so re-running the seed overwrites the same records
 * rather than duplicating them — no separate wipe step needed.
 *
 * Reads:
 *   server/datasets/users.json
 *   server/datasets/pois.json
 *
 * Writes:
 *   Redis HASHes: user:{userId}:trip:{tripId}
 *   Agent Memory long-term memories (preferences + trip summaries)
 *
 * Requires (in .env): AGENT_MEMORY_SERVER_URL, AGENT_MEMORY_STORE_ID,
 * AGENT_MEMORY_API_KEY.
 *
 * Run: npm run seed:users -w server
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from 'redis';
import { AgentMemory } from '@redis-iris/agent-memory';
import dotenv from 'dotenv';

// ----- env loading ---------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(HERE, '../../../.env'), quiet: true });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const AGENT_MEMORY_SERVER_URL = process.env.AGENT_MEMORY_SERVER_URL;
const AGENT_MEMORY_STORE_ID = process.env.AGENT_MEMORY_STORE_ID;
const AGENT_MEMORY_API_KEY = process.env.AGENT_MEMORY_API_KEY;

const USERS_PATH = resolve(HERE, '../../datasets/users.json');
const POIS_PATH = resolve(HERE, '../../datasets/pois.json');

// ----- write helpers --------------------------------------------------------

/**
 * Write a complete, completed trip record to Redis trip-store.
 * Same shape that trips-repository.ts would produce after
 * ensureTripDraft → updateTripPickedPois → markTripComplete.
 */
async function writeTrip(redis, userId, trip, pickedPois) {
    const tripKey = `user:${userId}:trip:${trip.tripId}`;
    const now = new Date().toISOString();
    await redis.hSet(tripKey, {
        tripId: trip.tripId,
        status: 'completed',
        destination: trip.destination ?? trip.city,
        startDate: trip.dates.start,
        endDate: trip.dates.end,
        interests: JSON.stringify(trip.interests ?? []),
        pickedPois: JSON.stringify(pickedPois),
        createdAt: now,
        updatedAt: now,
        completedAt: now,
    });
}

/**
 * Write long-term memory records to Agent Memory. Each record already carries a
 * deterministic `id` and `ownerId`, so this is a plain bulk create.
 */
async function writeMemories(agentMemory, records) {
    if (!records.length) return;
    await agentMemory.bulkCreateLongTermMemories({ memories: records });
}

// Memory record IDs may contain only alphanumerics and hyphens (server rule),
// so the deterministic keys use hyphens as separators — no colons.

/** Build a preference memory record with a deterministic id. */
function preferenceMemory(userId, memory, index) {
    return {
        id: `${userId}-pref-${index}`,
        text: memory.text,
        ownerId: userId,
        topics: memory.topics ?? [],
    };
}

/** Build a trip-summary memory record with a deterministic id. */
function tripSummaryMemory(userId, trip) {
    return {
        id: `${userId}-trip-${trip.tripId}`,
        text: trip.summary,
        ownerId: userId,
        topics: ['trip_history', trip.destination ?? trip.city, ...(trip.interests ?? [])],
    };
}

// ----- Entry point ----------------------------------------------------------

async function main() {
    if (!AGENT_MEMORY_SERVER_URL || !AGENT_MEMORY_STORE_ID || !AGENT_MEMORY_API_KEY) {
        throw new Error(
            'Missing Agent Memory env vars: set AGENT_MEMORY_SERVER_URL, ' +
                'AGENT_MEMORY_STORE_ID, and AGENT_MEMORY_API_KEY in .env',
        );
    }

    const usersJson = JSON.parse(await readFile(USERS_PATH, 'utf8'));
    const poisJson = JSON.parse(await readFile(POIS_PATH, 'utf8'));
    const poisById = new Map(poisJson.pois.map((poi) => [poi.id, poi]));
    console.log(`Loaded ${usersJson.users.length} users and ${poisById.size} POIs from disk.`);

    const redis = createClient({ url: REDIS_URL });
    redis.on('error', (err) => console.error('Redis error:', err));
    await redis.connect();

    const agentMemory = new AgentMemory({
        serverURL: AGENT_MEMORY_SERVER_URL,
        storeId: AGENT_MEMORY_STORE_ID,
        apiKey: AGENT_MEMORY_API_KEY,
    });

    for (const user of usersJson.users) {
        console.log(`\n=== ${user.displayName} (${user.userId}) ===`);

        // 1. Preference memories → Agent Memory (deterministic ids → idempotent)
        await writeMemories(
            agentMemory,
            user.memories.map((memory, index) => preferenceMemory(user.userId, memory, index)),
        );
        console.log(`  ✓ wrote ${user.memories.length} preference memories`);

        // 2. Past trips → Redis trip-store + Agent Memory trip-summary memory
        for (const trip of user.pastTrips) {
            const picks = [];
            const missing = [];
            for (const id of trip.pickedPoiIds) {
                const poi = poisById.get(id);
                if (poi) picks.push(poi);
                else missing.push(id);
            }
            if (missing.length) {
                console.warn(`  ⚠ ${trip.tripId}: missing POI ids → ${missing.join(', ')}`);
            }

            await writeTrip(redis, user.userId, trip, picks);
            await writeMemories(agentMemory, [tripSummaryMemory(user.userId, trip)]);
            console.log(`  ✓ ${trip.tripId}: ${picks.length} picks → trip-store + Agent Memory`);
        }
    }

    console.log('\n✓ Done');
    await redis.quit();
}

main().catch((err) => {
    console.error('seed-user-data failed:', err);
    process.exit(1);
});
