# Trip Itinerary Builder

Working full-stack demo for **Frontend Nation 2026** — *"Context is Everything: Adaptive UI Patterns for AI Applications"*.

The same demo is reused for **MCP Dev Summit** — *"Building Interactive Tools with MCP Elicitation"*.

## Stack

- **Frontend** — React 19 + Vite + TypeScript, CopilotKit (AG-UI), React-Leaflet over OpenStreetMap, vanilla CSS
- **Backend** — Node.js 24 + Express 5 + LangGraph.js, OpenAI GPT-4o-mini
- **External APIs** — Google Places API (POI discovery), Tavily (weather + products)
- **Memory** — Redis Agent Memory Server, Redis Stack (both via Docker)

Full architecture in [`docs/diagrams/`](./docs/diagrams/).

## Getting started

### Prerequisites

- Node.js >= 24
- Docker (only needed once API keys are wired — see `USE_MOCKS=false`)
- API keys for the full experience: `OPENAI_API_KEY`, `GOOGLE_MAPS_API_KEY`, `TAVILY_API_KEY`

### Setup

```bash
# 1. Install workspace dependencies
npm install

# 2. Start client + server in dev mode (uses USE_MOCKS=true by default)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Try: *"Plan a trip to Bangalore"*.

### Mock mode vs full mode

By default the server runs with `USE_MOCKS=true`:

- Agent Memory Server → in-process fixtures (`server/src/modules/memory/data/memory-mocks.ts`)
- Google Places / Tavily → mocked responses (filled in per feature)
- LangGraph checkpointer → `MemorySaver` (in-process, not Redis)

To switch to the full stack:

```bash
cp .env.example .env       # fill in API keys
echo "USE_MOCKS=false" >> .env
npm run docker:up          # Redis + Agent Memory Server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

RedisInsight (memory inspector, useful on stage): [http://localhost:8001](http://localhost:8001).

### Stop

```bash
npm run docker:down       # stop services, keep data
npm run docker:reset      # stop + remove volumes (fresh start)
```

## Project layout

```
trip-itinerary-builder/
├── client/                  # Vite + React + TS frontend
├── server/                  # Node + Express + LangGraph backend
├── docs/                    # Talk outline, tech stack, diagrams, design references
├── docker-compose.yaml      # Redis + Agent Memory Server
├── .env.example
└── package.json             # workspace root
```

## Docs

- [`docs/diagrams/`](./docs/diagrams/) — Mermaid system architecture + LangGraph workflow diagrams

## License

Internal demo, not for redistribution. Inspired by `redis-developer/restaurant-discovery-ai-agent-demo`.
