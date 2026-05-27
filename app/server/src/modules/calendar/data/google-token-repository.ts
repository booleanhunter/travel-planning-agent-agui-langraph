/**
 * Per-user Google OAuth token storage in Redis.
 *
 *   user:{userId}:google-token   HASH  — { accessToken, expiresAt, scope, tokenType }
 *
 * Tokens are kept until reset clears them (or they naturally expire).
 */

import { getRedis } from '#lib/redis.js';
import type { GoogleToken } from '../types.js';

const tokenKey = (userId: string) => `user:${userId}:google-token`;

export async function saveToken(userId: string, token: GoogleToken): Promise<void> {
    const redis = await getRedis();
    await redis.hSet(tokenKey(userId), {
        accessToken: token.accessToken,
        expiresAt: String(token.expiresAt),
        scope: token.scope ?? '',
        tokenType: token.tokenType ?? '',
    });
}

export async function getToken(userId: string): Promise<GoogleToken | null> {
    const redis = await getRedis();
    const h = await redis.hGetAll(tokenKey(userId));
    if (!h || !h.accessToken) return null;
    return {
        accessToken: h.accessToken,
        expiresAt: Number(h.expiresAt ?? 0),
        scope: h.scope || undefined,
        tokenType: h.tokenType || undefined,
    };
}

export async function deleteToken(userId: string): Promise<void> {
    const redis = await getRedis();
    await redis.del(tokenKey(userId));
}
