# 02 — User Flow Sequence Diagrams

Three sequences covering the demo's actual interaction paths.

Example question used throughout: **"Plan a trip to Bangalore."**

---

## Sequence 1 — Plan with elicit (two HTTP turns)

User types a planning query. `RouteIntent` extracts what it can but `dates` is missing. The graph routes to `FinalizeElicit` and returns the elicit spec as final state. The client renders a chip card; the user fills the dates; the client submits a new turn with the merged state. The graph runs end-to-end, fans out `FetchRecs ∥ FetchWeather`, and `FinalizePlan` returns the agent's summary plus `suggestedActions[]`.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React + @ag-ui/client
    participant Run as Express + @ag-ui/langgraph
    participant LG as LangGraph<br/>(RouteIntent · FetchRecs ∥ FetchWeather ·<br/>FinalizePlan / FinalizeElicit)
    participant AMS as Agent Memory Server
    participant Redis as Redis · idx:pointsOfInterest
    participant LLM as OpenAI

    User->>UI: types "Plan a trip to Bangalore"
    UI->>Run: AG-UI request with prompt + sessionId
    Run->>LG: streamEvents(input)

    Note over LG,AMS: RouteIntent
    LG->>AMS: searchLongTermMemory user_id=ashwin · semantic
    AMS-->>LG: prefs (interests=[food, arts] ×4 · budget=mid · group=solo)
    LG->>LLM: slot-extraction LLM call
    LLM-->>LG: destination=Bangalore · dates=missing · interests=[food, arts, landmarks]

    Note over LG: conditional edge — dates missing → FinalizeElicit
    LG->>LG: FinalizeElicit · return { elicit: { message, requestedSchema } }
    LG-->>Run: state stream — { elicit: {...} } at FinalizeElicit's on_chain_end
    Run-->>UI: AG-UI STATE_DELTA
    UI-->>User: render chip card from requestedSchema · food + arts pre-selected from memory

    User->>UI: fills dates · keeps food + arts · adds landmarks
    UI->>Run: AG-UI request with prompt + merged state
    Run->>LG: streamEvents(input)

    Note over LG,LLM: RouteIntent again — slots now all filled
    LG->>AMS: searchLongTermMemory · semantic
    AMS-->>LG: prefs
    LG->>LLM: slot extraction (idempotent — same slots)
    LLM-->>LG: all required slots present

    Note over LG: conditional edge — slots filled → [FetchRecs, FetchWeather] (parallel)

    par Parallel fan-out — Beat 4.7 Performance
        LG->>LLM: embed state.interests (text-embedding-3-small)
        LLM-->>LG: query vector (1536-dim)
        LG->>Redis: FT.SEARCH idx:pointsOfInterest (@city:{Bangalore}) =>[KNN 12 @vector $qv]
        Redis-->>LG: 12 ranked POIs
    and
        LG->>LG: FetchWeather · in-code lookup<br/>(bangalore, may → "hot, occasional showers")
    end

    Note over LG: FinalizePlan
    LG->>LLM: summary LLM call (POIs + weather + interests)
    LLM-->>LG: agent response text + suggestedActions
    LG->>AMS: appendToWorkingMemory(turn) · fire-and-forget

    LG-->>Run: state stream — pois, weather, response, suggestedActions
    Run-->>UI: AG-UI STATE_DELTA events
    UI-->>User: POI grid · weather card · agent summary · "What should I pack?" chip
```

---

## Sequence 2 — Refinement turn (sharper interests)

User articulates a sharper vibe on a follow-up turn. The same graph runs end-to-end; `FetchRecs` embeds the new interest descriptors and the hybrid `FT.SEARCH` returns a tighter KNN cluster around the new vector. No Google Places calls — the POI catalog is pre-seeded.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React + @ag-ui/client
    participant LG as LangGraph
    participant Redis as Redis · idx:pointsOfInterest
    participant LLM as OpenAI

    Note over User,UI: POI grid from Sequence 1 already on canvas
    User->>UI: types "actually I want it to feel moody and slow —<br/>indie coffee shops and cobblestone streets alone"
    UI->>LG: AG-UI request with prompt + accumulated client state

    Note over LG,LLM: RouteIntent · slot extraction over the new phrase
    LG->>LLM: extract slots
    LLM-->>LG: interests=[moody, slow, indie, contemplative, walkable, solitary]<br/>(other slots already in state)

    Note over LG: conditional edge → [FetchRecs, FetchWeather] (parallel)

    par Parallel fan-out
        LG->>LLM: embed sharper interests
        LLM-->>LG: tighter query vector
        LG->>Redis: FT.SEARCH idx:pointsOfInterest (@city:{Bangalore}) =>[KNN 12 @vector $qv]
        Redis-->>LG: 12 POIs · tighter cluster (indie/quiet/walkable)
    and
        LG->>LG: FetchWeather (cached lookup)
    end

    LG->>LLM: summary
    LLM-->>LG: response + suggestedActions
    LG-->>UI: state stream — new pois, same weather

    UI-->>User: POI grid reshuffles · same canvas shape · "why this place" tooltips show matched dimensions
```

---

## Sequence 3 — Memory drawer + load past trip

Hamburger click opens the drawer. Clicking a past trip rehydrates from AMS only — the episodic record (for the trip metadata) plus working memory (for the conversation transcript). No LangGraph checkpoint involved.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React + @ag-ui/client
    participant Backend as Express · /api/user
    participant AMS as Agent Memory Server

    User->>UI: clicks hamburger
    UI->>Backend: GET /api/user/profile · userId=ashwin

    par Parallel memory queries
        Backend->>AMS: searchLongTermMemory · semantic · prefs
        Backend->>AMS: searchLongTermMemory · episodic · trips
    end
    AMS-->>Backend: prefs + past trips
    Backend-->>UI: profile JSON
    UI-->>User: drawer slides in — Preferences + Past trips

    Note over User,UI: User clicks past trip
    User->>UI: clicks Kyoto · Oct 2024
    UI->>Backend: POST /api/user/load-trip · tripId=kyoto-oct-2024

    Backend->>AMS: get episode by tripId
    AMS-->>Backend: episode (sessionId, destination, dates, itinerary snapshot)
    Backend->>AMS: getWorkingMemory · sessionId
    AMS-->>Backend: conversation transcript

    Backend-->>UI: { episode, conversationHistory }
    UI-->>User: chat sidebar rehydrates from transcript · canvas restores itinerary snapshot
    Note over User,UI: User can continue editing · client-side state sent on next turn
```

---

## What these diagrams emphasize

- **Memory before extraction.** `RouteIntent` reads AMS preferences *before* extracting slots, so memory-sourced values prefill the elicit chip card. The "from memory" badge tracks which slots came from AMS vs. the prompt.
- **Stateless turns.** Each graph run is one-shot — no `interrupt()`, no checkpointer, no resume. Elicit is returned as final state; the client resubmits with merged state.
- **Parallel fetches = Beat 4.7 Performance.** Sequence 1 shows the parallel fan-out. The audience sees two AG-UI node-lifecycle events resolve concurrently in the sidebar.
- **Pre-seeded POI catalog.** The runtime never calls Google Places. Sequences 1 and 2 both touch only Redis + OpenAI embeddings on the request path.
- **AMS is the single source of truth for cross-session memory.** Sequence 3 shows it owns both the episodic record AND the conversation transcript. No RedisSaver to fall back on.
