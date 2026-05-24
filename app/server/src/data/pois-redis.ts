import { SCHEMA_FIELD_TYPE, SCHEMA_VECTOR_FIELD_ALGORITHM, type RediSearchSchema } from 'redis';
import { getRedis } from '../lib/redis.js';
import { embedToBuffer } from '../lib/llm.js';
import type { City, POI, POICategory } from '../types.js';

export const INDEX_NAME = 'idx:pointsOfInterest';
export const KEY_PREFIX = 'pointsOfInterest:';
export const VECTOR_DIM = 1536;

const SCHEMA: RediSearchSchema = {
    name: { type: SCHEMA_FIELD_TYPE.TEXT },
    description: { type: SCHEMA_FIELD_TYPE.TEXT },
    city: { type: SCHEMA_FIELD_TYPE.TAG },
    category: { type: SCHEMA_FIELD_TYPE.TAG },
    types: { type: SCHEMA_FIELD_TYPE.TAG, SEPARATOR: '|' },
    rating: { type: SCHEMA_FIELD_TYPE.NUMERIC },
    location: { type: SCHEMA_FIELD_TYPE.GEO },
    vector: {
        type: SCHEMA_FIELD_TYPE.VECTOR,
        ALGORITHM: SCHEMA_VECTOR_FIELD_ALGORITHM.HNSW,
        TYPE: 'FLOAT32',
        DIM: VECTOR_DIM,
        DISTANCE_METRIC: 'COSINE',
    },
};

/**
 * Idempotent — creates the index if it doesn't exist.
 */
export async function ensurePoiIndex(): Promise<void> {
    const redis = await getRedis();
    try {
        await redis.ft.create(INDEX_NAME, SCHEMA, {
            ON: 'HASH',
            PREFIX: KEY_PREFIX,
        });
    } catch (err) {
        const msg = (err as Error).message ?? '';
        if (!msg.includes('Index already exists')) throw err;
    }
}

export async function upsertPoi(poi: POI, vector: Buffer): Promise<void> {
    const redis = await getRedis();
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

interface SearchOptions {
    city: City;
    interestQuery: string;
    k?: number;
}

/**
 * Hybrid retrieval: city TAG filter AND KNN over the embedding of `interestQuery`.
 */
export async function searchPois({ city, interestQuery, k = 12 }: SearchOptions): Promise<POI[]> {
    const redis = await getRedis();
    const queryVec = await embedToBuffer(interestQuery);

    const query = `(@city:{${city}})=>[KNN ${k} @vector $qv AS score]`;
    const result = await redis.ft.search(INDEX_NAME, query, {
        PARAMS: { qv: queryVec },
        SORTBY: 'score',
        DIALECT: 2,
        RETURN: [
            'name',
            'description',
            'city',
            'category',
            'rating',
            'photoUrl',
            'lat',
            'lng',
            'score',
        ],
        LIMIT: { from: 0, size: k },
    });

    return result.documents.map((doc): POI => {
        const v = doc.value as Record<string, string>;
        const id = doc.id.replace(KEY_PREFIX, '');
        return {
            id,
            name: v.name ?? '',
            description: v.description ?? '',
            city: (v.city as City) ?? city,
            category: (v.category as POICategory) ?? 'other',
            rating: Number(v.rating ?? 0),
            photoUrl: v.photoUrl || null,
            lat: Number(v.lat ?? 0),
            lng: Number(v.lng ?? 0),
            score: v.score ? Number(v.score) : undefined,
        };
    });
}
