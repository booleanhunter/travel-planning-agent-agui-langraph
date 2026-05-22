/**
 * Compile + singleton-cache the itinerary-workflow.
 *
 * The workflow IS the ReAct agent — `createAgent` already produces a fully
 * compiled StateGraph (`itineraryAgent.graph`) with the agent + tool nodes
 * wired in. We attach the shared checkpointer to it and return that graph
 * directly; there is no extra StateGraph wrapper.
 *
 * Tool-issued `interrupt()`s inside `requestTripBasicsFromUser` pause the
 * graph naturally; on resume the agent picks up where it left off.
 *
 * Kept separate from `index.ts` so `state.ts` can import `getItineraryGraph`
 * (for its mutation helpers) without forming a circular runtime import
 * through the barrel.
 */

import { itineraryAgent } from './agents.ts';
import { getCheckpointer } from '../helpers/checkpointer.ts';

export { ItineraryAnnotation } from './annotation.ts';

export type CompiledItineraryGraph = typeof itineraryAgent.graph;

async function compile(): Promise<CompiledItineraryGraph> {
    itineraryAgent.checkpointer = await getCheckpointer();
    return itineraryAgent.graph;
}

// Shared by the CopilotKit runtime mount and the mutation helpers in state.ts
// so both write paths target the same compiled graph + checkpointer.
let graphPromise: Promise<CompiledItineraryGraph> | null = null;
export function getItineraryGraph(): Promise<CompiledItineraryGraph> {
    if (!graphPromise) graphPromise = compile();
    return graphPromise;
}
