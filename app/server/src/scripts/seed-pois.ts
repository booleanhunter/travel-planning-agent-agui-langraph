/**
 * One-time seed script: Google Places API → Redis hybrid index.
 *
 * Fetches ~10 POIs per category (food, culture, outdoors, nightlife, shopping) per
 * supported city, embeds the description with text-embedding-3-small, and writes
 * to `pointsOfInterest:{placeId}` hashes under the `idx:pointsOfInterest` FT index.
 *
 * Usage: GOOGLE_MAPS_API_KEY=... npm run seed:pois
 */

import { config } from '../config.js';
import { closeRedis } from '../lib/redis.js';
import { embedToBuffer } from '../lib/llm.js';
import { ensurePoiIndex, upsertPoi } from '../data/pois-redis.js';
import type { City, POI, POICategory } from '../types.js';

const PLACES_BASE = 'https://places.googleapis.com/v1';

const CITY_CENTER: Record<City, { lat: number; lng: number }> = {
    bangalore: { lat: 12.9716, lng: 77.5946 },
    mumbai: { lat: 19.076, lng: 72.8777 },
    barcelona: { lat: 41.3851, lng: 2.1734 },
};

const CATEGORY_QUERIES: Record<POICategory, string[]> = {
    food: ['popular restaurants', 'iconic local eateries'],
    culture: ['museums and historical landmarks'],
    outdoors: ['parks and outdoor walks'],
    nightlife: ['popular bars and live music'],
    shopping: ['famous shopping streets and markets'],
    other: [],
};

const PER_CATEGORY = 10;
const FIELD_MASK = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.rating',
    'places.types',
    'places.editorialSummary',
    'places.primaryTypeDisplayName',
    'places.photos',
].join(',');

interface PlaceRecord {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    rating?: number;
    types?: string[];
    editorialSummary?: { text?: string };
    primaryTypeDisplayName?: { text?: string };
    photos?: Array<{ name?: string }>;
}

interface PlacesTextResponse {
    places?: PlaceRecord[];
}

async function searchTextForCategory(
    city: City,
    category: POICategory,
    query: string,
): Promise<PlacesTextResponse> {
    const center = CITY_CENTER[city];
    const body = {
        textQuery: `${query} in ${city}`,
        locationBias: {
            circle: { center: { latitude: center.lat, longitude: center.lng }, radius: 15000 },
        },
        maxResultCount: 20,
    };
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': config.googleMapsApiKey,
            'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Places searchText failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<PlacesTextResponse>;
}

function photoUrlFor(ref: string | undefined): string | null {
    if (!ref) return null;
    return `${PLACES_BASE}/${ref}/media?maxHeightPx=400&key=${config.googleMapsApiKey}`;
}

function buildDescription(p: PlaceRecord): string {
    const summary = p.editorialSummary?.text;
    if (summary) return summary;
    const primaryType = p.primaryTypeDisplayName?.text ?? '';
    const address = p.formattedAddress ?? '';
    return `${primaryType}${primaryType && address ? ' — ' : ''}${address}`.trim();
}

async function gatherForCategory(city: City, category: POICategory): Promise<POI[]> {
    const queries = CATEGORY_QUERIES[category];
    if (!queries.length) return [];
    const seen = new Set<string>();
    const accepted: POI[] = [];
    for (const q of queries) {
        if (accepted.length >= PER_CATEGORY) break;
        const data = await searchTextForCategory(city, category, q);
        for (const p of data.places ?? []) {
            if (!p.id || seen.has(p.id)) continue;
            if (accepted.length >= PER_CATEGORY) break;
            seen.add(p.id);
            const lat = p.location?.latitude;
            const lng = p.location?.longitude;
            if (lat === undefined || lng === undefined) continue;
            accepted.push({
                id: p.id,
                name: p.displayName?.text ?? 'Unknown',
                description: buildDescription(p),
                rating: p.rating ?? 0,
                photoUrl: photoUrlFor(p.photos?.[0]?.name),
                category,
                city,
                lat,
                lng,
            });
        }
    }
    return accepted;
}

async function seedCity(city: City): Promise<number> {
    console.log(`\n[${city}] starting seed`);
    const categories: POICategory[] = ['food', 'culture', 'outdoors', 'nightlife', 'shopping'];

    // Fetch all categories in parallel
    const byCategory = await Promise.all(
        categories.map((c) => gatherForCategory(city, c).then((pois) => ({ category: c, pois }))),
    );

    const all = byCategory.flatMap((b) => b.pois);
    console.log(`[${city}] fetched ${all.length} POIs across ${categories.length} categories`);

    // Embed + upsert (serialized to avoid rate-limit hammer)
    let count = 0;
    for (const poi of all) {
        const textToEmbed = `${poi.name}. ${poi.description}. Category: ${poi.category}. City: ${poi.city}.`;
        const vec = await embedToBuffer(textToEmbed);
        await upsertPoi(poi, vec);
        count++;
        if (count % 10 === 0) console.log(`[${city}] ${count}/${all.length} embedded + written`);
    }
    console.log(`[${city}] done — ${count} POIs written`);
    return count;
}

async function main(): Promise<void> {
    if (!config.googleMapsApiKey) {
        throw new Error('GOOGLE_MAPS_API_KEY is required for seeding');
    }
    console.log('Ensuring idx:pointsOfInterest exists...');
    await ensurePoiIndex();

    let total = 0;
    for (const city of config.cities) {
        total += await seedCity(city);
    }
    console.log(`\nDone. Total POIs written: ${total}`);
    await closeRedis();
}

main().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});
