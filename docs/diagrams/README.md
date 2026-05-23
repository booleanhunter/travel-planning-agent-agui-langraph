# Architecture Diagrams — Trip Itinerary Builder

Architecture and flow diagrams for Section 5 of the talk and the architecture pass of the build. All Mermaid source, styled to match `redish/openai-version/docs/technical-diagrams` (light theme, Space Mono, Redis-red `#FF4438` accents, grey `#8a99a0` borders, transparent-fill nodes with colored strokes).

| File | Type | What it shows |
|---|---|---|
| `01-system-architecture.md` | Flowchart (block diagram) | User → React + `@ag-ui/client` (sidebar + canvas + drawer) → Express + `@ag-ui/langgraph` (AG-UI over SSE at `/api/chat`) → LangGraph (5 nodes: `RouteIntent`, `FetchRecs`, `FetchWeather`, `FinalizePlan`, `FinalizeElicit`; no checkpointer) → Redis (POI hybrid index + AMS-backed memory) + OpenAI + OpenStreetMap. Seed script (one-time, dev-time) populates the POI index via Google Places API. |
| `02-user-flow-sequence.md` | Sequence diagrams | Three sequences using *"Plan a trip to Bangalore"*: (1) plan turn with elicit — `RouteIntent → FinalizeElicit` → user fills chips → client resubmits → `RouteIntent → FetchRecs ∥ FetchWeather → FinalizePlan`; (2) refinement turn — same graph, sharper interests vector, hybrid `FT.SEARCH` returns tighter cluster; (3) memory drawer → click past trip → AMS-only rehydrate (no RedisSaver). |
| `03-langgraph-workflows.md` | Flow diagrams | Single graph topology: `RouteIntent → (FetchRecs ∥ FetchWeather → FinalizePlan) OR FinalizeElicit`. No router, no ReAct agents, no checkpointer. Plus a small inset showing `FetchRecs` internals (embed interests + hybrid `FT.SEARCH`). |
| `flowchart.md` | Source-of-truth sketch | Minimal Mermaid for the 5-node graph + `FetchRecs` internals. The canonical reference the other diagrams elaborate on. |
| `with-mcp.md` | Two-clients picture + protocol sequence | React client + Claude Desktop both pointed at the same backend. Shows the stateless-turn pattern: graph returns `{ elicit }` as final state; the MCP wrapper loops calling `server.elicitInput()` between `graph.invoke` calls. |

## Color legend

The class palette mirrors redish:

| Color | Class | What it represents |
|---|---|---|
| Purple `#c795e3` | `purple` | LangGraph workflow + agent orchestration |
| Redis-red `#ff4438` | `red` | Redis Stack (POI hybrid index) + Redis Agent Memory Server |
| Blue `#80dbff` | `blue` | Frontend + Backend services |
| Green `#7cc77f` | `green` | External services (OpenAI, OSM, Google Places at seed time) |
| Yellow `#e0c200` | `yellow` | Seed-time / dev-time tooling |

## How to render

The `render-diagrams.sh` script in this folder uses `@mermaid-js/mermaid-cli` (via `npx`, no global install needed) with the local `mermaid-config.json` (same theme as `redish/openai-version`).

```bash
cd docs/diagrams
./render-diagrams.sh
```

Outputs `<name>.png` and `<name>.svg` next to each source `.md`. Multi-block files (like `02-user-flow-sequence.md`, which has three sequences, and `03-langgraph-workflows.md`, which has the main graph + `FetchRecs` internals) produce numbered outputs (`02-user-flow-sequence-1.png` … `-3.png`).

Alternatives:
- Paste a Mermaid block into [mermaid.live](https://mermaid.live) for quick previews (uses default theme, not ours)
- Render in-place via VS Code's Mermaid preview extension
- Skip rendering entirely — most modern markdown viewers (GitHub, VS Code, Obsidian) render Mermaid blocks natively
