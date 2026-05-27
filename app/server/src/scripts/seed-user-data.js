/**
 * seed-user-data.js — ingest persona data from datasets/users.json.
 *
 * For each user defined in the dataset:
 *   - Writes preference memories to AMS long-term memory.
 *   - For each past trip:
 *       - Joins pickedPoiIds against datasets/pois.json to materialize full POI
 *         records.
 *       - Writes a complete trip record to Redis trip-store (HASH) so the
 *         memory drawer can list it. Listing is by KEYS pattern; no index SET.
 *       - ALSO writes a trip-summary memory to AMS with topics
 *         ['trip_history', city, ...interests] so the future getPreviousTrips
 *         tool can find it via semantic search.
 *
 * Memory IDs are deterministic — re-running overwrites the same records.
 *
 * Reads:
 *   server/datasets/users.json
 *   server/datasets/pois.json
 *
 * Writes:
 *   Redis HASHes: user:{userId}:trip:{tripId}
 *   AMS long-term memories (preferences + trip summaries)
 *
 * Run: npm run seed:users -w server
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from 'redis';
import { MemoryAPIClient } from 'agent-memory-client';
import dotenv from 'dotenv';

// ----- env loading ---------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(HERE, '../../../.env'), quiet: true });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const AMS_URL = process.env.AGENT_MEMORY_SERVER_URL ?? 'http://localhost:8000';

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
        city: trip.city,
        startDate: trip.dates.start,
        endDate: trip.dates.end,
        interests: JSON.stringify(trip.interests ?? []),
        pickedPois: JSON.stringify(pickedPois),
        createdAt: now,
        updatedAt: now,
        completedAt: now,
    });
}

/** Write a batch of MemoryRecords to AMS long-term memory. */
async function writeMemories(ams, userId, records) {
    const enriched = records.map((record) => ({ ...record, user_id: userId }));
    try {
        await ams.createLongTermMemory(enriched);
    } catch (err) {
        // The SDK's error message can be "[object Object]" for FastAPI 422
        // responses — re-do the request manually so we see the full body.
        if (err.statusCode === 422) {
            const url = new URL('/v1/long-term-memory/', AMS_URL);
            const res = await fetch(url.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ memories: enriched }),
            });
            console.error('AMS rejected — status:', res.status);
            console.error('AMS rejected — body:', await res.text());
            console.error('Records sent:', JSON.stringify(enriched, null, 2).slice(0, 800));
        }
        throw err;
    }
}

/**
 * Sanitize a POI name so AMS accepts it as an entity.
 * AMS rejects commas in entity values (they're used as internal delimiters).
 * We take the substring before the first comma — usually the canonical name
 * without the location/branch suffix. Example:
 *   "Karavalli - Vivanta Bengaluru, Residency Road" → "Karavalli - Vivanta Bengaluru"
 */
function sanitizeEntity(name) {
    return name.split(',')[0].trim();
}

/** Build a trip-summary MemoryRecord for AMS. */
function tripSummaryMemory(userId, trip, picks) {
    return {
        id: `${userId}:${trip.tripId}`,
        user_id: userId,
        topics: ['trip_history', trip.city, ...trip.interests],
        entities: picks.map((poi) => sanitizeEntity(poi.name)),
        text: trip.summary,
    };
}

// ----- Entry point ----------------------------------------------------------

async function main() {
    const usersJson = JSON.parse(await readFile(USERS_PATH, 'utf8'));
    const poisJson = JSON.parse(await readFile(POIS_PATH, 'utf8'));
    const poisById = new Map(poisJson.pois.map((poi) => [poi.id, poi]));
    console.log(`Loaded ${usersJson.users.length} users and ${poisById.size} POIs from disk.`);

    const redis = createClient({ url: REDIS_URL });
    redis.on('error', (err) => console.error('Redis error:', err));
    await redis.connect();

    const ams = new MemoryAPIClient({ baseUrl: AMS_URL });

    for (const user of usersJson.users) {
        console.log(`\n=== ${user.displayName} (${user.userId}) ===`);

        // 1. Preference memories → AMS
        await writeMemories(ams, user.userId, user.memories);
        console.log(`  ✓ wrote ${user.memories.length} preference memories`);

        // 2. Past trips → Redis trip-store + AMS trip-summary memory
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
            await writeMemories(ams, user.userId, [tripSummaryMemory(user.userId, trip, picks)]);
            console.log(`  ✓ ${trip.tripId}: ${picks.length} picks → trip-store + AMS`);
        }
    }

    console.log('\n✓ Done');
    await redis.quit();
}

main().catch((err) => {
    console.error('seed-user-data failed:', err);
    process.exit(1);
});
