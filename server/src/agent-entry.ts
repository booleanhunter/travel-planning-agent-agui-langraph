/**
 * Entry point for the `langgraphjs dev` CLI server (port 8123).
 *
 * `@langchain/langgraph-cli` expects each `graphs[name]` value in
 * `server/langgraph.json` to resolve to an already-compiled `Pregel`
 * (CompiledStateGraph). `createAgent()` returns an agent whose `.graph`
 * property is exactly that, so we re-export it here without setting a
 * checkpointer — the CLI server attaches its own thread-aware checkpointer
 * (Postgres in prod, in-memory in dev) and we let it own that concern.
 *
 * Mutation helpers in `ai/itinerary-workflow/state.ts` still target the
 * in-process compiled graph (from `graph.ts`); when the REST routes need
 * to mutate the CLI-server-owned thread state, they should call the
 * langgraph-sdk-js client (`client.threads.updateState`) instead of the
 * in-process helpers.
 */

import { itineraryAgent } from './modules/ai/itinerary-workflow/agents.ts';

export const graph = itineraryAgent.graph;
