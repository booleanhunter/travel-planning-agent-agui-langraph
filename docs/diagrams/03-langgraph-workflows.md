# 03 — LangGraph Workflows

The LangGraph topology that orchestrates the demo.

One graph, five plain nodes, no ReAct loop, no LLM-bound tools, no router, no checkpointer. Each node is a plain async function; `streamEvents({ version: "v3" })` emits node-lifecycle events that drive the UI.

---

## The single graph

```mermaid
flowchart TD
    Start((START)) --> RI[RouteIntent<br/>extract slots from user message;<br/>hydrate state.preferences from AMS]
    RI --> BR{slots filled?}

    BR -->|no| FE[FinalizeElicit<br/>return { elicit: { message, requestedSchema } }<br/>as final state]
    BR -->|yes| FW[FetchWeather<br/>in-code city/month lookup]
    BR -->|yes| FR[FetchRecs<br/>embed interests +<br/>hybrid FT.SEARCH idx:pointsOfInterest]

    FR --> FP[FinalizePlan<br/>generate summary +<br/>suggestedActions for follow-up chips]
    FW --> FP

    FE --> End(((END)))
    FP --> End

    classDef nodeStyle fill:transparent,color:#000000,stroke:#8a99a0,stroke-width:2px
    classDef purple fill:transparent,color:#c795e3,stroke:#c795e3,stroke-width:2px,font-weight:bold,stroke-dasharray: 5 5
    class Start,End,RI,BR,FE,FW,FR,FP nodeStyle
    class FR,FW,FP,FE purple
```

#### Notes on the topology

- **No router.** `RouteIntent` is a single node, not a conditional edge over intent types. Branching happens at the conditional edge *after* `RouteIntent`, based purely on whether required slots are filled.
- **No ReAct loop.** No `createReactAgent` / `createAgent`. Each step is a deterministic data fetch or LLM call.
- **No checkpointer.** Each graph run is one-shot. State that survives between turns lives on the client (currently-filled slots, picked POIs) and in AMS (conversation, preferences, past trips).
- **Elicit returned as state.** `FinalizeElicit` returns `{ elicit: { message, requestedSchema } }` as the graph's final output. The graph ends; the client renders a chip card from `requestedSchema`, the user fills it, and the client resubmits a new turn with the merged state.
- **Parallel fan-out.** The conditional edge returns the array `["FetchRecs", "FetchWeather"]` when slots are filled; LangGraph runs both concurrently. Visible in the UI as two AG-UI node-lifecycle events flipping from yellow to green together.

---

## `FetchRecs` — internal flow

`FetchRecs` is a single graph node, but it does two things in sequence: embed the user's interests, then run the hybrid `FT.SEARCH`. The runtime never calls Google Places — the POI catalog was populated once by the seed script.

```mermaid
flowchart LR
    IN([node enters]) --> EM[embed state.interests<br/>OpenAI text-embedding-3-small<br/>1536-dim]
    EM --> KNN["FT.SEARCH idx:pointsOfInterest<br/>(@city:{X}) =>[KNN $k @vector $qv AS score]<br/>SORTBY score ASC"]
    KNN --> RANK[rank + diversify]
    RANK --> OUT([return { pois }])

    classDef nodeStyle fill:transparent,color:#000000,stroke:#8a99a0,stroke-width:2px
    class IN,EM,KNN,RANK,OUT nodeStyle
```

The user's articulated interests just tighten or relax the KNN cluster around the candidate set for that city.

---

## Where graph elements hook into the UI

| Element | Triggers UI render | AG-UI event |
|---|---|---|
| `RouteIntent` enters | sidebar tool-row: yellow dot | `on_chain_start` |
| `RouteIntent` exits | sidebar tool-row: green dot; canvas patches `state.preferences` | `on_chain_end` |
| `FetchRecs` enters/exits | sidebar tool-row + POI grid renders on `state.pois` update | `on_chain_start`/`on_chain_end` |
| `FetchWeather` enters/exits | sidebar tool-row + weather card renders on `state.weather` update | `on_chain_start`/`on_chain_end` |
| `FinalizePlan` exits | follow-up chips render from `state.suggestedActions[]`; agent summary text appears | `on_chain_end` |
| `FinalizeElicit` exits | chip card renders from `state.elicit.requestedSchema` | `on_chain_end` |

A frontend dev in the audience can trace (a) the graph node, (b) the AG-UI event it emits, (c) the React component that re-renders.

---

## Why one graph, no router, no ReAct

An earlier design split planning and trip-prep into two separate agents under a `route_turn` classifier. That collapsed once the same shared state (`destination`, `weather`, `pois`) served both surfaces. Then the single ReAct agent itself collapsed too, once it became clear there were no autonomous tool-call decisions for the LLM to make — the workflow is deterministic (extract → branch → fetch → finalize). Plain nodes are clearer to debug and trace than a ReAct loop, and the visible AG-UI node events give the audience something concrete to point at on stage.
