import type { POI, City } from '#modules/places/types.js';
import { saveLongTermMemory, deleteWorkingMemory } from '#modules/user/domain/user-service.js';
import type { PastTrip } from '../types.js';
import {
    ensureTripDraft as repoEnsureTripDraft,
    updateTripPickedPois as repoUpdateTripPickedPois,
    markTripComplete as repoMarkTripComplete,
    getTrip as repoGetTrip,
    listPastTrips as repoListPastTrips,
    deleteTrip as repoDeleteTrip,
} from '../data/trips-repository.js';

interface DraftFields {
    city?: City;
    startDate?: string;
    endDate?: string;
    interests?: string[];
}

export function ensureDraft(
    userId: string,
    tripId: string,
    fields: DraftFields = {},
): Promise<void> {
    return repoEnsureTripDraft(userId, tripId, fields);
}

/**
 * Take the LLM's minimal {poiId, name}[] tool input, materialize each into a
 * full POI by looking up first in this turn's candidates, then in the prior
 * committed picks, then persist as the new picked set.
 *
 * Returns the enriched POI[] that was actually written.
 */
export async function commitPicks(
    userId: string,
    tripId: string,
    minimal: Array<{ poiId: string; name: string }>,
    currentCandidates: POI[],
    priorPicks: POI[],
): Promise<POI[]> {
    const priorById = new Map(priorPicks.map((p) => [p.id, p]));
    const enriched: POI[] = [];
    for (const m of minimal) {
        const fromCurrent = currentCandidates.find((p) => p.id === m.poiId);
        if (fromCurrent) {
            enriched.push(fromCurrent);
            continue;
        }
        const prior = priorById.get(m.poiId);
        if (prior) {
            enriched.push(prior);
            continue;
        }
        console.warn(
            `[trips-service] commitPicks — no POI data for id=${m.poiId} (${m.name}), dropping`,
        );
    }
    await repoUpdateTripPickedPois(userId, tripId, enriched);
    return enriched;
}

export function markComplete(userId: string, tripId: string): Promise<PastTrip | null> {
    return repoMarkTripComplete(userId, tripId);
}

export function getTrip(userId: string, tripId: string): Promise<PastTrip | null> {
    return repoGetTrip(userId, tripId);
}

export function listPastTrips(userId: string): Promise<PastTrip[]> {
    return repoListPastTrips(userId);
}

/**
 * Strip commas from POI names so AMS accepts them as entity values
 * (AMS uses commas as internal delimiters and rejects them).
 */
function sanitizeEntity(name: string): string {
    return name.split(',')[0].trim();
}

/**
 * Auto-generate a one-line trip summary from structured fields. Used by the
 * live archive path; the seed script uses hand-written summaries instead.
 */
function generateTripSummary(trip: PastTrip): string {
    const parts: string[] = [];
    const days = trip.dates
        ? Math.max(
              1,
              Math.round(
                  (new Date(trip.dates.end).getTime() - new Date(trip.dates.start).getTime()) /
                      (1000 * 60 * 60 * 24),
              ) + 1,
          )
        : null;
    parts.push(
        days
            ? `${days}-day trip to ${trip.city} from ${trip.dates!.start} to ${trip.dates!.end}.`
            : `Trip to ${trip.city}.`,
    );
    if (trip.interests.length) parts.push(`Focused on ${trip.interests.join(', ')}.`);
    if (trip.pickedPois.length)
        parts.push(`Picked: ${trip.pickedPois.map((p) => sanitizeEntity(p.name)).join(', ')}.`);
    return parts.join(' ');
}

/**
 * Archive a completed trip into AMS long-term memory as a `trip_history`
 * memory. Idempotent — uses a deterministic id; re-archiving overwrites.
 * Mirrors what the seed script writes for past trips.
 */
export async function archiveTripToMemory(userId: string, trip: PastTrip): Promise<void> {
    await saveLongTermMemory([
        {
            id: `${userId}:${trip.tripId}`,
            user_id: userId,
            topics: ['trip_history', trip.city, ...trip.interests],
            entities: trip.pickedPois.map((p) => sanitizeEntity(p.name)),
            text: generateTripSummary(trip),
        },
    ]);
}

/**
 * Reset the user's working planning slot:
 *   - delete the trip-store HASH for this session (working trip is gone)
 *   - wipe AMS working memory for the session (conversation cleared)
 *
 * Past trips (status: completed) are NOT touched — they live under different
 * tripIds and remain in trip-store + AMS long-term.
 */
export async function resetWorkingTrip(userId: string, sessionId: string): Promise<void> {
    await Promise.all([
        repoDeleteTrip(userId, sessionId),
        deleteWorkingMemory(sessionId).catch((err) =>
            console.error('[trips-service] deleteWorkingMemory failed:', (err as Error).message),
        ),
    ]);
}
