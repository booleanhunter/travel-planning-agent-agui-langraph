/**
 * Redis Agent Memory (Iris) repository.
 *
 * Talks to the hosted Agent Memory service through the @redis-iris/agent-memory
 * SDK. Two stores, mapped from our domain concepts:
 *
 *   working memory (transcript)  session = tripId, actor = userId
 *                                one session event per message, ordered by
 *                                ingestion — the server keeps event order, so
 *                                no client-side sequencing is needed.
 *   long-term memory (facts)     ownerId = userId, categorized by `topics`
 *
 * The SDK connects over HTTP (serverURL + storeId + bearer apiKey); there is
 * no local server. Roles cross the boundary as the SDK's uppercase MessageRole
 * enum and are normalized back to our lowercase roles on read.
 */

import { AgentMemory } from '@redis-iris/agent-memory';
import { config } from '#config';
import { INTEREST_VALUES } from '#modules/places/catalog.js';
import type { ConversationMessage, LongTermMemoryInput, UserPreferences } from '../types.js';

let client: AgentMemory | null = null;

export function getAgentMemory(): AgentMemory {
    if (client) return client;
    client = new AgentMemory({
        serverURL: config.agentMemory.serverUrl,
        storeId: config.agentMemory.storeId,
        apiKey: config.agentMemory.apiKey,
    });
    return client;
}

// Allowlist of real interest tags — topics that aren't in this set (like
// "trip_history" or a city name) must not bleed into preferences. Built from the
// canonical catalog vocabulary so it can't drift from the chip-card options.
const VALID_INTERESTS = new Set<string>(INTEREST_VALUES);

// Topics that mark a memory as a standing preference (vs. a trip-history record).
const PREFERENCE_TOPICS = ['travel_preferences', 'interests', 'budget'];

function toSdkRole(role: ConversationMessage['role']): 'USER' | 'ASSISTANT' | 'SYSTEM' {
    if (role === 'assistant') return 'ASSISTANT';
    if (role === 'system') return 'SYSTEM';
    return 'USER';
}

function fromSdkRole(role: unknown): ConversationMessage['role'] {
    const normalized = String(role).toUpperCase();
    if (normalized === 'ASSISTANT') return 'assistant';
    if (normalized === 'SYSTEM') return 'system';
    return 'user';
}

/**
 * Look up the user's recurring travel preferences from long-term memory.
 * Scoped to preference-topic records so trip-history memories don't leak in.
 * Returns undefined if nothing matches.
 */
export async function searchUserPreferences(userId: string): Promise<UserPreferences | undefined> {
    const result = await getAgentMemory().searchLongTermMemory({
        text: 'travel preferences budget group size interests',
        // ownerId AND (any preference topic). `all` = every clause must hold;
        // topics.in matches any of the listed topics.
        filter: {
            ownerId: { eq: userId },
            topics: { in: PREFERENCE_TOPICS },
        },
        filterOp: 'all',
        limit: 10,
    });

    const memories = result.items ?? [];
    if (!memories.length) return undefined;

    // Roll up findings into a simple shape — heuristic, unchanged from AMS.
    const prefs: UserPreferences = {};
    const interestSet = new Set<string>();
    for (const memory of memories) {
        const text = String(memory.text ?? '').toLowerCase();
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
            if (VALID_INTERESTS.has(topic)) interestSet.add(topic);
        }
    }
    if (interestSet.size) prefs.recurringInterests = Array.from(interestSet);
    return prefs;
}

/**
 * Fetch the conversation transcript for a trip, in spoken order.
 * A session that doesn't exist yet yields an empty transcript rather than an
 * error — the first turn of a trip has nothing to hydrate.
 */
export async function getConversation(tripId: string): Promise<ConversationMessage[]> {
    try {
        const memory = await getAgentMemory().getSessionMemory(tripId);
        return (memory.events ?? []).map((event) => ({
            role: fromSdkRole(event.role),
            content: (event.content ?? []).map((part) => part.text).join(''),
        }));
    } catch {
        // Session not found (first turn) or transient read failure — the
        // caller treats an empty transcript as "no prior context".
        return [];
    }
}

/**
 * Bulk-write hand-authored long-term memories. Used by archiveTripToMemory and
 * the seed script. `id` is client-provided so re-writes are idempotent.
 */
export async function saveLongTermMemory(records: LongTermMemoryInput[]): Promise<void> {
    if (!records.length) return;
    await getAgentMemory().bulkCreateLongTermMemories({
        memories: records.map((record) => ({
            id: record.id,
            text: record.text,
            ownerId: record.userId,
            ...(record.topics?.length ? { topics: record.topics } : {}),
        })),
    });
}

/**
 * Delete the working-memory session for a trip. Used by the Reset flow so the
 * conversation doesn't bleed into the user's next planning attempt. Long-term
 * facts are keyed by ownerId, not session, so they're untouched.
 */
export async function deleteWorkingMemory(tripId: string): Promise<void> {
    await getAgentMemory().deleteSessionMemory(tripId);
}

/**
 * Append a turn to the trip's session. One session event per message — the SDK
 * takes a single event per call and creates the session on first write. The
 * server preserves event order, so no sequence bookkeeping is needed.
 *
 * Awaited by the caller: the next turn hydrates its history from this session,
 * so the writes must land before the turn returns.
 */
export async function appendTurn(
    tripId: string,
    userId: string,
    messages: ConversationMessage[],
): Promise<void> {
    const agentMemory = getAgentMemory();
    for (const message of messages) {
        await agentMemory.addSessionEvent({
            sessionId: tripId,
            actorId: userId,
            role: toSdkRole(message.role),
            content: [{ text: message.content }],
            createdAt: new Date(),
        });
    }
}
