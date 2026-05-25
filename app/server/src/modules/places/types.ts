import { z } from 'zod';

export const CitySchema = z.enum(['bangalore', 'mumbai', 'barcelona']);
export type City = z.infer<typeof CitySchema>;

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
