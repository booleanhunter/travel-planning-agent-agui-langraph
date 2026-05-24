import { searchPois } from '../../data/pois-redis.js';
import type { AgentStateType } from '../state.js';

export async function fetchRecs(state: AgentStateType): Promise<Partial<AgentStateType>> {
    if (!state.destination) {
        console.log(`[fetch-recs] skipped — no destination set`);
        return { pois: [] };
    }
    const interestQuery = state.interests.length
        ? state.interests.join(' · ')
        : 'popular places to visit';
    console.log(`[fetch-recs] city=${state.destination} query="${interestQuery}"`);
    const pois = await searchPois({
        city: state.destination,
        interestQuery,
        k: 12,
    });
    console.log(
        `[fetch-recs] returned ${pois.length} POIs (top: ${pois
            .slice(0, 3)
            .map((p) => p.name)
            .join(', ')})`,
    );
    return { pois };
}
