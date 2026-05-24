# Known Issues

## Wrong POI gets picked when user adds a place by name that isn't in the current candidate list

### Symptom

User has 3 picks committed:
1. Sin City Rooftop Resto & Lounge
2. The Bombay Canteen
3. Prithvi Cafe

User asks for cultural landmarks. Agent's reply mentions Kala Ghoda Art Precinct (among others). User says "add kala ghoda as well" in chat.

Agent's text response says "I've added the Kala Ghoda Art Precinct." But Redis now contains:

```
[Sin City, Bombay Canteen, Prithvi Cafe, Lake View Cafe]   ← Lake View Cafe, not Kala Ghoda
```

Lake View Cafe is a real entry at `pointsOfInterest:ChIJVVVVZgC45zsRV4SB6sd1V2M` — a Mumbai food spot whose description mentions "vibrant decor."

### Root cause (from server logs)

Two issues compound:

**1. `TravelAgent` re-widens the `interests` slot.**

Client sends `interests=[culture]` (carried forward from the previous turn). TravelAgent's LLM looks at the conversation history, reads "add kala ghoda **as well**" as "add to my broader set," and re-extracts:

```
[travel-agent] LLM — intent=itineraryPlanning destination=mumbai
  interests=[food,offbeat,slow,landmarks,nightlife,outdoors,culture]   ← all 7!
```

**2. `FetchRecs` runs the broad query for turn 3.**

```
[fetch-recs] query="food · offbeat · slow · landmarks · nightlife · outdoors · culture"
[fetch-recs] returned 12 POIs (top: Sin City, Little Easy, Bombay Canteen)
```

Kala Ghoda is no longer in the top-12. Lake View Cafe (food, ★4.7, description matches the noisy embedding) makes it in.

**3. `FollowUp`'s system prompt forces the LLM to pick from `state.pois`.**

> *"When called, pass the COMPLETE new picked set (replace semantics) using only poiIds from the candidate list below."*

The LLM has no valid ID for Kala Ghoda. It substitutes the closest candidate it can find — Lake View Cafe.

**4. Tool body trusts the `poiId` and ignores the `name`.**

```ts
const fromCurrent = state.pois.find((p) => p.id === m.poiId);
if (fromCurrent) { enriched.push(fromCurrent); continue; }
```

Looks up `ChIJVVVV...` → gets Lake View Cafe (correct data for that ID) → writes it to Redis.

**5. The textResponse LLM doesn't know what was actually picked.**

The tool returns `{updated: true, count: 4}` — no names. The second LLM call paraphrases the user's request, says "Added Kala Ghoda." Hence the gaslighting effect.

Not a hallucination — every component is doing what we told it to. The system is just structurally incoherent for this scenario.

### Candidate fixes (TBD — discussed but not applied)

**1. Validate name matches `poiId` in the tool body.**
Smallest diff. Drop picks where the resolved POI's name doesn't match the LLM-supplied name.
- Pro: tiny change, defensive safety net.
- Con: silent — the second LLM still reports "Added Kala Ghoda" even though nothing was added. Pair with #5.

**2. Send `state.pois` from the client every turn.**
The client's `gridPois` already includes Kala Ghoda (it accumulates orphans). Mirror it to the server so `FollowUp`'s LLM sees what the user sees.
- Pro: mirrors how `pickedPois` already flows. Server stays stateless. Eliminates the Kala Ghoda case structurally.
- Con: larger per-turn payload. Decouples "candidates the LLM sees" from "candidates this turn's vector search returned."

**3. Accumulate `state.pois` server-side per session.**
Redis-backed cache. Every `FetchRecs` merges into a session POI cache. `FollowUp` shows the cumulative cache.
- Pro: server stays source of truth.
- Con: introduces session state. Candidate list shown to LLM grows unbounded.

**4. Don't re-run `FetchRecs` on edit-like turns.**
If intent looks like "add X" / "remove X" / "swap," skip the fetch. Useful only in combination with #2 (so the LLM has prior pois to act on).

**5. Stop the textResponse LLM from inventing.**
Pass the actual added names back through the tool message:
```ts
content: JSON.stringify({ updated: true, added: enriched.map(p => p.name) })
```
Doesn't fix the wrong-pick, but stops the gaslighting. Apply regardless of which other fix lands.

**6. Switch the tool from IDs to names + server-side resolution.**
Drop `poiId` from the tool schema. Accept names. Tool body resolves each name via:
(a) `state.pois`, (b) `state.pickedPois`, (c) `FT.SEARCH @name @city` over the full POI index.
- Pro: names are stable across turns; LLM can't pass an id/name mismatch (there's no id field); step (c) finds Kala Ghoda even when this turn's KNN misses it.
- Con: name collisions theoretically possible within a city.

**7. Fix TravelAgent's interest re-extraction.**
Separate concern from the wrong-pick, but it's the *trigger*. Tell the extractor to preserve the existing `interests` slot when the user's message doesn't introduce new interests. Edit-style messages ("add X", "remove Y") shouldn't trigger re-extraction at all.

### Files involved

- `server/src/agent/nodes/travel-agent.ts` — interest re-extraction (fix #7)
- `server/src/agent/nodes/fetch-recs.ts` — query construction
- `server/src/agent/nodes/follow-up.ts` — tool schema, system prompt, tool body, textResponse handoff
- `client/src/hooks/useAgentStream.ts` — would change for fix #2 (send pois)
- `server/src/data/pois-redis.ts` — would add a name-lookup helper for fix #6
