/**
 * Types shared with the server. Hand-mirrored from server/src/types.ts.
 */

export type City = 'bangalore' | 'mumbai' | 'barcelona';

export type POICategory = 'food' | 'culture' | 'outdoors' | 'nightlife' | 'shopping' | 'other';

export interface POI {
    id: string;
    name: string;
    description: string;
    rating: number;
    photoUrl: string | null;
    category: POICategory;
    city: City;
    lat: number;
    lng: number;
    score?: number;
}

export interface Weather {
    city: City;
    month: number;
    high: number;
    low: number;
    condition: string;
    precipitationChance: number;
}

export interface ElicitField {
    name: string;
    type: 'string' | 'enum' | 'multi-enum' | 'date' | 'date-range';
    label: string;
    helpText?: string;
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
    prefilledFromMemory?: boolean;
    default?: unknown;
}

export interface ElicitSpec {
    message: string;
    fields: ElicitField[];
}

export interface UserPreferences {
    budget?: 'low' | 'mid' | 'high';
    groupSize?: 'solo' | 'pair' | 'family' | 'group';
    recurringInterests?: string[];
}

export interface PastTrip {
    tripId: string;
    sessionId: string;
    city: City;
    dates?: { start: string; end: string };
    pickedPois: POI[];
    createdAt?: string;
    completedAt?: string;
}

export type DotStatus = 'idle' | 'pending' | 'done' | 'error';
