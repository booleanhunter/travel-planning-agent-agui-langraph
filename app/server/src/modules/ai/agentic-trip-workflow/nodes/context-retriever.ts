/**
 * First graph node — hydrate state from persistent stores.
 *
 *   - Redis trip-store HASH `user:<userId>:trip:<tripId>`
 *       → destination, dates, interests, pickedPois
 *   - Agent Memory long-term memory (cross-session facts)
 *       → preferences
 *   - Agent Memory session for `tripId`
 *       → conversationHistory (full — no caps)
 *
 * No client request body is needed for slot data; the server is the source
 * of truth. `followUp` is the corresponding write point at the end of the
 * turn.
 */

import { getPreferences, getConversation } from '#modules/user/domain/user-service.js';
import { getTrip } from '#modules/trips/domain/trips-service.js';
import type { AgentStateType } from '../state.js';

export async function contextRetriever(
    state: AgentStateType,
): Promise<Partial<AgentStateType>> {
    console.log(
        `\n📥 [context-retriever] turn — user=${state.userId} tripId=${state.tripId} msg="${state.userMessage.slice(0, 80)}"`,
    );

    const [preferences, conversationHistory, trip] = await Promise.all([
        getPreferences(state.userId).catch(() => undefined),
        getConversation(state.tripId).catch(() => []),
        getTrip(state.userId, state.tripId).catch(() => null),
    ]);

    const patch: Partial<AgentStateType> = {
        preferences,
        conversationHistory,
    };

    if (trip) {
        patch.destination = trip.destination;
        if (trip.dates) patch.dates = trip.dates;
        if (trip.interests.length) patch.interests = trip.interests;
        if (trip.pickedPois.length) patch.pickedPois = trip.pickedPois;
    }

    console.log(
        `[context-retriever] hydrated — destination=${patch.destination ?? '—'} dates=${patch.dates ? `${patch.dates.start}→${patch.dates.end}` : '—'} interests=[${(patch.interests ?? []).join(',')}] picks=${(patch.pickedPois ?? []).length} priorMessages=${conversationHistory.length} preferences=${preferences ? 'yes' : 'none'}`,
    );

    return patch;
}
