## Protocol architecture diagram

```mermaid
flowchart TB
      subgraph Clients["Two client surfaces"]
          direction LR
          React["Your React app<br/>(Vite + ChatSidebar + Map)<br/>— the Generative UI demo"]
          Claude["Claude Desktop<br/>or MCP Inspector<br/>— the interop demo"]
      end

      subgraph Server["Single Node process (your existing server/)"]
          direction TB
          subgraph Adapters["Protocol adapters (thin)"]
              direction LR
              AGUI["@ag-ui/langgraph<br/>(existing)<br/>• /api/chat<br/>• AG-UI events over SSE<br/>• bridges streamEvents v3 from the graph<br/>• elicit is in graph state, not HITL channel"]
              MCP["MCP adapter (NEW)<br/>• @modelcontextprotocol/sdk<br/>• tool: plan_trip<br/>• stdio or Streamable HTTP<br/>• loops on graph.invoke ↔ elicitInput<br/>• maps accept/decline/cancel"]
          end

          subgraph Core["Shared core (unchanged)"]
              direction TB
              Graph["LangGraph workflow<br/>RouteIntent → branch → (FetchRecs ∥ FetchWeather → FinalizePlan)<br/>OR FinalizeElicit<br/>no checkpointer · stateless turns"]
              Helpers["Nodes + AgentState (Zod) + buildElicitSchema()"]
              Graph --- Helpers
          end

          subgraph Infra["Infrastructure (unchanged)"]
              direction LR
              Redis[("Redis<br/>POI hybrid index +<br/>AMS storage")]
              LLM["OpenAI<br/>chat + embeddings"]
              AMS["Agent Memory Server<br/>(REST :8000)"]
          end
      end
      React -- "AG-UI events (streamEvents v3)" --> AGUI
      Claude -- "JSON-RPC<br/>(MCP)" --> MCP
      AGUI -- "graph.streamEvents(input)" --> Graph
      MCP  -- "graph.invoke(state) per loop iteration" --> Graph
      Graph --> Redis
      Helpers --> LLM
      Helpers --> AMS

      classDef new fill:#fef3c7,stroke:#d97706,stroke-width:2px
      classDef existing fill:#e0f2fe,stroke:#0369a1
      classDef shared fill:#dcfce7,stroke:#16a34a
      class MCP,Claude new
      class AGUI,React existing
      class Graph,Helpers,Redis,LLM,AMS shared
```

## Protocol sequence diagram — stateless turns

```mermaid
sequenceDiagram
      autonumber
      participant User
      participant Surface as Client surface
      participant Adapter as Protocol adapter
      participant Graph as LangGraph workflow<br/>(no checkpointer)
      participant AMS as Agent Memory Server
      participant Redis

      User->>Surface: "Plan a trip to Bangalore"
      Surface->>Adapter: send message
      Adapter->>Graph: invoke({ userMessage, sessionId, state })
      Graph->>AMS: searchLongTermMemory · semantic
      AMS-->>Graph: prefs (food, arts ×4)
      Graph->>Graph: RouteIntent extracts slots — dates missing
      Graph->>Graph: conditional edge → FinalizeElicit
      Graph-->>Adapter: final state { elicit: { message, requestedSchema } }

      Note over Adapter: state.elicit = {<br/>  message: "A few details...",<br/>  requestedSchema: { type: "object", properties: {...}, required: [...] }<br/>}

      alt React surface (AG-UI)
          Adapter->>Surface: AG-UI STATE_DELTA<br/>{ elicit: {...} }
          Surface->>User: Render chip card +<br/>memory banner
          User->>Surface: pick chips, click Continue
          Surface->>Adapter: new request with merged state
          Adapter->>Graph: invoke({ userMessage, sessionId, state: {...prev, ...filled} })
      else MCP surface (MCP adapter)
          Adapter->>Surface: elicitation/create<br/>{ message, requestedSchema }
          Surface->>User: Render generic form
          User->>Surface: fill form · Submit / Decline / Cancel
          Surface->>Adapter: response { action, content? }
          Adapter->>Adapter: if accept → state = {...prev, ...content}<br/>if decline → state.useDefaults = true<br/>if cancel → return early
          Adapter->>Graph: invoke({ userMessage, sessionId, state })
      end

      par Parallel fan-out
          Graph->>Redis: FT.SEARCH idx:pointsOfInterest GEO+TAG+KNN
          Redis-->>Graph: ranked POIs
      and
          Graph->>Graph: FetchWeather · in-code lookup
      end
      Graph->>Graph: FinalizePlan · summary + suggestedActions
      Graph->>AMS: appendToWorkingMemory(turn) · fire-and-forget
      Graph-->>Adapter: final state { pois, weather, response, suggestedActions }
      Adapter-->>Surface: results
      Surface-->>User: itinerary (rich UI) /<br/>text + structured (Claude Desktop)
```

The key shape: **same graph, different adapter loop.** The React side and the MCP side both call `graph.invoke()` with state, get back either `{ elicit }` or `{ pois, weather, response, ... }`, and re-invoke if needed. No `interrupt()`, no checkpointer, no resume mechanic. The pause/resume of MCP elicitation lives at the *MCP SDK layer*, not the LangGraph layer.
