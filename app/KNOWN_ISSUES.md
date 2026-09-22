# Known Issues

## Wrong POI gets picked when the user adds a place by name that isn't in the current candidate list

### Symptom

User has 3 picks committed for a Bangalore food trip:
1. MTR (Mavalli Tiffin Rooms)
2. Koshy's
3. Karavalli

User asks for outdoors and nature spots. Agent's reply mentions Lalbagh Botanical Garden (among others). User says "add lalbagh as well" in chat.

Agent's text response says "I've added Lalbagh Botanical Garden." But Redis now contains:

```
[MTR, Koshy's, Karavalli, The Garden Café]   ← a food spot, not Lalbagh
```

The fourth entry is a real POI in the Bangalore index: a restaurant whose description mentions "lush greenery" and "garden seating." Correct data for that id, wrong place.

### Root cause (from server logs)

Several issues compound:

**1. `TravelAgent` re-widens the `interests` slot.**

The trip draft carries `interests=[outdoors]` from the previous turn. TravelAgent's LLM reads "add lalbagh **as well**" as "add to my broader set" and re-extracts every interest seen in the conversation:

```
[travel-agent] interests=[food,outdoors,slow,landmarks,culture]   ← widened
```

**2. `getPoiDetails("lalbagh")` runs against a noisy embedding.**

```
🔧 [tools] getPoiDetails — city=bangalore placeName="lalbagh"
[places] KNN returned 10 (top: The Garden Café, Lalbagh …?)
```

Vector similarity between "lalbagh" and POI descriptions is weak; food POIs with garden vocabulary compete with the actual botanical garden. On some runs Lalbagh is ranked low or missing from the top 10.

**3. The system prompt forces the LLM to pick from the candidate list.**

> *"Pass `pickedPois` as `[{poiId, name}]` using REAL ids from getPoiDetails … NEVER pass list indices."*

The LLM has a name it knows (from the turn-2 reply in working memory) but no confident id for it. It substitutes the closest candidate it can find.

**4. Tool body trusts the `poiId` and ignores the `name`.**

```ts
const fromCurrent = state.pois.find((p) => p.id === m.poiId);
if (fromCurrent) { enriched.push(fromCurrent); continue; }
```

Looks up the id → gets The Garden Café → writes it to Redis. Returns `{ updated: true, count: 4 }`.

**5. The final LLM iteration doesn't know what was actually picked.**

The tool result carries a count, no names. The model paraphrases the user's request and says "Added Lalbagh." Hence the gaslighting effect.

Not a hallucination — every component is doing what we told it to. The system is structurally incoherent for this scenario.

### Why this is a tracing problem

A tool-call trace of turn 3 is entirely green: `getPoiDetails` 200, `updateItinerary` 200, both generations 200. The failure is only visible in the **context** each step was given:

- Working memory returned 4 messages and all 4 were passed to the model, including the turn-2 reply that names Lalbagh. The agent *did* see it.
- The KNN retriever returned 10 candidates; Lalbagh's rank (or absence) is in the candidate list.
- The iteration-1 generation input shows the candidate-id block without a Lalbagh id and the instruction that forbids anything else.
- The `updateItinerary` input shows `name: "Lalbagh…"` next to a `poiId` that resolves to a different place.
- The iteration-2 generation input shows a `ToolMessage` with a count and no names.

This is the demo scenario for the talk (see `docs/phase-1-langfuse-prompt.md`, task 7, `npm run demo:lalbagh`).

### Candidate fixes (TBD — discussed but not applied)

**1. Validate name matches `poiId` in the tool body.**
Smallest diff. Drop picks where the resolved POI's name doesn't fuzzy-match the LLM-supplied name; return them as `rejected: [...]`.
- Pro: tiny change, defensive safety net.
- Con: silent unless paired with #5 — the final LLM would still say "Added Lalbagh."

**2. Send `state.pois` from the client every turn.**
The client's grid already accumulates candidates across turns. Mirror it to the server so the LLM sees what the user sees.
- Pro: server stays stateless. Eliminates the case structurally.
- Con: larger payload; decouples "candidates the LLM sees" from "candidates this turn's search returned."

**3. Accumulate `state.pois` server-side per session.**
Redis-backed cache merged on every search.
- Pro: server stays source of truth.
- Con: introduces session state; candidate list grows unbounded.

**4. Don't re-run search on edit-like turns.**
If intent looks like "add X" / "remove X" / "swap," skip the broad search. Only useful with #2 or #3.

**5. Stop the final LLM iteration from inventing.**
Return the actual names through the tool message:
```ts
content: JSON.stringify({ updated: true, added: enriched.map(p => p.name), rejected })
```
Doesn't fix the wrong pick, but stops the gaslighting. Apply regardless of which other fix lands.

**6. Switch the tool from ids to names + server-side resolution.**
Drop `poiId` from the tool schema. Resolve each name via (a) `state.pois`, (b) `state.pickedPois`, (c) `FT.SEARCH @name @city` over the full index.
- Pro: names are stable across turns; no id/name mismatch possible; (c) finds Lalbagh even when this turn's KNN misses it.
- Con: name collisions theoretically possible within a city.

**7. Fix TravelAgent's interest re-extraction.**
The trigger. Preserve the existing `interests` slot when the message doesn't introduce new interests; edit-style messages ("add X", "remove Y") shouldn't re-extract at all.

For the demo, fixes #1 and #5 are applied behind `DEMO_FIX=true` (see the Phase 1 prompt, task 7, `--fixed` mode). Default behaviour is unchanged.

### Files involved

- `server/src/modules/ai/agentic-trip-workflow/nodes/travel-agent.ts` — system prompt candidate block, interest re-extraction (#7), final-iteration handoff
- `server/src/modules/ai/agentic-trip-workflow/tools.ts` — `getPoiDetails`, `updateItinerary` tool body (#1, #5, #6)
- `server/src/modules/places/domain/places-service.ts` — KNN query; would add a name-lookup helper for #6
- `client/src/hooks/useAgentStream.ts` — would change for #2 (send pois)
