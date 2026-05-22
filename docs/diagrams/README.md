# Architecture Diagrams — Trip Itinerary Builder

Architecture and flow diagrams for Section 5 of the talk and the architecture pass of the build. All Mermaid source, styled to match `redish/openai-version/docs/technical-diagrams` (light theme, Space Mono, Redis-red `#FF4438` accents, grey `#8a99a0` borders, transparent-fill nodes with colored strokes).

| File | Type | What it shows |
|---|---|---|
| `01-system-architecture.md` | Flowchart (block diagram) | High-level layers: User → React+CopilotKit (sidebar + canvas + drawer) → Express (AG-UI + thread REST + memory routes) → single LangGraph with `route_turn` + two ReAct agents (`itinerary_planning_agent`, `trip_preparation_agent`) → agent tools → mutation helpers in `itinerary-workflow/state.ts` (shared write bridge) → Redis hybrid index + Agent Memory Server + external APIs (OpenAI, Google Places, Tavily, OSM). Now contains two sub-sections: **v1** (original CopilotKit v1 / GraphQL-bridged runtime, single-process) and **v2** (current CopilotKit v2 native AG-UI / SSE runtime, two-process: Express on `:3000` + `langgraphjs dev` on `:8123`, with `StreamModePinnedAgent` + `InMemoryAgentRunner`). Downstream graph, tools, Redis index and AMS are unchanged between v1 and v2 — see file for the delta list. |
| `02-user-flow-sequence.md` | Sequence diagrams | Four sequences using *"Plan a trip to Bangalore"*: (1) plan turn through `itinerary_planning_agent` ReAct loop, then packing as a separate turn through `trip_preparation_agent`; (2) refinement turn re-enters the planning agent with warm-cache `searchAndRankPointsOfInterest`; (3) memory drawer → click past trip → RedisSaver checkpoint rehydrate of both `state.itinerary` and `state.tripEssentials`; (4) bidirectional sync — UI checkbox/POI clicks and chat tool calls both funnel through the mutation helpers in `itinerary-workflow/state.ts`. |
| `03-langgraph-workflows.md` | Flow diagrams | Two sub-sections: **v1** = the original multi-node topology (top-level graph: RUC → `route_turn` → {elicit → planning agent, prep agent, END}), the two agent ReAct loops, and the internal 7-step flow inside the `searchAndRankPointsOfInterest` tool. **v2** = the current single `itinerary_agent` ReAct loop (`createAgent` from `langchain`) with eight bound tools (planning + trip-prep + elicit-as-tool), no router, no separate context/elicit nodes; memory hint is folded into the system prompt via `dynamicSystemPromptMiddleware`, elicit is the `requestTripBasicsFromUser` tool calling `interrupt()`. The seven-step `searchAndRankPointsOfInterest` internal flow is unchanged. |
| `flowchart.md` | Source-of-truth sketch | Minimal Mermaid for the top-level graph + two agents + `searchAndRankPointsOfInterest`. Used as the canonical reference the other three diagrams elaborate on. |

## Color legend

The class palette mirrors redish:

| Color | Class | What it represents |
|---|---|---|
| Purple `#c795e3` | `purple` | LangGraph workflows + agent orchestration |
| Redis-red `#ff4438` | `red` | Redis Stack (hybrid index + checkpoints) + Redis Agent Memory Server |
| Blue `#80dbff` | `blue` | Frontend + Backend services |
| Green `#7cc77f` | `green` | External services (OpenAI, Google Places, Tavily, OSM) |
| Orange `#ffa726` | `orange` | Agent tools |

## How to render

The `render-diagrams.sh` script in this folder uses `@mermaid-js/mermaid-cli` (via `npx`, no global install needed) with the local `mermaid-config.json` (same theme as `redish/openai-version`).

```bash
cd docs/diagrams
./render-diagrams.sh
```

Outputs `<name>.png` and `<name>.svg` next to each source `.md`. Multi-block files (like `02-user-flow-sequence.md`, which has four sequences, and `03-langgraph-workflows.md`, which has the top-level graph + two agent loops + `searchAndRankPointsOfInterest`) produce numbered outputs (`02-user-flow-sequence-1.png` … `-4.png`, `03-langgraph-workflows-1.png` … `-4.png`).

Alternatives:
- Paste a Mermaid block into [mermaid.live](https://mermaid.live) for quick previews (uses default theme, not ours)
- Render in-place via VS Code's Mermaid preview extension
- Skip rendering entirely — most modern markdown viewers (GitHub, VS Code, Obsidian) render Mermaid blocks natively
