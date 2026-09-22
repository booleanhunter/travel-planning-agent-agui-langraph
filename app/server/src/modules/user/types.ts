export interface UserPreferences {
    budget?: 'low' | 'mid' | 'high';
    groupSize?: 'solo' | 'pair' | 'family' | 'group';
    recurringInterests?: string[];
}

/** One turn of the conversation transcript, in the order it was spoken. */
export interface ConversationMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

/**
 * A hand-authored long-term memory (seeded personas, archived trips).
 * Maps to the SDK's CreateMemoryRecord: `id` is client-provided for idempotent
 * creation, `userId` becomes `ownerId`.
 */
export interface LongTermMemoryInput {
    id: string;
    userId: string;
    text: string;
    topics?: string[];
}
