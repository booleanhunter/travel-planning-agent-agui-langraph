/**
 * User-scoped trip storage in Redis. Replaces the old AMS-episodic write path.
 *
 *   user:{userId}:trip:{tripId}    HASH  — the trip record (draft or completed)
 *   user:{userId}:trips            SET   — all tripIds for this user
 *   user:{userId}:past-trips       SET   — only completed tripIds
 *
 * Convention: tripId == sessionId (one trip per session in v1).
 */

import { getRedis } from '../../../lib/redis.js';
import type { POI, PastTrip, City } from '../../../types.js';

interface TripDraftUpsert {
    city?: City;
    startDate?: string;
    endDate?: string;
}

const tripKey = (userId: string, tripId: string) => `user:${userId}:trip:${tripId}`;
const tripsKey = (userId: string) => `user:${userId}:trips`;
const pastTripsKey = (userId: string) => `user:${userId}:past-trips`;

/**
 * Idempotently ensure a draft trip record exists for this session, and merge
 * in any newly known fields (city, dates) on each call. Safe to call from
 * TravelAgent on every turn.
 */
export async function ensureTripDraft(
    userId: string,
    tripId: string,
    fields: TripDraftUpsert = {},
): Promise<void> {
    const redis = await getRedis();
    const key = tripKey(userId, tripId);
    const now = new Date().toISOString();

    const exists = await redis.exists(key);
    const baseUpsert: Record<string, string> = {
        tripId,
        updatedAt: now,
    };
    if (!exists) {
        baseUpsert.status = 'draft';
        baseUpsert.createdAt = now;
        baseUpsert.pickedPois = '[]';
    }
    if (fields.city) baseUpsert.city = fields.city;
    if (fields.startDate) baseUpsert.startDate = fields.startDate;
    if (fields.endDate) baseUpsert.endDate = fields.endDate;

    await redis.hSet(key, baseUpsert);
    await redis.sAdd(tripsKey(userId), tripId);
}

/** Replace the picked POIs for the trip with this exact set. */
export async function updateTripPickedPois(
    userId: string,
    tripId: string,
    pickedPois: POI[],
): Promise<void> {
    const redis = await getRedis();
    const now = new Date().toISOString();
    // Ensure the record exists before patching (no-op if it does).
    await ensureTripDraft(userId, tripId);
    await redis.hSet(tripKey(userId, tripId), {
        pickedPois: JSON.stringify(pickedPois),
        updatedAt: now,
    });
}

/** Flip status to completed and add to the past-trips set. */
export async function markTripComplete(userId: string, tripId: string): Promise<PastTrip | null> {
    const redis = await getRedis();
    const now = new Date().toISOString();
    const key = tripKey(userId, tripId);

    await redis.hSet(key, {
        status: 'completed',
        completedAt: now,
        updatedAt: now,
    });
    await redis.sAdd(pastTripsKey(userId), tripId);

    return getTrip(userId, tripId);
}

/** Read a single trip. Returns null if not found. */
export async function getTrip(userId: string, tripId: string): Promise<PastTrip | null> {
    const redis = await getRedis();
    const h = await redis.hGetAll(tripKey(userId, tripId));
    if (!h || !Object.keys(h).length) return null;
    return hashToTrip(tripId, h);
}

/** List all completed trips for a user. */
export async function listPastTrips(userId: string): Promise<PastTrip[]> {
    const redis = await getRedis();
    const tripIds = await redis.sMembers(pastTripsKey(userId));
    if (!tripIds.length) return [];
    const hashes = await Promise.all(tripIds.map((id) => redis.hGetAll(tripKey(userId, id))));
    return tripIds
        .map((id, i) => hashToTrip(id, hashes[i]))
        .filter((t): t is PastTrip => t !== null);
}

function hashToTrip(tripId: string, h: Record<string, string>): PastTrip | null {
    if (!h || !h.tripId) return null;
    let pickedPois: POI[] = [];
    try {
        pickedPois = JSON.parse(h.pickedPois ?? '[]');
    } catch {
        pickedPois = [];
    }
    const dates = h.startDate && h.endDate ? { start: h.startDate, end: h.endDate } : undefined;
    return {
        tripId,
        sessionId: tripId, // tripId == sessionId in v1
        city: (h.city ?? 'bangalore') as City,
        dates,
        pickedPois,
        createdAt: h.createdAt,
        completedAt: h.completedAt,
    };
}
