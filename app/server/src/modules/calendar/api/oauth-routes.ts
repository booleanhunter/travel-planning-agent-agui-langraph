/**
 * Express routes for the Google OAuth round-trip:
 *
 *   GET /oauth/google/start?elicitationId=<id>
 *     → 302 to Google's authorize URL. The MCP tool's URL-mode elicit points
 *       the user's browser here; we forward to Google with `state` = the
 *       elicitation id (so the callback can route back to the right pending
 *       flow).
 *
 *   GET /oauth/google/callback?code=...&state=<elicitationId>
 *     → Exchange the code for a token; persist; resolve the MCP tool's
 *       deferred; render a "you can close this tab" page.
 */

import { Router, type Request, type Response } from 'express';
import { buildAuthorizeUrl, completeOAuthFlow } from '../domain/google-oauth-service.js';

const router = Router();

router.get('/start', (req: Request, res: Response) => {
    const elicitationId = req.query.elicitationId as string | undefined;
    if (!elicitationId) {
        res.status(400).send('elicitationId is required');
        return;
    }
    res.redirect(buildAuthorizeUrl(elicitationId));
});

router.get('/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const elicitationId = req.query.state as string | undefined;
    const errorParam = req.query.error as string | undefined;

    if (errorParam) {
        res.status(400).send(html(`<h1>Google returned an error</h1><p>${errorParam}</p>`));
        return;
    }
    if (!code || !elicitationId) {
        res.status(400).send('Missing code or state');
        return;
    }

    try {
        await completeOAuthFlow(elicitationId, code);
        res.send(
            html(
                '<h1>✓ Signed in</h1>' +
                    '<p>You can close this tab and return to your chat.</p>',
            ),
        );
    } catch (err) {
        const msg = (err as Error).message;
        res.status(500).send(html(`<h1>OAuth failed</h1><pre>${escapeHtml(msg)}</pre>`));
    }
});

function escapeHtml(input: string): string {
    return input.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function html(body: string): string {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Google OAuth</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#111}h1{font-size:20px}pre{background:#f4f4f4;padding:12px;border-radius:6px;overflow:auto}</style>
</head><body>${body}</body></html>`;
}

export default router;
