# 02 — User Flow Sequence Diagrams

Four sequences covering the demo's actual interaction paths.

Example question used throughout: **"Plan a trip to Bangalore."**

---

## Sequence 1 — Happy path: plan, then pack (two user turns)

User types a planning query. The router classifies it as `plan`, runs the elicit gate, then the `itinerary_planning_agent` calls its tools in a ReAct loop. Later, the user asks *"what should I pack?"* on a separate turn — the router classifies as `pack` and the `trip_preparation_agent` runs. Even a utilitarian prompt produces a non-empty `interests` array — the extractor reads broad descriptors from destination + duration when the user did not articulate explicitly.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React + CopilotKit
    participant LG as LangGraph<br/>(RUC + route_turn + elicit)
    participant Planner as itinerary_planning_agent
    participant Prep as trip_preparation_agent
    participant Mut as itinerary-workflow/state.ts
    participant AMS as Agent Memory Server
    participant Places as Google Places
    participant Redis as Redis hybrid index
    participant LLM as OpenAI
    participant Tavily as Tavily

    User->>UI: types: "Plan a trip to Bangalore"
    UI->>LG: AG-UI event with user prompt

    Note over LG,AMS: resolve_user_context
    LG->>AMS: searchLongTermMemory user_id=ashwin
    AMS-->>LG: prefs — interests=[food, arts] (each ×4) · budget=mid · group=solo

    Note over LG: route_turn → "plan"

    Note over LG,LLM: elicit_missing_inputs — single LLM extraction
    LG->>LLM: extract destination · duration · dates · budget · group · interests[]
    LLM-->>LG: destination=Bangalore<br/>interests=[food, landmarks, varied]<br/>(other slots missing — broad descriptors inferred<br/>from destination since user did not articulate)
    LG->>UI: elicit schema for duration · dates · interests
    UI-->>User: render inline chips · food + arts prefilled from memory
    User->>UI: fills chips — 5 days · October · keeps food + arts, adds landmarks
    UI->>LG: elicit response → graph resumes

    Note over LG,Planner: enter itinerary_planning_agent (ReAct)

    par Parallel tool calls — first ReAct step
        Planner->>Planner: tool: searchAndRankPointsOfInterest
        Planner->>Planner: tool: lookupWeather
    end

    Note over Planner,Redis: searchAndRankPointsOfInterest — 7 internal steps (emits tool-group)
    Planner->>Redis: cache_check · FT.SEARCH idx:pointsOfInterest<br/>@location:[lon lat radius km] LIMIT 0 0
    Redis-->>Planner: count = 0 — cold cache

    par Parallel Places Text Search — Beat 4.7 Performance
        Planner->>Places: search "places of interest in Bangalore"
        Planner->>Places: search "restaurants in Bangalore"
        Planner->>Places: search "activities in Bangalore"
    end
    Places-->>Planner: 22 unique points of interest

    Planner->>LLM: embed each description · text-embedding-3-small
    LLM-->>Planner: 22 vectors · 1536 dim
    Planner->>Redis: HSET pointsOfInterest:{id} fields + vector · EXPIRE 7d<br/>(cache write — turn 2 will hit)
    Planner->>LLM: embed interests descriptors
    LLM-->>Planner: query vector · 1536 dim
    Planner->>Redis: FT.SEARCH idx:pointsOfInterest · GEO + TAG + KNN
    Redis-->>Planner: 22 candidate points of interest ranked by interest + geo similarity
    Planner->>Planner: rank + diversify → returns top-N

    Planner->>Tavily: lookupWeather · Bangalore · October
    Tavily-->>Planner: forecast — rain expected Day 2

    Note over Planner: LLM picks a starter day plan and<br/>emits addPointOfInterestToItinerary tool calls
    loop for each chosen point of interest
        Planner->>Mut: addPointOfInterestToItinerary(pointOfInterestId, day, slot)
        Mut->>Redis: graph.updateState · state.itinerary append
    end

    Planner-->>UI: stream PoiCardGrid + ComposedItineraryPane updates
    UI-->>User: render point-of-interest cards · day plan · weather strip

    Note over User,Prep: Separate turn — user asks about packing
    User->>UI: types: "what should I pack?"
    UI->>LG: AG-UI event
    Note over LG: route_turn → "pack"
    LG->>Prep: enter trip_preparation_agent

    Note over Prep: LLM reads state.weather, state.itinerary,<br/>state.tripEssentials, state.interests,<br/>user.packingPreferences (from AMS)
    Note over Prep: Reasons dynamically: rain Day 2 + no umbrella<br/>in state.tripEssentials → suggest one

    Prep->>Tavily: searchProducts "compact travel umbrella"
    Tavily-->>Prep: 3 product results
    Prep-->>UI: stream ProductPickerCard
    UI-->>User: shows 3 umbrellas with filter chips
    User->>UI: picks one
    UI->>LG: AG-UI event ("the second one")
    LG->>Prep: re-enter agent
    Prep->>Mut: addItemToTripEssentials(umbrella, productId, owned=false)
    Mut->>Redis: graph.updateState · state.tripEssentials.umbrella
    Prep-->>UI: tool-row + EssentialSection re-render
