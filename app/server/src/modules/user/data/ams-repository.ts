import { MemoryAPIClient, type MemoryRecord, type WorkingMemoryResponse } from 'agent-memory-client';
import { config } from '#config';
import type { UserPreferences } from '../types.js';

let client: MemoryAPIClient | null = null;

// Only these values are valid interest descriptors. AMS topics that aren't in
// this set (like "trip_history" or city names) must not bleed into prefs.
const LEGAL_INTERESTS = new Set([
    'food',
    'landmarks',
    'offbeat',
    'slow',
    'outdoors',
    'nightlife',
    'culture',
]);

export function getAms(): MemoryAPIClient {
    if (client) return client;
    client = new MemoryAPIClient({ baseUrl: config.agentMemoryServerUrl });
    return client;
}

/**
 * Look up the user's recurring travel preferences via long-term semantic memory.
 * Returns undefined if nothing matches.
 */
export async function searchUserPreferences(userId: string): Promise<UserPreferences | undefined> {
    const ams = getAms();
    const results = await ams.searchLongTermMemory({
        text: 'travel preferences budget group size interests',
        userId: { eq: userId },
        topics: { any: ['travel_preferences', 'interests', 'budget'] },
        limit: 10,
    });
    if (!results.memories.length) return undefined;

    // Roll up findings into a simple shape — heuristic for v1.
    const prefs: UserPreferences = {};
    const interestSet = new Set<string>();
    for (const memory of results.memories) {
        const text = memory.text.toLowerCase();
        if (text.includes('budget')) {
            if (text.includes('low') || text.includes('shoestring')) prefs.budget = 'low';
            else if (text.includes('high') || text.includes('luxury')) prefs.budget = 'high';
            else prefs.budget = 'mid';
        }
        if (text.includes('solo')) prefs.groupSize = 'solo';
        else if (text.includes('family')) prefs.groupSize = 'family';
        else if (text.includes('group')) prefs.groupSize = 'group';
        else if (text.includes('pair') || text.includes('couple')) prefs.groupSize = 'pair';

        for (const topic of memory.topics ?? []) {
            if (LEGAL_INTERESTS.has(topic)) interestSet.add(topic);
        }
    }
    if (interestSet.size) prefs.recurringInterests = Array.from(interestSet);
    return prefs;
}

/**
 * Fetch the conversation transcript for a session, if any.
 */
export async function getConversation(sessionId: string): Promise<WorkingMemoryResponse | null> {
    return getAms().getWorkingMemory(sessionId);
}

/**
 * Bulk-write long-term memory records. Used by archiveTripToMemory and the
 * data seed script. Memory IDs are deterministic — re-writes overwrite.
 */
export async function saveLongTermMemory(records: MemoryRecord[]): Promise<void> {
    await getAms().createLongTermMemory(records);
}

/**
 * Wipe the working memory for a session. Used by the Reset flow so the
 * conversation history doesn't bleed into the user's next planning attempt.
 */
export async function deleteWorkingMemory(sessionId: string): Promise<void> {
    await getAms().deleteWorkingMemory(sessionId);
}

/**
 * Append a user/assistant message pair to the session's working memory.
 * Fire-and-forget at the call site.
 */
export async function appendTurn(
    sessionId: string,
    userId: string,
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
): Promise<void> {
    const ams = getAms();
    const existing = await ams.getOrCreateWorkingMemory(sessionId, { userId });
    await ams.putWorkingMemory(sessionId, {
        session_id: sessionId,
        user_id: userId,
        messages: [
            ...(existing.messages ?? []),
            ...messages.map((message, index) => ({
                role: message.role,
                content: message.content,
                id: `${sessionId}-${Date.now()}-${index}`,
            })),
        ],
    });
}
