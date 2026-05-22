/**
 * Unified itinerary workflow — barrel.
 *
 *   START → itinerary_agent → END
 *
 * Single ReAct agent (createAgent) bound to 8 tools. Trip basics are
 * extracted from message history per turn rather than persisted as state.
 * Missing basics surface via the `requestTripBasicsFromUser` tool, which
 * pauses the graph through `interrupt()`. Checkpointed via MemorySaver.
 *
 * Source files:
 *   state.ts       — ItineraryState shape + read-modify-write mutation helpers
 *   elicit.ts      — ElicitField/ElicitRequest types + buildTripBasicsElicit
 *   tools.ts       — 8 Zod-validated tools bound to the agent
 *   agents.ts      — itineraryAgent (createAgent + dynamicSystemPromptMiddleware)
 *   annotation.ts  — ItineraryAnnotation channel definitions
 *   graph.ts       — parent StateGraph compile + singleton accessor
 */

export { getItineraryGraph, type CompiledItineraryGraph } from './graph.ts';
export { itineraryAgent } from './agents.ts';
export type { ItineraryState } from './state.ts';
