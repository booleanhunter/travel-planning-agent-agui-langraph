export interface UserPreferences {
    budget?: 'low' | 'mid' | 'high';
    groupSize?: 'solo' | 'pair' | 'family' | 'group';
    recurringInterests?: string[];
}
