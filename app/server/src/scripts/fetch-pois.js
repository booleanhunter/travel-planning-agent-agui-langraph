/**
 * fetch-pois.js — one-time data acquisition: Google Places API → JSON
 *
 * Iterates over the CITIES list below, queries Google Places (Text Search)
 * for each city × category, normalizes the results into POI records, and
 * writes everything to server/fixtures/pois.json.
 *
 * This is the EXPENSIVE step (Google API quota). After running once, the
 * resulting fixtures/pois.json is committed to git, and anyone else can
 * seed Redis from the JSON without a Google API key (see seed-pois.js).
 *
 * To edit the list of cities or query templates: change the CITIES or
 * CATEGORY_QUERIES consts below. (Also keep CitySchema in sync at
 *   server/src/modules/places/types.ts )
 *
 * Run:
 *   GOOGLE_MAPS_API_KEY=... npm run fetch:pois -w server
 *
 * Output:
 *   server/fixtures/pois.json
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load .env from the app root (same path the server uses).
const __here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__here, '../../../.env'), quiet: true });

// ----- EDIT HERE: cities + query templates ---------------------------------

const CITIES = [
    // India
    { id: 'bangalore', displayName: 'Bangalore', center: { lat: 12.9716, lng: 77.5946 } },
    { id: 'mumbai', displayName: 'Mumbai', center: { lat: 19.076, lng: 72.8777 } },
    { id: 'delhi', displayName: 'Delhi', center: { lat: 28.6139, lng: 77.209 } },
    { id: 'goa', displayName: 'Goa', center: { lat: 15.2993, lng: 74.124 } },
    { id: 'jaipur', displayName: 'Jaipur', center: { lat: 26.9124, lng: 75.7873 } },
    { id: 'kochi', displayName: 'Kochi', center: { lat: 9.9312, lng: 76.2673 } },
    { id: 'manali', displayName: 'Manali', center: { lat: 32.2432, lng: 77.1892 } },
    { id: 'hyderabad', displayName: 'Hyderabad', center: { lat: 17.385, lng: 78.4867 } },

    // East / SE Asia
    { id: 'tokyo', displayName: 'Tokyo', center: { lat: 35.6762, lng: 139.6503 } },
    { id: 'kyoto', displayName: 'Kyoto', center: { lat: 35.0116, lng: 135.7681 } },
    { id: 'seoul', displayName: 'Seoul', center: { lat: 37.5665, lng: 126.978 } },
    { id: 'singapore', displayName: 'Singapore', center: { lat: 1.3521, lng: 103.8198 } },
    { id: 'bangkok', displayName: 'Bangkok', center: { lat: 13.7563, lng: 100.5018 } },
    { id: 'hanoi', displayName: 'Hanoi', center: { lat: 21.0285, lng: 105.8542 } },
    { id: 'ubud', displayName: 'Ubud', center: { lat: -8.5069, lng: 115.2625 } },

    // Europe
    { id: 'barcelona', displayName: 'Barcelona', center: { lat: 41.3851, lng: 2.1734 } },
    { id: 'lisbon', displayName: 'Lisbon', center: { lat: 38.7223, lng: -9.1393 } },
    { id: 'paris', displayName: 'Paris', center: { lat: 48.8566, lng: 2.3522 } },
    { id: 'london', displayName: 'London', center: { lat: 51.5074, lng: -0.1278 } },
    { id: 'berlin', displayName: 'Berlin', center: { lat: 52.52, lng: 13.405 } },
    { id: 'amsterdam', displayName: 'Amsterdam', center: { lat: 52.3676, lng: 4.9041 } },
    { id: 'rome', displayName: 'Rome', center: { lat: 41.9028, lng: 12.4964 } },
    { id: 'prague', displayName: 'Prague', center: { lat: 50.0755, lng: 14.4378 } },

    // Middle East / Africa
    { id: 'istanbul', displayName: 'Istanbul', center: { lat: 41.0082, lng: 28.9784 } },
    { id: 'dubai', displayName: 'Dubai', center: { lat: 25.2048, lng: 55.2708 } },
    { id: 'cape-town', displayName: 'Cape Town', center: { lat: -33.9249, lng: 18.4241 } },
    { id: 'marrakech', displayName: 'Marrakech', center: { lat: 31.6295, lng: -7.9811 } },

    // Americas
    { id: 'new-york', displayName: 'New York', center: { lat: 40.7128, lng: -74.006 } },
    { id: 'san-francisco', displayName: 'San Francisco', center: { lat: 37.7749, lng: -122.4194 } },
    { id: 'vancouver', displayName: 'Vancouver', center: { lat: 49.2827, lng: -123.1207 } },
    { id: 'mexico-city', displayName: 'Mexico City', center: { lat: 19.4326, lng: -99.1332 } },
    { id: 'buenos-aires', displayName: 'Buenos Aires', center: { lat: -34.6037, lng: -58.3816 } },

    // Oceania
    { id: 'sydney', displayName: 'Sydney', center: { lat: -33.8688, lng: 151.2093 } },
];

const CATEGORY_QUERIES = {
    food: ['popular restaurants', 'iconic local eateries'],
    culture: ['museums and historical landmarks'],
    outdoors: ['parks and outdoor walks'],
    nightlife: ['popular bars and live music'],
    shopping: ['famous shopping streets and markets'],
};

const PER_CATEGORY = 10;
const SEARCH_RADIUS_METERS = 15000;

// ----- Google Places API plumbing ------------------------------------------

const PLACES_BASE = 'https://places.googleapis.com/v1';
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

async function searchTextForCategory(apiKey, city, query) {
    const body = {
        textQuery: `${query} in ${city.displayName}`,
        locationBias: {
            circle: {
                center: { latitude: city.center.lat, longitude: city.center.lng },
                radius: SEARCH_RADIUS_METERS,
            },
        },
        maxResultCount: 20,
    };
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Places searchText failed (${res.status}): ${text}`);
    }
    return res.json();
}

function photoUrlFor(apiKey, ref) {
    if (!ref) return null;
    return `${PLACES_BASE}/${ref}/media?maxHeightPx=400&key=${apiKey}`;
}

function buildDescription(p) {
    const summary = p.editorialSummary?.text;
    if (summary) return summary;
    const primaryType = p.primaryTypeDisplayName?.text ?? '';
    const address = p.formattedAddress ?? '';
    return `${primaryType}${primaryType && address ? ' — ' : ''}${address}`.trim();
}

async function gatherForCategory(apiKey, city, category) {
    const queries = CATEGORY_QUERIES[category] ?? [];
    if (!queries.length) return [];
    const seen = new Set();
    const accepted = [];
    for (const q of queries) {
        if (accepted.length >= PER_CATEGORY) break;
        const data = await searchTextForCategory(apiKey, city, q);
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
                photoUrl: photoUrlFor(apiKey, p.photos?.[0]?.name),
                category,
                city: city.id,
                lat,
                lng,
            });
        }
    }
    return accepted;
}

async function gatherForCity(apiKey, city) {
    const categories = Object.keys(CATEGORY_QUERIES);
    const byCategory = await Promise.all(
        categories.map((c) => gatherForCategory(apiKey, city, c)),
    );
    return byCategory.flat();
}

// ----- Entry point ----------------------------------------------------------

const OUTPUT_PATH = resolve(__here, '../../fixtures/pois.json');

async function main() {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
        throw new Error('GOOGLE_MAPS_API_KEY is required (set it in the environment).');
    }

    console.log(`Fetching POIs for ${CITIES.length} cities × ${Object.keys(CATEGORY_QUERIES).length} categories…`);

    const allPois = [];
    for (const city of CITIES) {
        console.log(`  [${city.displayName}] fetching…`);
        const pois = await gatherForCity(apiKey, city);
        console.log(`  [${city.displayName}] got ${pois.length} POIs`);
        allPois.push(...pois);
    }

    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, JSON.stringify({ pois: allPois }, null, 2));
    console.log(`\n✓ Wrote ${allPois.length} POIs to ${OUTPUT_PATH}`);
}

main().catch((err) => {
    console.error('fetch-pois failed:', err);
    process.exit(1);
});
