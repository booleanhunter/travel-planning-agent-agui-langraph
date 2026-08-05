# 01 — System Architecture

Block diagram of the Trip Itinerary Builder. Shows the user, the React + `@ag-ui/client` frontend (sidebar chat + canvas + memory drawer), the Node + Express backend with two transport adapters (`chat.ts` for AG-UI/SSE and `mcp-server.ts` for MCP) plus a shared `runtime.ts` wrapper, the three-node LangGraph workflow, Redis (POI hybrid index + trip-store + AMS-backed storage), Agent Memory Server, and external services. The seed script is shown separately — it's a one-time dev-time tool, not on the runtime path.

```mermaid
flowchart TD
    %% User layer
    User>"User Query"]

    %% Frontend — chat sidebar + canvas + drawer
    Frontend(("React + @ag-ui/client<br/>chat sidebar · canvas · memory drawer"))

    %% Backend — Express + adapters + shared runtime
    subgraph Backend["Node + Express  ·  :3000"]
        ChatRoute["chat.ts (AG-UI / SSE)<br/>POST /api/chat<br/>emits @ag-ui/core EventType events"]
        MCPRoute["mcp-server.ts + mcp-http.ts<br/>POST /mcp · stdio<br/>tool: planTrip · server.elicitInput loop"]
        UserRoutes["trips-routes.ts<br/>GET /api/user/profile<br/>POST /api/user/load-trip"]
        OAuthRoute["oauth-routes.ts<br/>/oauth/google/* · token + callback"]
        Runtime["runtime.ts (shared)<br/>streamPlannerTurn(input, handlers)<br/>graph.stream({ streamMode: 'updates' })"]
        ChatRoute --> Runtime
        MCPRoute --> Runtime
    end

    %% LangGraph — three nodes, no checkpointer
    subgraph LangGraph["LangGraph workflow  (no checkpointer)"]
        direction TB
        CR["ContextRetriever<br/>read Redis trip-store + AMS<br/>(getPreferences · getConversation)"]
        TA["TravelAgent (ReAct loop)<br/>bound tools, LLM picks + parallelizes:<br/>searchPois · getPoiDetails · getWeather<br/>· updateItinerary · saveTripToCalendar"]
        FU["FollowUp<br/>extract slots · buildElicit · suggestedActions<br/>· appendTurn (AMS) · ensureDraft (Redis)"]

        CR --> TA --> FU
    end

    %% Redis — POI hybrid index + trip-store + AMS-backed storage
    subgraph RedisStack["Redis Stack"]
        PoiIndex["idx:pointsOfInterest<br/>TAG (city) + VECTOR<br/>(GEO indexed but not queried)<br/>pre-seeded · durable"]
        TripStore[("trip-store HASH<br/>user:&lt;userId&gt;:trip:&lt;tripId&gt;")]
        AMSStore[("AMS-owned keys<br/>working + long-term memory")]
    end

    %% Agent Memory Server — separate service, same Redis underneath
    subgraph AMS["Redis Agent Memory Server  ·  :8000"]
        Working["Working memory<br/>conversation transcript per tripId"]
        LongTerm["Long-term memory<br/>preferences + episodes"]
    end

    %% External services
    subgraph External["External Services"]
        OpenAI["OpenAI<br/>chat + text-embedding-3-small"]
        Google["Google OAuth + Calendar<br/>(URL-mode elicit + saveTripToCalendar)"]
        OSM["OpenStreetMap<br/>tile server (map rendering)"]
        Places["Google Places API<br/>(seed time only)"]
    end

    %% Seed script — dev-time, off the request path
    subgraph SeedScript["Seed scripts  (one-time, dev-time)"]
        SeedPois["scripts/seed-pois.js"]
        SeedUserData["scripts/seed-user-data.js"]
    end

    %% Flow — request path
    User e1@--> |prompt + interactions| Frontend
    e1@{ animate: true }
    Frontend e2@<--> |AG-UI events over SSE| ChatRoute
    e2@{ animate: true }
    Frontend <--> |drawer fetches: profile · load-trip| UserRoutes
    Frontend <--> |OAuth start/callback| OAuthRoute

    Runtime --> CR

    CR -.->|getPreferences · getConversation| AMS
    CR -.->|getTrip| TripStore
    TA -.->|searchPois FT.SEARCH| PoiIndex
    TA -.->|embed interests / chat| OpenAI
    TA -.->|saveTripToCalendar OAuth + API| Google
    FU -.->|extraction LLM| OpenAI
    FU -.->|appendTurn · fire-and-forget| AMS
    FU -.->|ensureDraft| TripStore

    UserRoutes -.->|preferences + past trips| AMS
    UserRoutes -.->|past trips (Redis keys)| TripStore
    AMS -.- AMSStore

    Frontend -.->|map tiles| OSM

    %% Seed path — dev-time
    SeedPois -->|one-time fetch + embed| Places
    SeedPois -.->|embeddings| OpenAI
    SeedPois -->|HSET + index population| PoiIndex
    SeedUserData -->|preferences + past trips| AMS

    %% Styling
    classDef nodeStyle fill:transparent,color:#000000,stroke:#8a99a0,stroke-width:2px
    classDef subgraphStyle fill:transparent,color:#000000,stroke:#8a99a0,stroke-width:1px

    classDef purple fill:transparent,color:#c795e3,stroke:#c795e3,stroke-width:2px,font-weight:bold,stroke-dasharray: 5 5
    classDef red fill:transparent,color:#ff4438,stroke:#ff4438,stroke-width:2px,stroke-dasharray: 5 5
    classDef blue fill:transparent,color:#80dbff,stroke:#80dbff,stroke-width:2px,font-weight:bold,stroke-dasharray: 5 5
    classDef green fill:transparent,color:#7cc77f,stroke:#7cc77f,stroke-width:2px,stroke-dasharray: 5 5
    classDef yellow fill:transparent,color:#e0c200,stroke:#e0c200,stroke-width:2px,font-weight:bold,stroke-dasharray: 5 5

    class User,Frontend,ChatRoute,MCPRoute,UserRoutes,OAuthRoute,Runtime,CR,TA,FU,PoiIndex,TripStore,AMSStore,Working,LongTerm,OpenAI,Google,OSM,Places,SeedPois,SeedUserData nodeStyle
    class Backend,LangGraph,RedisStack,AMS,External,SeedScript subgraphStyle
    class Backend blue
    class LangGraph purple
    class RedisStack red
    class AMS red
    class External green
    class SeedScript yellow
```

