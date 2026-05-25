import { z } from 'zod';
import { CitySchema } from '#modules/places/types.js';

export const WeatherSchema = z.object({
    city: CitySchema,
    month: z.number(), // 1..12
    high: z.number(), // celsius
    low: z.number(),
    condition: z.string(),
    precipitationChance: z.number(), // 0..1
});
export type Weather = z.infer<typeof WeatherSchema>;
