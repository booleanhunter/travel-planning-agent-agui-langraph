import { z } from 'zod';

/** Google OAuth token stored per-user in Redis. */
export const GoogleTokenSchema = z.object({
    accessToken: z.string(),
    /** ms epoch; client refreshes via re-auth when expired. */
    expiresAt: z.number(),
    scope: z.string().optional(),
    tokenType: z.string().optional(),
});
export type GoogleToken = z.infer<typeof GoogleTokenSchema>;