```

---

## Sequence 2 — User refines on turn 2

After the first grid loads, the user articulates the interests they actually want. The router still classifies this as `plan` (or `edit` if the prompt explicitly names items), the same `itinerary_planning_agent` re-enters, and the LLM decides what tools to call. `searchAndRankPointsOfInterest` runs again with sharper `state.interests` — the cache write from turn 1 makes the second turn a warm-cache hit, so no Google Places calls fire.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React + CopilotKit
    participant LG as LangGraph<br/>(RUC + route_turn + elicit)
    participant Planner as itinerary_planning_agent
    participant Mut as itinerary-workflow/state.ts
    participant LLM as OpenAI
    participant Redis as Redis hybrid index

    Note over User,UI: Points of interest from turn 1 already on canvas
    User->>UI: types: "actually I want it to feel moody and slow —<br/>somewhere I can read in indie coffee shops<br/>and walk cobblestone streets alone"
    UI->>LG: AG-UI event — new turn

    Note over LG: route_turn → "plan" (sharper interests)

    Note over LG,LLM: elicit_missing_inputs — same extractor, sharper interests
    LG->>LLM: extract trip details + interests[] from new phrase
    LLM-->>LG: interests=[moody, slow, indie, contemplative,<br/>walkable, solitary]<br/>other slots already in state - new interests replace turn 1's

    Note over LG,Planner: re-enter itinerary_planning_agent

    Note over Planner,Redis: searchAndRankPointsOfInterest — warm cache
    Planner->>Redis: cache_check · FT.SEARCH idx:pointsOfInterest<br/>@location:[lon lat radius km] LIMIT 0 0
    Redis-->>Planner: count ≥ threshold — 22 points of interest cached from turn 1
    Note over Planner,Redis: no Google Places calls this turn
    Planner->>LLM: embed sharper interests descriptors
    LLM-->>Planner: query vector · 1536 dim
    Planner->>Redis: FT.SEARCH idx:pointsOfInterest · GEO + TAG + KNN
    Redis-->>Planner: 20 points of interest · KNN cluster tighter around new interests
    Planner->>Planner: rank + diversify → 8 coherent points of interest

    Note over Planner: LLM revises the day plan — emits remove + add tool calls
    loop for each point of interest being swapped out
        Planner->>Mut: removePointOfInterestFromItinerary(pointOfInterestId)
        Mut->>Redis: graph.updateState · state.itinerary dedupe-remove
    end
    loop for each newly chosen point of interest
        Planner->>Mut: addPointOfInterestToItinerary(pointOfInterestId, day, slot)
        Mut->>Redis: graph.updateState · state.itinerary append
    end

    Planner-->>UI: stream updated PoiCardGrid + ComposedItineraryPane diff
    UI-->>User: cards rebuild · day plan reshuffles
```

---

## Sequence 3 — Memory drawer + load past trip

Hamburger click opens the drawer. Clicking a past trip rehydrates the graph's working memory from the stored checkpoint and replays the conversation + canvas state.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React + CopilotKit
    participant Backend as Express · /api/memory
    participant AMS as Agent Memory Server
    participant Redis as Redis · RedisSaver checkpoints
    participant LG as LangGraph (itinerary-workflow)

    User->>UI: clicks hamburger
    UI->>Backend: GET /api/memory/profile · userId=ashwin

    par Parallel memory queries — semantic + episodic
        Backend->>AMS: searchLongTermMemory · semantic · prefs
        Backend->>AMS: searchLongTermMemory · episodic · trips
    end
    AMS-->>Backend: prefs + past trips
    Backend-->>UI: profile JSON
    UI-->>User: drawer slides in — Preferences + Past trips

    Note over User,UI: User clicks past trip
    User->>UI: clicks Kyoto · Oct 2024
    UI->>Backend: POST /api/memory/load-trip · tripId=kyoto-oct-2024

    Backend->>AMS: get trip episode by tripId
    AMS-->>Backend: trip metadata + sessionId

    Backend->>Redis: RedisSaver · fetch checkpoint for sessionId
    Redis-->>Backend: full ItineraryState · messages + state.itinerary + state.tripEssentials

    Backend->>LG: rehydrate graph with checkpoint
    Backend-->>UI: conversation + composed itinerary + essentials state

    UI-->>User: chat thread rehydrates with prior Kyoto conversation
    UI-->>User: canvas restores Kyoto points of interest + composed day + packed items
    Note over User,UI: User can continue editing or start a new turn
