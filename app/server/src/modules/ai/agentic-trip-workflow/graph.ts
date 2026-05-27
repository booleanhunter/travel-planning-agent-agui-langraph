import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentState } from './state.js';
import { travelAgent } from './nodes/travel-agent.js';
import { followUp } from './nodes/follow-up.js';

/**
 * Two-node agentic graph:
 *
 *   START → TravelAgent (ReAct loop with bound tools) → FollowUp → END
 *
 * TravelAgent is the agent — the LLM picks which tools to call (searchPois,
 * getWeather, updateItinerary, saveTripToCalendar). FollowUp does rule-based
 * bookkeeping (slot extraction from tool args, draft persist, elicit
 * decision) plus one tiny LLM call for `suggestedActions`.
 */
export const graph = new StateGraph(AgentState)
    .addNode('TravelAgent', travelAgent)
    .addNode('FollowUp', followUp)
    .addEdge(START, 'TravelAgent')
    .addEdge('TravelAgent', 'FollowUp')
    .addEdge('FollowUp', END)
    .compile();

export const APP_NODES = ['TravelAgent', 'FollowUp'] as const;
