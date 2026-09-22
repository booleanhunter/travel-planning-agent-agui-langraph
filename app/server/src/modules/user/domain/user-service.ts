import type { ConversationMessage, LongTermMemoryInput, UserPreferences } from '../types.js';
import {
    searchUserPreferences as repoSearchUserPreferences,
    getConversation as repoGetConversation,
    appendTurn as repoAppendTurn,
    saveLongTermMemory as repoSaveLongTermMemory,
    deleteWorkingMemory as repoDeleteWorkingMemory,
} from '../data/agent-memory-repository.js';

export function getPreferences(userId: string): Promise<UserPreferences | undefined> {
    return repoSearchUserPreferences(userId);
}

export function getConversation(tripId: string): Promise<ConversationMessage[]> {
    return repoGetConversation(tripId);
}

export function appendTurn(
    tripId: string,
    userId: string,
    messages: ConversationMessage[],
): Promise<void> {
    return repoAppendTurn(tripId, userId, messages);
}

export function saveLongTermMemory(records: LongTermMemoryInput[]): Promise<void> {
    return repoSaveLongTermMemory(records);
}

export function deleteWorkingMemory(tripId: string): Promise<void> {
    return repoDeleteWorkingMemory(tripId);
}