```

---

## Sequence 4 — Bidirectional sync (UI ↔ chat)

Either surface can mutate `state.tripEssentials` or `state.itinerary`. Both surfaces converge through the mutation helpers in `itinerary-workflow/state.ts` and re-render off the same CopilotKit state-delta channel. Shown here for essentials; points of interest follow the identical shape.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React + CopilotKit
    participant Rest as Express · /api/threads/:id
    participant LG as LangGraph (itinerary-workflow)
    participant Prep as trip_preparation_agent
    participant Mut as itinerary-workflow/state.ts
    participant Redis as Redis · RedisSaver

    Note over User,UI: Direction A — UI initiates
    User->>UI: clicks "I have this" on umbrella card
    UI->>UI: optimistic check (snappy)
    UI->>Rest: POST /api/threads/abc/tripEssentials/umbrella<br/>{ owned: true }
    Rest->>Mut: markTripEssential(threadId=abc, id=umbrella, { owned: true })
    Mut->>Redis: graph.updateState · state.tripEssentials.umbrella merge
    Mut-->>Rest: ok + new thread tool-row entry
    Rest-->>UI: SSE broadcast · state diff + tool-row
    UI-->>User: chat sidebar appends tool-row · "umbrella · owned"
    Note over User: Next agent turn sees owned=true in state

    Note over User,UI: Direction B — Chat initiates
    User->>UI: types: "actually I already have a travel adapter"
    UI->>LG: AG-UI event
    Note over LG: route_turn → "pack"
    LG->>Prep: enter trip_preparation_agent
    Prep->>Prep: LLM picks tool: addItemToTripEssentials
    Prep->>Mut: addItemToTripEssentials(adapter, owned=true)
    Mut->>Redis: graph.updateState · state.tripEssentials.adapter merge
    Prep-->>UI: SSE tool-call event + state diff
    UI-->>User: EssentialSection re-renders · adapter checkbox checked
```

AMS is intentionally absent from this sequence: it ingests the conversation transcript on its own cadence and runs preference extraction asynchronously. Trip-scoped state (`itinerary`, `tripEssentials`) lives only in the RedisSaver checkpoint.

---

## What these diagrams emphasize

- **Memory before routing.** `resolve_user_context` runs *first* on every turn — so when chips are elicited, the user's recurring interests (`food`, `arts`) are already prefilled on the multi-select chip card. That's the source of the "from memory" indicator. The router then sees a fully-grounded state when classifying intent.
- **Parallel tool calls = Beat 4.7 Performance.** The planning agent issues `searchAndRankPointsOfInterest` + `lookupWeather` in parallel on the first ReAct step (Sequence 1). Inside `searchAndRankPointsOfInterest` itself, three Places Text Search queries fan out in parallel. The audience sees nested tool-group rows resolve concurrently in the chat sidebar.
- **Warm cache on turn 2.** Sequence 2 demonstrates the HSET cache-write from turn 1 paying off — no Google Places calls fire on the refinement turn, the agent goes straight from cache_check to FT.SEARCH KNN. This is non-negotiable in `searchAndRankPointsOfInterest` — without it every turn is a cold miss.
- **One query shape, every turn.** Sequence 2 walks the same `searchAndRankPointsOfInterest` tool as Sequence 1 — what differs is `state.interests`, which sharpens the query vector. Same hybrid `FT.SEARCH` (GEO + TAG + KNN), same client component, different cluster.
- **`RedisSaver` is what powers "load past trip."** Sequence 3 shows that flow explicitly — the checkpoint store lives in the same Redis instance as the points-of-interest cache and the Agent Memory Server's working memory. Now also restores `state.tripEssentials`, not just `state.itinerary`.
- **Two write paths, one store.** Sequence 4 makes the bidirectional sync concrete: both the agent's tool call and the REST handler converge on the mutation helpers in `itinerary-workflow/state.ts`, so the chat and canvas never drift. Tool-row entries appear in the chat thread regardless of which side initiated.
- **Elicitation is a real spec primitive, not custom UI.** Phase 1 chip-filling uses the literal MCP `elicit` mechanism. The packing flow does not use elicit — the trip-preparation agent drives that interaction conversationally via tool calls.
