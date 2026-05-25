import { z } from 'zod';
import { CitySchema, POISchema } from '#modules/places/types.js';

export const PastTripSchema = z.object({
    tripId: z.string(),
    sessionId: z.string(),
    city: CitySchema,
    dates: z.object({ start: z.string(), end: z.string() }).optional(),
    /** Picked places stored as full POI records for round-tripping to the UI. */
    pickedPois: z.array(POISchema),
    createdAt: z.string().optional(),
    completedAt: z.string().optional(),
});
export type PastTrip = z.infer<typeof PastTripSchema>;
