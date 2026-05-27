# Google OAuth setup — Calendar integration

Step-by-step for registering a Google OAuth 2.0 client so the `saveTripToCalendar` MCP tool can write events to a user's Google Calendar.

Used by:
- `server/src/modules/calendar/domain/google-oauth-service.ts` (authorize URL builder + code exchange)
- `server/src/modules/calendar/domain/calendar-service.ts` (event creation against `googleapis.com/calendar/v3`)
- `server/src/modules/calendar/api/oauth-routes.ts` (the callback handler at `/oauth/google/callback`)

Time: ~5 minutes if you already have a Google account.

---

> ### ⚠️ Don't forget: Test users
>
> While the app is in **Testing** mode (which it always is until you submit it for Google's verification), **only Google accounts explicitly added as test users can complete the OAuth flow.** Everyone else is blocked with *"trip-itinerary-demo has not completed the Google verification process"* — no bypass.
>
> Add every demo account in the **Test users** section of the OAuth consent screen (covered in step 3). For day-of-demo: include the primary demo account, a backup account, and anyone rehearsing.

---

## 1. Create or pick a Google Cloud project

Go to https://console.cloud.google.com/ — sign in with your Google account.

Top bar → project dropdown → **New Project**. Name it `trip-itinerary-demo` (or anything). Click **Create**.

Make sure the new project is selected in the top bar before continuing.

---

## 2. Enable the Google Calendar API

Left sidebar → **APIs & Services** → **Library**.

Search "Google Calendar API" → click the result → **Enable**.

---

## 3. Configure the OAuth consent screen

Left sidebar → **APIs & Services** → **OAuth consent screen**.

### App information

- **User type**: **External** (unless you have a Google Workspace org). Click **Create**.
- **App name**: `Trip Itinerary Demo`
- **User support email**: your email
- **Developer contact**: your email
- Logo / domain: leave blank — not needed for testing
- Click **Save and Continue**

### Scopes

Click **Add or Remove Scopes** → search `calendar.events` → check:

```
https://www.googleapis.com/auth/calendar.events
```

**Do not** pick the broader `calendar` scope — `calendar.events` is just create/edit events, which is all we need.

Click **Update** → **Save and Continue**.

### Test users

**Critical step.** While the OAuth app is in **Testing** mode, only Google accounts added here can complete the sign-in flow. Anyone else hits a hard block (*"trip-itinerary-demo has not completed the Google verification process"*) with no override.

Click **+ Add users** → enter Google emails (one per line or comma-separated) → **Save**.

Who to add:

- Your primary demo Google account
- A backup account (in case the primary fails on demo day)
- Anyone rehearsing the flow

The list takes effect immediately — no propagation delay. You can add up to 100 test users.

### Modifying the list later

You don't need to re-run the consent-screen wizard to change test users. Jump straight to the Test users panel at:

```
https://console.cloud.google.com/apis/credentials/consent
```

(Make sure the right project is selected in the top bar.) Each user has a delete icon; the **+ Add users** button adds more. No redeploy needed.

Click **Save and Continue** → **Back to Dashboard**.

---

## 4. Create the OAuth 2.0 Client ID

Left sidebar → **APIs & Services** → **Credentials**.

Top → **Create Credentials** → **OAuth client ID**.

- **Application type**: **Web application**
- **Name**: `trip-itinerary-local` (anything)
- **Authorized JavaScript origins**: leave empty
- **Authorized redirect URIs**: click **Add URI**, paste:

  ```
  http://localhost:3000/oauth/google/callback
  ```

  This must exactly match `GOOGLE_OAUTH_REDIRECT_URI` in `.env` (and the default in `server/src/config.ts`). Trailing slashes and port number matter.

- Click **Create**.

A modal pops up with your **Client ID** and **Client Secret**. Copy both. You can also download the JSON, but env vars are simpler.

---

## 5. Put credentials in `.env`

In `app/.env` (create if missing):

```bash
GOOGLE_OAUTH_CLIENT_ID=<the long .apps.googleusercontent.com id>
GOOGLE_OAUTH_CLIENT_SECRET=<the GOCSPX-... secret>
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/oauth/google/callback
PUBLIC_BASE_URL=http://localhost:3000
```

Restart the server. `tsx watch` should pick up `.env` changes, but explicit restart is safer.

---

## 6. End-to-end test

1. Start server + client as usual.
2. From an MCP client (Claude Desktop, MCP Inspector, or `mcp-remote`), call `saveTripToCalendar` with a `tripId` that exists in the trip store:
   - `newSessionId` if you've planned something in the current session
   - `seed-ashwin-bangalore` (or any other seeded past trip — see `server/datasets/users.json`)
3. The tool fires a URL-mode elicit. Your MCP client opens
   `http://localhost:3000/oauth/google/start?elicitationId=<uuid>` in the browser.
4. Browser redirects to Google → sign in → Google asks for `calendar.events` permission → click **Allow**.
5. Google redirects back to `/oauth/google/callback` → our server exchanges the code, stores the token in Redis under `user:<userId>:google-token`, resolves the deferred Promise the MCP tool is awaiting.
6. The MCP tool returns success with a link to the created calendar event.

---

## Gotchas

### "This app isn't verified" warning

Expected for Testing-mode OAuth apps. Click **Advanced** → **Go to Trip Itinerary Demo (unsafe)**. Only test users added in step 3 can do this; everyone else is blocked. Fine for demo.

### Redirect URI mismatch

Google is strict. The URI registered in the Credentials screen must character-for-character match what the server redirects to. If you change the port, path, or add/remove a trailing slash, you must add the new URI in the Cloud Console.

### Tokens expire in 1 hour

We don't request `offline_access` / refresh tokens. For a single demo block this is fine; after that, the next `saveTripToCalendar` call will re-trigger the URL-mode elicit and re-authorize.

To enable refresh tokens, add `access_type=offline` and `prompt=consent` to the authorize URL in `google-oauth-service.ts:buildAuthorizeUrl`, then capture the `refresh_token` field from Google's token exchange response and store it alongside the access token.

### Stale tokens after testing

`POST /api/user/reset` (or the **Reset working trip** button in the memory drawer) clears the token, so the next call re-authorizes. Useful between demo runs.

### Multiple Google accounts

If you sign in to the wrong Google account during the OAuth flow, click your avatar in Google's chooser to switch. The token is stored per `userId` in our app (currently a fixed `'ashwin'`), not per Google account — so re-authorizing overwrites the previous token.

---

## Where to put the credentials in production

For a real deployment (not local demo):

- Use a dedicated Google Cloud project per environment (dev / staging / prod).
- Move the app from "Testing" to "In production" in the OAuth consent screen — requires Google's app verification process if you use sensitive scopes (calendar.events is non-sensitive, so verification is lighter).
- Store secrets in your secret manager (Google Secret Manager, AWS Secrets Manager, etc.), not in plaintext `.env` on the host.
- Add `access_type=offline` and persist refresh tokens (encrypted at rest).
- Validate the OAuth `state` parameter on callback as a CSRF guard. Today we trust whatever Google echoes back; this is fine for localhost but not for the open web.
