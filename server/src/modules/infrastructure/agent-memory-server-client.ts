/**
 * Thin adapter over the Redis Agent Memory Server (AMS) — wraps the official
 * `agent-memory-client` SDK so the rest of the codebase doesn't import its
 * snake_case wire types directly.
 *
 * Two tiers under the hood:
 *   - Working memory   — session-scoped conversation state
 *   - Long-term memory — semantic + episodic, vector-searched cross-session
 *
 * Typed payloads are JSON-encoded into the SDK's `text` field on write and
 * parsed back on read; this lets us keep typed shapes (UserPreference,
 * UserPastTrip, …) on the call site while the AMS continues to vector-index
 * the same content for semantic recall.
 *
 * This module only exposes the AMS primitives. Domain-shaped wrappers
 * (getUserPreferences, getUserPastTrips, …) live in user/domain/user-service.ts.
 */

import { MemoryAPIClient, type MemoryMessage, type MemoryRecord } from 'agent-memory-client';
import { config } from '../../config.ts';

type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

export type MemoryType = 'semantic' | 'episodic';

export interface LongTermMemoryRecord<TPayload = unknown> {
    id: string;
    memoryType: MemoryType;
    topics: string[];
    userId: string;
    payload: TPayload;
    createdAt?: string;
    lastAccessed?: string;
}

export interface SearchLongTermMemoryOptions {
    memoryType: MemoryType;
    topics: string[];
    userId: string;
    limit?: number;
}

export interface CreateLongTermMemoryOptions<TPayload = unknown> {
    memoryType: MemoryType;
    topics: string[];
    userId: string;
    payload: TPayload;
}

export interface WorkingMemorySnapshot {
    sessionId: string;
    state: unknown;
}

let client: MemoryAPIClient | null = null;
function getClient(): MemoryAPIClient {
    if (!client) client = new MemoryAPIClient({ baseUrl: config.agentMemoryServer.url });
    return client;
}

export async function searchLongTermMemory<TPayload = unknown>(
    opts: SearchLongTermMemoryOptions,
): Promise<LongTermMemoryRecord<TPayload>[]> {
    const results = await getClient().searchLongTermMemory({
        // AMS requires a `text` query — for topic-scoped recall we use the
        // joined topics as a coarse semantic anchor and let the filters
        // (topics + userId + memoryType) do the actual narrowing.
        text: opts.topics.join(' '),
        topics: { any: opts.topics },
        userId: { eq: opts.userId },
        memoryType: { eq: opts.memoryType },
        limit: opts.limit,
    });
    return results.memories.map((m) => recordToTyped<TPayload>(m, opts.memoryType));
}

export async function createLongTermMemory<TPayload = unknown>(
    opts: CreateLongTermMemoryOptions<TPayload>,
): Promise<void> {
    const id = `${opts.topics[0] ?? 'memory'}:${opts.userId}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: MemoryRecord = {
        id,
        text: JSON.stringify(opts.payload),
        topics: opts.topics,
        user_id: opts.userId,
        memory_type: opts.memoryType === 'episodic' ? 'episodic' : 'semantic',
    } as MemoryRecord;
    await getClient().createLongTermMemory([record]);
}

export async function getWorkingMemory(
    sessionId: string,
): Promise<WorkingMemorySnapshot | null> {
    const wm = await getClient().getWorkingMemory(sessionId);
    if (!wm) return null;
    return { sessionId, state: wm.data ?? null };
}

export interface PutWorkingMemoryOptions {
    sessionId: string;
    userId?: string;
    messages?: MemoryMessage[];
    data?: Record<string, JsonValue>;
}

export async function putWorkingMemory(opts: PutWorkingMemoryOptions): Promise<void> {
    await getClient().putWorkingMemory(opts.sessionId, {
        session_id: opts.sessionId,
        user_id: opts.userId ?? null,
        messages: opts.messages,
        data: opts.data ?? null,
    });
}

function recordToTyped<TPayload>(
    record: MemoryRecord,
    memoryType: MemoryType,
): LongTermMemoryRecord<TPayload> {
    let payload: TPayload;
    try {
        payload = JSON.parse(record.text) as TPayload;
    } catch {
        payload = record.text as unknown as TPayload;
    }
    return {
        id: record.id,
        memoryType,
        topics: record.topics ?? [],
        userId: record.user_id ?? '',
        payload,
        createdAt: record.created_at,
        lastAccessed: record.last_accessed,
    };
}
