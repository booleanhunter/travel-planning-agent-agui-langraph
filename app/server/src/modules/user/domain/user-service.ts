import type { UserPreferences } from '../types.js';
import {
    searchUserPreferences as repoSearchUserPreferences,
    getConversation as repoGetConversation,
    appendTurn as repoAppendTurn,
    saveLongTermMemory as repoSaveLongTermMemory,
    deleteWorkingMemory as repoDeleteWorkingMemory,
} from '../data/ams-repository.js';
import type { MemoryRecord, WorkingMemoryResponse } from 'agent-memory-client';

export function getPreferences(userId: string): Promise<UserPreferences | undefined> {
    return repoSearchUserPreferences(userId);
}

export function getConversation(tripId: string): Promise<WorkingMemoryResponse | null> {
    return repoGetConversation(tripId);
}

export function appendTurn(
    tripId: string,
    userId: string,
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
): Promise<void> {
    return repoAppendTurn(tripId, userId, messages);
}

export function saveLongTermMemory(records: MemoryRecord[]): Promise<void> {
    return repoSaveLongTermMemory(records);
}

export function deleteWorkingMemory(tripId: string): Promise<void> {
    return repoDeleteWorkingMemory(tripId);
}
