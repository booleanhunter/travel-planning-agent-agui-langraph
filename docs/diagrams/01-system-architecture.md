# 01 — System Architecture

Block diagram of the Trip Itinerary Builder. Shows the user, the React + `@ag-ui/client` frontend (sidebar chat + canvas + memory drawer), the Node + Express backend with `@ag-ui/langgraph` bridging to the LangGraph workflow, the single LangGraph workflow (five nodes, no checkpointer), Redis (POI hybrid index + Agent Memory Server storage), and the external services. The seed script is shown separately — it's a one-time dev-time tool, not a runtime path.

```mermaid
flowchart TD
    %% User Layer
    User>"User Query"]

    %% Frontend — chat sidebar + canvas + drawer
    Frontend(("React + @ag-ui/client<br/>chat sidebar · canvas · memory drawer"))

    %% Backend — Express with @ag-ui/langgraph + REST routes
    subgraph Backend["Node + Express  ·  :3000"]
        AGUIEndpoint["@ag-ui/langgraph<br/>/api/chat<br/>AG-UI events over SSE<br/>(bridges streamEvents v3)"]
        UserRoutes["/api/user<br/>profile · load-trip"]
    end

    %% LangGraph — one graph, five nodes, no checkpointer
    subgraph LangGraph["LangGraph workflow  (no checkpointer)"]
        direction TB
        RouteIntent["RouteIntent<br/>extract slots · hydrate AMS"]
        FetchRecs["FetchRecs<br/>embed interests +<br/>hybrid FT.SEARCH"]
        FetchWeather["FetchWeather<br/>in-code lookup"]
        FinalizePlan["FinalizePlan<br/>summary + suggestedActions"]
        FinalizeElicit["FinalizeElicit<br/>return elicit spec as state"]

        RouteIntent --> FetchRecs
        RouteIntent --> FetchWeather
        RouteIntent -.->|slots missing| FinalizeElicit
        FetchRecs --> FinalizePlan
        FetchWeather --> FinalizePlan
    end

    %% Redis — POI hybrid index + AMS-backed storage
    subgraph RedisStack["Redis Stack"]
        PoiIndex["idx:pointsOfInterest<br/>GEO + TAG + VECTOR<br/>(pre-seeded · durable)"]
        AMSStore[("AMS-owned keys<br/>working · semantic · episodic")]
    end

    %% Agent Memory Server — separate service, same Redis underneath
    subgraph AMS["Redis Agent Memory Server  ·  :8000"]
        Working["Working memory<br/>conversation transcript"]
        SemLT["Long-term semantic<br/>preferences"]
        EpiLT["Long-term episodic<br/>past trips"]
    end

    %% External Services
    subgraph External["External Services"]
        OpenAI["OpenAI<br/>gpt-4o-mini + text-embedding-3-small"]
        OSM["OpenStreetMap<br/>tile server"]
        Places["Google Places API<br/>(seed time only)"]
    end

    %% Seed script — dev-time, not on the request path
    subgraph SeedScript["Seed script  (one-time, dev-time)"]
        SeedRun["scripts/seed-pois.ts"]
    end

    %% Flow — request path
    User e1@--> |prompt + interactions| Frontend
    e1@{ animate: true }
    Frontend e2@<--> |AG-UI events streamEvents v3| AGUIEndpoint
    e2@{ animate: true }
    Frontend <--> |drawer fetches| UserRoutes

    AGUIEndpoint --> RouteIntent

    RouteIntent <-.->|searchLongTermMemory<br/>+ recent transcript| AMS
    RouteIntent <-.->|slot-extraction LLM| OpenAI
    FetchRecs <-.->|FT.SEARCH| PoiIndex
    FetchRecs <-.->|embed interests| OpenAI
    FinalizePlan <-.->|summary LLM| OpenAI
    FinalizePlan -.->|append turn async| AMS
    FinalizeElicit -.->|append turn async| AMS

    UserRoutes -.->|past trips + transcript| AMS
    AMS -.- AMSStore

    Frontend -.->|map tiles| OSM

    %% Seed path — dev-time, separate
    SeedRun -->|one-time Text Search + Details| Places
    SeedRun -.->|embeddings| OpenAI
    SeedRun -->|HSET + index population| PoiIndex

    %% Styling — matches redish
    classDef nodeStyle fill:transparent,color:#000000,stroke:#8a99a0,stroke-width:2px
    classDef subgraphStyle fill:transparent,color:#000000,stroke:#8a99a0,stroke-width:1px

    classDef purple fill:transparent,color:#c795e3,stroke:#c795e3,stroke-width:2px,font-weight:bold,stroke-dasharray: 5 5
    classDef red fill:transparent,color:#ff4438,stroke:#ff4438,stroke-width:2px,stroke-dasharray: 5 5
    classDef blue fill:transparent,color:#80dbff,stroke:#80dbff,stroke-width:2px,font-weight:bold,stroke-dasharray: 5 5
    classDef green fill:transparent,color:#7cc77f,stroke:#7cc77f,stroke-width:2px,stroke-dasharray: 5 5
    classDef yellow fill:transparent,color:#e0c200,stroke:#e0c200,stroke-width:2px,font-weight:bold,stroke-dasharray: 5 5

    class User,Frontend,AGUIEndpoint,UserRoutes,RouteIntent,FetchRecs,FetchWeather,FinalizePlan,FinalizeElicit,PoiIndex,AMSStore,Working,SemLT,EpiLT,OpenAI,OSM,Places,SeedRun nodeStyle
    class Backend,LangGraph,RedisStack,AMS,External,SeedScript subgraphStyle
    class Backend blue
    class LangGraph purple
    class RedisStack red
    class AMS red
    class External green
    class SeedScript yellow
```

