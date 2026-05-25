import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { commitPicks } from '#modules/trips/domain/trips-service.js';
import type { POI } from '#modules/places/types.js';
import type { AgentStateType } from './state.js';

/**
 * Build the updateItinerary tool for a single agent turn.
 * The closure captures `state` so the LLM doesn't need to pass user/session.
 * `onApplied` lets the caller (follow-up node) capture what was actually
 * persisted, so it can be returned in the node's patch.
 */
export function makeUpdateItineraryTool(state: AgentStateType, onApplied: (picks: POI[]) => void) {
    return tool(
        async ({ pickedPois }: { pickedPois: Array<{ poiId: string; name: string }> }) => {
            const enriched = await commitPicks(
                state.userId,
                state.sessionId,
                pickedPois,
                state.pois,
                state.pickedPois,
            );
            onApplied(enriched);
            console.log(
                `🔧 [tools] updateItinerary — wrote ${enriched.length} picks (${enriched.map((p) => p.name).join(', ')})`,
            );
            return { updated: true, count: enriched.length };
        },
        {
            name: 'updateItinerary',
            description:
                "Replace the user's current picked-places set with the given list. " +
                "ONLY call this tool when the user's message NAMES specific places — examples: " +
                '"add Cubbon Park", "remove MTR", "swap Koshy\'s for Karavalli", "clear my picks". ' +
                'DO NOT call this for generic requests, browsing, small talk, or thanks. ' +
                'DO NOT auto-pick the candidates. ' +
                'Always pass the FULL new set, not a delta. Use poiIds from the candidate list.',
            schema: z.object({
                pickedPois: z.array(z.object({ poiId: z.string(), name: z.string() })),
            }),
        },
    );
}
