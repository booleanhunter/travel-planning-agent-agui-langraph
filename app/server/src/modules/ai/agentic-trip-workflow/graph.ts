import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentState, type AgentStateType } from './state.js';
import { travelAgent } from './nodes/travel-agent.js';
import { fetchRecs } from './nodes/fetch-recs.js';
import { fetchWeather } from './nodes/fetch-weather.js';
import { followUp } from './nodes/follow-up.js';

/**
 * Pure intent-based routing — no slot checks here. FollowUp owns the
 * elicit decision based on what's still missing.
 *
 *   researching         → FetchRecs                  → FollowUp → END
 *   tripPreparation     → FetchWeather               → FollowUp → END
 *   itineraryPlanning   → [FetchRecs ∥ FetchWeather] → FollowUp → END
 *   general             → FollowUp                   → END
 */
function branchOnIntent(
    state: AgentStateType,
): 'FollowUp' | 'FetchRecs' | 'FetchWeather' | ['FetchRecs', 'FetchWeather'] {
    const next = (() => {
        switch (state.intent) {
            case 'researching':
                return 'FetchRecs' as const;
            case 'tripPreparation':
                return 'FetchWeather' as const;
            case 'itineraryPlanning':
                return ['FetchRecs', 'FetchWeather'] as const;
            case 'general':
                return 'FollowUp' as const;
        }
    })();
    console.log(
        `[graph] branch — intent=${state.intent} → ${Array.isArray(next) ? `[${next.join(', ')}]` : next}`,
    );
    return next as 'FollowUp' | 'FetchRecs' | 'FetchWeather' | ['FetchRecs', 'FetchWeather'];
}

export const graph = new StateGraph(AgentState)
    .addNode('TravelAgent', travelAgent)
    .addNode('FetchRecs', fetchRecs)
    .addNode('FetchWeather', fetchWeather)
    .addNode('FollowUp', followUp)
    .addEdge(START, 'TravelAgent')
    .addConditionalEdges('TravelAgent', branchOnIntent, ['FollowUp', 'FetchRecs', 'FetchWeather'])
    .addEdge('FetchRecs', 'FollowUp')
    .addEdge('FetchWeather', 'FollowUp')
    .addEdge('FollowUp', END)
    .compile();

export const APP_NODES = ['TravelAgent', 'FetchRecs', 'FetchWeather', 'FollowUp'] as const;