### What the request flow shows

1. **Frontend → `@ag-ui/langgraph` bridge.** The React client (via `@ag-ui/client`'s `HttpAgent.runAgent`) sends turn requests over AG-UI; `@ag-ui/langgraph` subscribes to `streamEvents({ version: "v3" })` from the LangGraph workflow and forwards each event as an AG-UI event over SSE (`RUN_STARTED`, `STEP_STARTED`/`STEP_FINISHED` per node, `STATE_DELTA`, `RUN_FINISHED`).
2. **RouteIntent.** Hydrates `state.preferences` from AMS (long-term semantic + recent working memory); calls OpenAI for slot extraction over the user's message.
3. **Conditional edge.** Branches based on whether required slots (`destination`, `dates`) are filled. If missing → `FinalizeElicit`. If present → `[FetchRecs, FetchWeather]` in parallel.
4. **FetchRecs.** Embeds `state.interests` with `text-embedding-3-small`; runs hybrid `FT.SEARCH idx:pointsOfInterest` (city TAG filter AND KNN over the interests vector) in one Redis round-trip.
5. **FetchWeather.** Synchronous in-code lookup against the city/month JS object — no API call.
6. **FinalizePlan.** Calls OpenAI for the summary text, populates `state.suggestedActions[]` for the follow-up chips, and fires `appendToWorkingMemory(turn)` to AMS asynchronously.
7. **FinalizeElicit.** Returns `{ elicit: { message, requestedSchema } }` as the graph's final state. The client renders a chip card and resubmits a new turn with the merged state — no pause/resume, no checkpointer.

### The two faces of Redis

This demo uses Redis Stack in **two ways**, on the same instance:

- **Hybrid POI index** (`idx:pointsOfInterest`) — GEO + TAG + VECTOR fields on the same hash records, populated once by `scripts/seed-pois.ts`. Every runtime read is a single `FT.SEARCH` — city TAG filter AND KNN over the interests embedding — in one round-trip. No TTL; re-run the seed script to refresh.
- **Agent Memory Server backing store** — AMS is a separate service with its own REST API, but it persists to the same Redis. AMS owns three tiers: working memory (conversation transcripts), long-term semantic (preferences), and long-term episodic (past trips).

### What's *not* shown (intentionally)

- **AG-UI SDK internals** — `@ag-ui/client`'s `HttpAgent` + `AgentSubscriber` and `@ag-ui/langgraph`'s LangGraph→AG-UI translation are abstracted into the "Frontend" and "@ag-ui/langgraph" nodes respectively.
- **State transitions inside `FetchRecs`** — the embed + `FT.SEARCH` + rank pipeline is in `03-langgraph-workflows.md`.
- **LangCache** — explicitly skipped for this iteration. Performance pattern uses the parallel `FetchRecs ∥ FetchWeather` fan-out + Redis hybrid index instead.
