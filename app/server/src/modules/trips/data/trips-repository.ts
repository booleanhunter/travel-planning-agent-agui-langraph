/**
 * User-scoped trip storage in Redis.
 *
 *   user:{userId}:trip:{tripId}    HASH  — the trip record (draft or completed)
 *
 * Listing happens by KEYS pattern scan + per-hash status filter — no
 * separate index SETs. For our scale (<<1000 trips per user) this is
 * trivially fast and keeps the data model to one structure per concept.
 *
 * Convention: tripId == sessionId (one trip per session in v1).
 */

import { getRedis } from '#lib/redis.js';
import type { POI, City } from '#modules/places/types.js';
import type { PastTrip } from '../types.js';

interface TripDraftUpsert {
    city?: City;
    startDate?: string;
    endDate?: string;
    interests?: string[];
}

const tripKey = (userId: string, tripId: string) => `user:${userId}:trip:${tripId}`;
const tripKeyPrefix = (userId: string) => `user:${userId}:trip:`;

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
        baseUpsert.interests = '[]';
    }
    if (fields.city) baseUpsert.city = fields.city;
    if (fields.startDate) baseUpsert.startDate = fields.startDate;
    if (fields.endDate) baseUpsert.endDate = fields.endDate;
    if (fields.interests?.length) baseUpsert.interests = JSON.stringify(fields.interests);

    await redis.hSet(key, baseUpsert);
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

/** Flip status to completed. */
export async function markTripComplete(userId: string, tripId: string): Promise<PastTrip | null> {
    const redis = await getRedis();
    const now = new Date().toISOString();
    const key = tripKey(userId, tripId);

    await redis.hSet(key, {
        status: 'completed',
        completedAt: now,
        updatedAt: now,
    });

    return getTrip(userId, tripId);
}

/** Read a single trip. Returns null if not found. */
export async function getTrip(userId: string, tripId: string): Promise<PastTrip | null> {
    const redis = await getRedis();
    const h = await redis.hGetAll(tripKey(userId, tripId));
    if (!h || !Object.keys(h).length) return null;
    return hashToTrip(tripId, h);
}

/**
 * List all completed trips for a user, sorted newest-first by completedAt.
 *
 * Strategy: `KEYS user:<id>:trip:*` for this user's namespace, then HGETALL
 * each and filter by status. Acceptable for our scale; for production scale
 * we'd reintroduce a sorted-set index by completedAt.
 */
export async function listPastTrips(userId: string): Promise<PastTrip[]> {
    const redis = await getRedis();
    const prefix = tripKeyPrefix(userId);
    const keys = await redis.keys(`${prefix}*`);
    if (!keys.length) return [];

    const hashes = await Promise.all(keys.map((key) => redis.hGetAll(key)));
    const trips: PastTrip[] = [];
    for (let index = 0; index < keys.length; index++) {
        const hash = hashes[index];
        if (!hash?.status || hash.status !== 'completed') continue;
        const tripId = keys[index].slice(prefix.length);
        const trip = hashToTrip(tripId, hash);
        if (trip) trips.push(trip);
    }
    trips.sort((tripA, tripB) => (tripB.completedAt ?? '').localeCompare(tripA.completedAt ?? ''));
    return trips;
}

function hashToTrip(tripId: string, hash: Record<string, string>): PastTrip | null {
    if (!hash || !hash.tripId) return null;
    let pickedPois: POI[] = [];
    let interests: string[] = [];
    try {
        pickedPois = JSON.parse(hash.pickedPois ?? '[]');
    } catch {
        pickedPois = [];
    }
    try {
        interests = JSON.parse(hash.interests ?? '[]');
    } catch {
        interests = [];
    }
    const dates = hash.startDate && hash.endDate ? { start: hash.startDate, end: hash.endDate } : undefined;
    return {
        tripId,
        sessionId: tripId, // tripId == sessionId in v1
        city: (hash.city ?? 'bangalore') as City,
        dates,
        interests,
        pickedPois,
        createdAt: hash.createdAt,
        completedAt: hash.completedAt,
    };
}

/** Delete a trip's HASH outright. Used by Reset to clear the working slot. */
export async function deleteTrip(userId: string, tripId: string): Promise<void> {
    const redis = await getRedis();
    await redis.del(tripKey(userId, tripId));
}
