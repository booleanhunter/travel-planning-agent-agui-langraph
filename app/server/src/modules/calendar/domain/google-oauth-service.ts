/**
 * Google OAuth flow for the saveTripToCalendar URL-mode elicitation.
 *
 * Three responsibilities:
 *
 * 1. Build the Google `authorize` URL (caller redirects user to it).
 * 2. Exchange the authorization `code` returned to /oauth/google/callback
 *    for an access token; persist the token per-user.
 * 3. Coordinate the async hand-off between the MCP tool (which is waiting
 *    for the OAuth flow to complete) and the HTTP callback (which actually
 *    receives the code from Google).
 *
 * The coordination uses an in-memory Map<elicitationId, Deferred> — the tool
 * registers a deferred when it fires the elicit; the callback resolves it
 * when Google returns the token.
 */

import { config } from '#config';
import { saveToken, getToken, deleteToken } from '../data/google-token-repository.js';
import type { GoogleToken } from '../types.js';

const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

// ----- Deferred coordination -----------------------------------------------

interface PendingFlow {
    userId: string;
    resolve: (token: GoogleToken) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingFlow>();

const PENDING_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

/**
 * Tool side: register a wait-for-OAuth-completion. Returns a promise that
 * resolves when /oauth/google/callback exchanges the code; rejects on timeout
 * or explicit cancel.
 */
export function awaitOAuthCompletion(elicitationId: string, userId: string): Promise<GoogleToken> {
    return new Promise<GoogleToken>((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(elicitationId);
            reject(new Error('OAuth flow timed out — user did not complete sign-in in time.'));
        }, PENDING_TIMEOUT_MS);

        pending.set(elicitationId, { userId, resolve, reject, timer });
    });
}

/** Tool side: cancel a pending wait (e.g. user clicked cancel on the URL prompt). */
export function cancelOAuthCompletion(elicitationId: string): void {
    const p = pending.get(elicitationId);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(elicitationId);
    p.reject(new Error('OAuth flow cancelled by user.'));
}

// ----- URL building --------------------------------------------------------

export function buildAuthorizeUrl(elicitationId: string): string {
    const url = new URL(GOOGLE_AUTH_BASE);
    url.searchParams.set('client_id', config.googleOauth.clientId);
    url.searchParams.set('redirect_uri', config.googleOauth.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', CALENDAR_SCOPE);
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', elicitationId); // ferry the elicitationId through Google
    return url.toString();
}

// ----- Callback side: exchange code + resolve the deferred -----------------

/**
 * Called by the OAuth callback route. Exchanges the Google auth `code` for
 * an access token, stores the token under `userId` (derived from the
 * pending-flow registration), and resolves the tool-side deferred.
 *
 * Returns the userId that was bound to this elicitationId so the caller can
 * issue any UI hints (e.g. "tab can be closed").
 */
export async function completeOAuthFlow(elicitationId: string, code: string): Promise<string> {
    const flow = pending.get(elicitationId);
    if (!flow) {
        throw new Error(
            `No pending OAuth flow for elicitationId=${elicitationId} (expired or already complete?)`,
        );
    }

    const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: config.googleOauth.clientId,
            client_secret: config.googleOauth.clientSecret,
            redirect_uri: config.googleOauth.redirectUri,
            grant_type: 'authorization_code',
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        const err = new Error(`Google token exchange failed (${res.status}): ${body}`);
        clearTimeout(flow.timer);
        pending.delete(elicitationId);
        flow.reject(err);
        throw err;
    }

    const body = (await res.json()) as {
        access_token: string;
        expires_in: number;
        scope?: string;
        token_type?: string;
    };

    const token: GoogleToken = {
        accessToken: body.access_token,
        expiresAt: Date.now() + body.expires_in * 1000,
        scope: body.scope,
        tokenType: body.token_type,
    };

    await saveToken(flow.userId, token);
    clearTimeout(flow.timer);
    pending.delete(elicitationId);
    flow.resolve(token);

    return flow.userId;
}

/** Read a previously-stored token; returns null if expired (caller re-auths). */
export async function getValidToken(userId: string): Promise<GoogleToken | null> {
    const token = await getToken(userId);
    if (!token) return null;
    if (token.expiresAt <= Date.now() + 30_000) return null; // 30s safety margin
    return token;
}

export async function clearToken(userId: string): Promise<void> {
    await deleteToken(userId);
}
