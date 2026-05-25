import type { POI, City } from '#modules/places/types.js';
import type { PastTrip } from '../types.js';
import {
    ensureTripDraft as repoEnsureTripDraft,
    updateTripPickedPois as repoUpdateTripPickedPois,
    markTripComplete as repoMarkTripComplete,
    getTrip as repoGetTrip,
    listPastTrips as repoListPastTrips,
} from '../data/trips-repository.js';

interface DraftFields {
    city?: City;
    startDate?: string;
    endDate?: string;
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
