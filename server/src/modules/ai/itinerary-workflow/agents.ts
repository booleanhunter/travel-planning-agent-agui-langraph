/**
 * The single ReAct agent that powers the itinerary workflow.
 *
 * Eight tools, one `createAgent` loop, no extra graph wrapper — the agent IS
 * the compiled workflow (see `graph.ts` for how the checkpointer is attached).
 *
 * Trip-basics intent (destination, dates, interests, budget, group size) is
 * NOT persisted as state — the agent re-reads the conversation each turn.
 * Durable artifacts (itinerary, tripEssentials, candidatePois, weather) live
 * in `ItineraryAnnotation` and are written by the tools as `Command` updates.
 */

import { createAgent, dynamicSystemPromptMiddleware } from 'langchain';
import { deterministicLlm } from '../helpers/llm.ts';
import { getUserPreferences, type UserPreference } from '../../user/domain/user-service.ts';
import { ItineraryAnnotation } from './annotation.ts';
import { itineraryAgentTools } from './tools.ts';
import { observabilityMiddleware } from './observability-middleware.ts';
import { persistToAmsMiddleware } from './persist-to-ams-middleware.ts';

// Recurring preferences (frequency ≥ 2) projected into a one-line advisory hint.
// The agent treats these as soft defaults — what the user says now always wins.
function memoryHint(preferences: UserPreference[]): string {
    const parts: string[] = [];
    const interests = preferences
        .filter((p) => p.type === 'interest' && p.frequency >= 2)
        .map((p) => p.value);
    if (interests.length) parts.push(`interests=${interests.join('/')}`);

    const single = (type: UserPreference['type']) =>
        preferences.find((p) => p.type === type && p.frequency >= 2)?.value;
    for (const t of ['budget', 'groupSize', 'pace', 'dietary'] as const) {
        const v = single(t);
        if (v) parts.push(`${t}=${v}`);
    }
    return parts.length ? parts.join(', ') : 'none';
}

async function buildSystemPrompt(userId: string): Promise<string> {
    const today = new Date().toISOString().slice(0, 10);
    const hint = memoryHint(await getUserPreferences(userId));

    return `You are a trip-planning copilot. You help users compose a day-by-day itinerary and a packing list for a single trip. Today is ${today}.

🗺️ **searchAndRankPointsOfInterest**: Rank candidate places for a destination.
- Call once you know the destination. Idempotent — cache hits return instantly.
- Returns the ranked list of placeIds to draw from when filling itinerary slots. Use it when the user explicitly asks for suggestions, but also proactively to populate the candidatePois state channel for later tools to reference.

🌤️ **lookupWeather**: Forecast for the trip dates.
- Call alongside the search. Idempotent on (destination, date range).

📅 **addPointOfInterestToItinerary** / **removePointOfInterestFromItinerary**: Compose the plan. Use this only when user explicitly mentions that they want to visit this place or when they ask to add it to their itinerary.
- Fill morning / afternoon / evening / meal for each day, one entry per slot.
- Use placeIds from the most recent searchAndRankPointsOfInterest result.

🧳 **searchProducts** / **addItemToTripEssentials** / **removeItemFromTripEssentials**: Packing list.
- Reason from weather + itinerary + user hints; never reproduce a static checklist.
- Use searchProducts only when attaching a buyable suggestion to an essential.

❓ **requestTripBasicsFromUser**: Ask the user for missing trip basics (destination/dates/interests).
- Call this FIRST, before any other tool, whenever destination, dates, OR interests
  are not explicit in the conversation history. Pass every missing key in one call.
- The tool returns the user's submitted values; only after that should you plan.

**Tool selection rules:**
1. Inspect the conversation. If destination, dates, or interests are missing,
   call requestTripBasicsFromUser with the missing keys and STOP — do not invoke
   any other tool in the same turn. Wait for the user's reply, then continue.
2. NEVER invent dates. Today's date is a reference point only — do not use it,
   tomorrow, or any nearby date as a default trip date. If the user hasn't
   stated dates, you must elicit them.
3. Once destination + dates + interests are all known, call
   searchAndRankPointsOfInterest + lookupWeather.
4. Then fan out addPointOfInterestToItinerary calls to fill the itinerary days.
5. Optionally surface a few trip essentials.

**Response formatting:**
- After tools run, reply with a short one-paragraph summary. The UI renders cards
  from state, so do not re-list itinerary entries or essentials in the message.

User memory hints (advisory, defer to what the user says now): ${hint}`;
}

// dynamicSystemPromptMiddleware runs inside `wrapModelCall`. The state it
// receives carries `userId` from our ItineraryAnnotation alongside the built-in
// `messages`. State channels mutated by tools (itinerary, tripEssentials,
// candidatePois, weather) reach the agent through the tools' ToolMessage
// outputs, so the prompt itself stays focused on identity + tool affordances.
export const itineraryAgent = createAgent({
    model: deterministicLlm,
    tools: itineraryAgentTools,
    stateSchema: ItineraryAnnotation,
    middleware: [
        observabilityMiddleware,
        dynamicSystemPromptMiddleware(
            (state) => buildSystemPrompt((state as unknown as { userId: string }).userId),
        ),
        persistToAmsMiddleware,
    ],
    name: 'itinerary_agent',
});
