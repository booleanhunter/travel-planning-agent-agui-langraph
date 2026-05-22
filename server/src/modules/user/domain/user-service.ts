/**
 * User domain — projects AMS long-term memory into user-shaped objects.
 *
 * Used by /api/user routes (drawer profile + past-trip loading) and by the
 * itinerary workflow's resolve_user_context node (preferences + past-trip ids).
 * All AMS access goes through the infrastructure adapter; this layer owns the
 * topics, payload shapes, and trip-id derivation.
 */

import {
    searchLongTermMemory,
    createLongTermMemory,
    getWorkingMemory,
} from '../../infrastructure/agent-memory-server-client.ts';

// AMS topics owned by the user domain.
const TOPIC_TRAVEL_PREFERENCES = 'travel_preferences';
const TOPIC_TRIP_HISTORY = 'trip_history';
const TOPIC_TRIP_ESSENTIALS_INVENTORY = 'trip_essentials_inventory';

export interface UserPreference {
    // 'interest' is multi-row: one entry per descriptor the user has favoured
    // across past trips (e.g. {type:'interest', value:'food', frequency:4}).
    // 'budget' / 'groupSize' / 'pace' / 'dietary' are single-row preferences.
    type: 'interest' | 'budget' | 'groupSize' | 'pace' | 'dietary';
    value: string;
    frequency: number; // "last N trips"
    lastSeen: string;
}

export interface UserPastTrip {
    tripId: string;
    sessionId: string;
    destination: string;
    startDate: string;
    durationDays: number;
    pointOfInterestCount: number;
    summary: string;
}

export interface TripEssentialItem {
    item: string;
    lastSeen: string;
}

export interface UserProfile {
    user: { id: string; name: string };
    preferences: UserPreference[];
    pastTrips: UserPastTrip[];
}

/** Fetch the drawer's profile data — preferences + past trips in parallel. */
export async function getProfile(userId: string): Promise<UserProfile> {
    const [preferences, pastTrips] = await Promise.all([
        getUserPreferences(userId),
        getUserPastTrips(userId),
    ]);
    return {
        user: { id: userId, name: 'Ashwin' }, // TODO: lookup user record
        preferences,
        pastTrips,
    };
}

/** Load a past trip's session — rehydrates the conversation + composed itinerary. */
export async function loadTripSession(tripId: string): Promise<unknown> {
    // TODO: lookup the trip's sessionId from its long-term-memory record,
    // then call getWorkingMemory(sessionId).
    return getWorkingMemory(tripId);
}

export async function getUserPreferences(userId: string): Promise<UserPreference[]> {
    // Best-effort — memory is advisory, never a hard prerequisite for a turn.
    // A flaky AMS or an unknown user must not break the agent's prompt build.
    try {
        const records = await searchLongTermMemory<UserPreference>({
            memoryType: 'semantic',
            topics: [TOPIC_TRAVEL_PREFERENCES],
            userId,
        });
        return records.map((r) => r.payload);
    } catch {
        return [];
    }
}

export async function storeUserPreference(
    userId: string,
    pref: Omit<UserPreference, 'lastSeen'>,
): Promise<void> {
    await createLongTermMemory<UserPreference>({
        memoryType: 'semantic',
        topics: [TOPIC_TRAVEL_PREFERENCES],
        userId,
        payload: { ...pref, lastSeen: new Date().toISOString() },
    });
}

export async function getUserPastTrips(userId: string, limit = 10): Promise<UserPastTrip[]> {
    const records = await searchLongTermMemory<UserPastTrip>({
        memoryType: 'episodic',
        topics: [TOPIC_TRIP_HISTORY],
        userId,
        limit,
    });
    return records.map((r) => r.payload);
}

export async function storeUserPastTrip(
    userId: string,
    trip: Omit<UserPastTrip, 'tripId'>,
): Promise<string> {
    const tripId = `${trip.destination.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${trip.startDate}`;
    await createLongTermMemory<UserPastTrip>({
        memoryType: 'episodic',
        topics: [TOPIC_TRIP_HISTORY],
        userId,
        payload: { ...trip, tripId },
    });
    return tripId;
}

export async function getUserTripEssentialsInventory(
    userId: string,
): Promise<TripEssentialItem[]> {
    const records = await searchLongTermMemory<TripEssentialItem>({
        memoryType: 'semantic',
        topics: [TOPIC_TRIP_ESSENTIALS_INVENTORY],
        userId,
    });
    return records.map((r) => r.payload);
}
