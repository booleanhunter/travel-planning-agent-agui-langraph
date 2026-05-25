import { z } from 'zod';

/**
 * Cities the agent can plan trips for.
 * KEEP IN SYNC WITH scripts/fetch-pois.js — the CITIES const there must
 * cover every id listed here (with lat/lng metadata for Google Places).
 */
export const CitySchema = z.enum([
    // India
    'bangalore',
    'mumbai',
    'delhi',
    'goa',
    'jaipur',
    'kochi',
    'manali',
    'hyderabad',
    // East / SE Asia
    'tokyo',
    'kyoto',
    'seoul',
    'singapore',
    'bangkok',
    'hanoi',
    'ubud',
    // Europe
    'barcelona',
    'lisbon',
    'paris',
    'london',
    'berlin',
    'amsterdam',
    'rome',
    'prague',
    // Middle East / Africa
    'istanbul',
    'dubai',
    'cape-town',
    'marrakech',
    // Americas
    'new-york',
    'san-francisco',
    'vancouver',
    'mexico-city',
    'buenos-aires',
    // Oceania
    'sydney',
]);
export type City = z.infer<typeof CitySchema>;

/**
 * Display names for the destination picker / UI labels.
 * TypeScript enforces every City has an entry.
 */
export const CITY_DISPLAY_NAMES: Record<City, string> = {
    bangalore: 'Bangalore',
    mumbai: 'Mumbai',
    delhi: 'Delhi',
    goa: 'Goa',
    jaipur: 'Jaipur',
    kochi: 'Kochi',
    manali: 'Manali',
    hyderabad: 'Hyderabad',
    tokyo: 'Tokyo',
    kyoto: 'Kyoto',
    seoul: 'Seoul',
    singapore: 'Singapore',
    bangkok: 'Bangkok',
    hanoi: 'Hanoi',
    ubud: 'Ubud',
    barcelona: 'Barcelona',
    lisbon: 'Lisbon',
    paris: 'Paris',
    london: 'London',
    berlin: 'Berlin',
    amsterdam: 'Amsterdam',
    rome: 'Rome',
    prague: 'Prague',
    istanbul: 'Istanbul',
    dubai: 'Dubai',
    'cape-town': 'Cape Town',
    marrakech: 'Marrakech',
    'new-york': 'New York',
    'san-francisco': 'San Francisco',
    vancouver: 'Vancouver',
    'mexico-city': 'Mexico City',
    'buenos-aires': 'Buenos Aires',
    sydney: 'Sydney',
};

export const POICategorySchema = z.enum([
    'food',
    'culture',
    'outdoors',
    'nightlife',
    'shopping',
    'other',
]);
export type POICategory = z.infer<typeof POICategorySchema>;

export const POISchema = z.object({
    id: z.string(), // Google placeId
    name: z.string(),
    description: z.string(),
    rating: z.number(), // 0..5
    photoUrl: z.string().nullable(),
    category: POICategorySchema,
    city: CitySchema,
    lat: z.number(),
    lng: z.number(),
    /** Optional KNN score from the hybrid search (lower = closer). */
    score: z.number().optional(),
});
export type POI = z.infer<typeof POISchema>;
