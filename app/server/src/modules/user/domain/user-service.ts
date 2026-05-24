import type { UserPreferences } from '../../../types.js';
import {
    searchUserPreferences as repoSearchUserPreferences,
    getConversation as repoGetConversation,
    appendTurn as repoAppendTurn,
} from '../data/ams-repository.js';
import type { WorkingMemoryResponse } from 'agent-memory-client';

export function getPreferences(userId: string): Promise<UserPreferences | undefined> {
    return repoSearchUserPreferences(userId);
}

export function getConversation(sessionId: string): Promise<WorkingMemoryResponse | null> {
    return repoGetConversation(sessionId);
}

export function appendTurn(
    sessionId: string,
    userId: string,
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
): Promise<void> {
    return repoAppendTurn(sessionId, userId, messages);
}
