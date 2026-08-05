# Architecture Diagrams — Trip Itinerary Builder

Architecture and flow diagrams for the talk and for documentation. All Mermaid source, styled to match the redish theme (light, Space Mono, Redis-red `#FF4438` accents, grey `#8a99a0` borders, transparent-fill nodes with colored strokes).

| File | Type | What it shows |
|---|---|---|
| `flowchart.md` | Source-of-truth sketch | Minimal Mermaid for the three-node graph (`ContextRetriever → TravelAgent → FollowUp`) plus the internal shape of `TravelAgent`'s ReAct loop and `FollowUp`'s single-call extraction. The canonical reference the other diagrams elaborate on. |
| `01-system-architecture.md` | Flowchart (block diagram) | User → React + `@ag-ui/client` (sidebar + canvas + drawer) → Express backend with two transport adapters (`chat.ts` for AG-UI/SSE, `mcp-server.ts` for MCP) and a shared `streamPlannerTurn` wrapper (`runtime.ts`) → LangGraph (three nodes, no checkpointer) → Redis (POI hybrid index + trip-store + AMS-backed storage) + Agent Memory Server + OpenAI + OSM + Google. Seed scripts shown separately. |
| `02-user-flow-sequence.md` | Sequence diagrams | Three sequences using *"Plan a trip to Bangalore"*: (1) plan turn with elicit — `FollowUp` returns `state.elicit` as final state, user fills chips, second turn runs end-to-end with parallel `searchPois` + `getWeather` inside `TravelAgent`'s ReAct loop; (2) refinement turn — same graph, sharper interests vector, tighter KNN cluster; (3) memory drawer → click past trip → REST against `/api/user/profile` and `/api/user/load-trip`. |
| `03-langgraph-workflows.md` | Graph deep-dive | The three nodes, each with its own internal flow: `ContextRetriever` (parallel reads from Redis + AMS), `TravelAgent` (ReAct loop with five bound tools — `searchPois`, `getPoiDetails`, `getWeather`, `updateItinerary`, `saveTripToCalendar`), `FollowUp` (single LLM extraction call → buildElicit / suggestedActions → persist). |
| `with-mcp.md` | Two-clients picture + MCP protocol sequence | React (AG-UI/SSE) and Claude Desktop / VS Code Copilot Chat (MCP) both pointed at the same backend. Shows the shared `streamPlannerTurn` runtime, the elicit-as-state pattern, the MCP loop's two elicit modes (form + URL), and the `accept / decline / cancel` mapping (`userDeclinedElicit` semantics). |
| `langgraph-architecture.{mmd,svg,excalidraw}` | Reference diagram | The single architecture diagram used on the talk's "Architecture" slide. Same three-node story as the markdown files above, in a more compact visual form. |

## Color legend

| Color | Class | What it represents |
|---|---|---|
| Purple `#c795e3` | `purple` | LangGraph workflow + node boxes |
| Redis-red `#ff4438` | `red` | Redis Stack (POI hybrid index, trip-store) + Redis Agent Memory Server |
| Blue `#80dbff` | `blue` | Frontend + backend services (Express, adapters) |
| Green `#7cc77f` | `green` | External services (OpenAI, OSM, Google APIs at runtime, Google Places at seed time) |
| Yellow `#e0c200` | `yellow` | Seed-time / dev-time tooling |

## What changed in this doc set

Every markdown diagram in this folder was audited against the actual source (`graph.ts`, `runtime.ts`, `chat.ts`, `mcp-server.ts`, `user-service.ts`, `trips-service.ts`, `state.ts`, `places-repository.ts`) and rewritten to match. The earlier versions described a five-node *plain-functions* topology (`RouteIntent / FetchRecs / FetchWeather / FinalizePlan / FinalizeElicit`) and a `@ag-ui/langgraph`-based bridge. The actual implementation collapsed into three nodes with a ReAct loop inside `TravelAgent`, and the bridge is a custom `streamPlannerTurn` wrapper. AG-UI events are now correctly `STATE_SNAPSHOT` (not `STATE_DELTA`); the elicit decline flag is `userDeclinedElicit` (not `useDefaults`); the POI query uses `TAG + KNN` (the `location` field is GEO-indexed but not queried with a GEO filter today).

## How to render

The `render-diagrams.sh` script in this folder uses `@mermaid-js/mermaid-cli` (via `npx`, no global install needed) with the local `mermaid-config.json`.

```bash
cd docs/diagrams
./render-diagrams.sh
```

Outputs `<name>.png` and `<name>.svg` next to each source `.md`. Multi-block files (like `02-user-flow-sequence.md` and `03-langgraph-workflows.md`) produce numbered outputs.

Alternatives:
- Paste a Mermaid block into [mermaid.live](https://mermaid.live) for quick previews (default theme, not ours).
- Render in-place via VS Code's Mermaid preview extension.
- Most modern markdown viewers (GitHub, VS Code, Obsidian) render Mermaid blocks natively.
