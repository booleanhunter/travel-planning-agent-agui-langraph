import type { City, POI } from '../../../types.js';
import {
    searchPois as repoSearchPois,
    upsertPoi as repoUpsertPoi,
    ensurePoiIndex as repoEnsurePoiIndex,
} from '../data/places-repository.js';

interface SearchOptions {
    city: City;
    interestQuery: string;
    k?: number;
}

export function searchPois(opts: SearchOptions): Promise<POI[]> {
    return repoSearchPois(opts);
}

export function upsertPoi(poi: POI, vector: Buffer): Promise<void> {
    return repoUpsertPoi(poi, vector);
}

export function ensurePoiIndex(): Promise<void> {
    return repoEnsurePoiIndex();
}