### What the request flow shows

1. **Two transport adapters, one shared streaming wrapper.** `chat.ts` (AG-UI/SSE at `/api/chat`) and `mcp-server.ts` (MCP at `/mcp` plus stdio) both call into `streamPlannerTurn` in `runtime.ts`. The wrapper streams `graph.stream(input, { streamMode: 'updates' })` and fans per-node deltas via callbacks. AG-UI maps those callbacks to `@ag-ui/core` `EventType` events (`RUN_STARTED`, `STEP_STARTED`/`STEP_FINISHED` per node, `STATE_SNAPSHOT`, `RUN_FINISHED`). MCP maps them to progress notifications + the eventual tool result, and loops on `server.elicitInput()` between graph invocations when `state.elicit` is returned.

2. **ContextRetriever (single read point at graph entry).** Loads `state.preferences` from AMS (`getPreferences`), the current trip's transcript from AMS (`getConversation`), and the current trip draft from Redis (`getTrip`).

3. **TravelAgent (ReAct loop).** A `createReactAgent`-style loop with five bound tools: `searchPois`, `getPoiDetails`, `getWeather`, `updateItinerary`, `saveTripToCalendar`. The LLM picks which to call; the system prompt instructs it to emit `searchPois` + `getWeather` in parallel for trip-planning intents, so both run concurrently when the agent fans tool calls.

4. **FollowUp (single LLM call + persist).** One structured-output LLM call extracts current-turn slots from the full conversation, computes `needsMoreInfo`, decides whether to elicit (via `buildElicit`), and emits `suggestedActions[]` for follow-up chips. If new slots were filled, persists via `ensureDraft` (Redis trip-store) and `appendTurn` (AMS working memory, fire-and-forget). If required slots are still missing and the user hasn't already declined, returns `state.elicit = { mode, message, requestedSchema }` as final state.

5. **Elicit is a state field, not a HITL channel.** The graph ends when `FollowUp` returns; the adapter handles the round-trip. AG-UI surfaces it as a `STATE_SNAPSHOT` and waits for the next client request. MCP calls `server.elicitInput()` and re-invokes `streamPlannerTurn` inline with the merged state, on either `accept` (merge content) or `decline` (set `userDeclinedElicit: true`); `cancel` returns early.

### The two faces of Redis

Redis Stack is used in two ways on the same instance:

- **Trip-store + POI hybrid index** — application data. The trip-store is a per-user/per-trip HASH (`user:<userId>:trip:<tripId>`). The POI index (`idx:pointsOfInterest`) was populated once by `scripts/seed-pois.js` and serves runtime reads via a single `FT.SEARCH` per call — city TAG filter + KNN over the interests vector. The `location` field is GEO-indexed but the runtime query never uses a GEO filter today.
- **Agent Memory Server backing store** — AMS is a separate process exposing a REST API on `:8000` and persisting to the same Redis. The application code talks to AMS via `getPreferences` / `getConversation` / `appendTurn` (in `user-service.ts`), never to the AMS-backing Redis keys directly.

### What's *not* shown (intentionally)

- **AG-UI client SDK internals** — `@ag-ui/client`'s `HttpAgent` + `AgentSubscriber` are abstracted into the "Frontend" node.
- **Internal flow of TravelAgent's ReAct loop** — see `03-langgraph-workflows.md` for the LLM step + tool fanout + per-tool details.
- **MCP-specific transport detail** — `mcp-http.ts` (Streamable HTTP), the `elicitationId` + `completionNotifier` coordination for URL-mode OAuth, etc. See `with-mcp.md`.
- **`@ag-ui/langgraph`** — the package is in `package.json` but `chat.ts` doesn't import it. The custom `streamPlannerTurn` wrapper plays that role instead.
