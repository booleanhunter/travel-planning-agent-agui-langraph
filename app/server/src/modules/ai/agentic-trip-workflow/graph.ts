import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentState } from './state.js';
import { contextRetriever } from './nodes/context-retriever.js';
import { travelAgent } from './nodes/travel-agent.js';
import { followUp } from './nodes/follow-up.js';

/**
 * Three-node agentic graph:
 *
 *   START → contextRetriever → travelAgent → followUp → END
 *
 * - contextRetriever: hydrate state from Redis trip-store + AMS (single read
 *   point at graph entry).
 * - travelAgent: ReAct loop with bound tools — the LLM decides what to call.
 * - followUp: one LLM call to extract slots from the full conversation,
 *   decide elicit, generate suggestions; then persist new info to Redis +
 *   AMS (single write point at graph exit).
 */
export const graph = new StateGraph(AgentState)
    .addNode('ContextRetriever', contextRetriever)
    .addNode('TravelAgent', travelAgent)
    .addNode('FollowUp', followUp)
    .addEdge(START, 'ContextRetriever')
    .addEdge('ContextRetriever', 'TravelAgent')
    .addEdge('TravelAgent', 'FollowUp')
    .addEdge('FollowUp', END)
    .compile();

export const APP_NODES = ['ContextRetriever', 'TravelAgent', 'FollowUp'] as const;
