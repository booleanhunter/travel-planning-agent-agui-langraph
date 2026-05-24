/**
 * Shared types between server graph nodes, REST routes, and (copied to) the client.
 */

export type City = 'bangalore' | 'mumbai' | 'barcelona';

export type POICategory = 'food' | 'culture' | 'outdoors' | 'nightlife' | 'shopping' | 'other';

export interface POI {
    id: string; // Google placeId
    name: string;
    description: string;
    rating: number; // 0..5
    photoUrl: string | null;
    category: POICategory;
    city: City;
    lat: number;
    lng: number;
    /** Optional KNN score from the hybrid search (lower = closer). */
    score?: number;
}

export interface Weather {
    city: City;
    month: number; // 1..12
    high: number; // celsius
    low: number;
    condition: string;
    precipitationChance: number; // 0..1
}

/**
 * Subset of JSON Schema allowed in MCP elicitation `requestedSchema`.
 * Per spec: flat objects with primitive properties only — no nested objects.
 * Allowed: string (with format), number/integer, boolean, enum (single via
 * enum/oneOf), array of enums (multi via items.enum/items.anyOf).
 */
export type ElicitStringSchema = {
    type: 'string';
    title?: string;
    description?: string;
    format?: 'email' | 'uri' | 'date' | 'date-time';
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    default?: string;
    enum?: string[];
    oneOf?: Array<{ const: string; title?: string }>;
};

export type ElicitNumberSchema = {
    type: 'number' | 'integer';
    title?: string;
    description?: string;
    minimum?: number;
    maximum?: number;
    default?: number;
};

export type ElicitBooleanSchema = {
    type: 'boolean';
    title?: string;
    description?: string;
    default?: boolean;
};

export type ElicitArrayEnumSchema = {
    type: 'array';
    title?: string;
    description?: string;
    items: {
        type?: 'string';
        enum?: string[];
        anyOf?: Array<{ const: string; title?: string }>;
    };
    minItems?: number;
    maxItems?: number;
    default?: string[];
};

export type ElicitPrimitiveSchema =
    | ElicitStringSchema
    | ElicitNumberSchema
    | ElicitBooleanSchema
    | ElicitArrayEnumSchema;

export interface ElicitSpec {
    message: string;
    requestedSchema: {
        type: 'object';
        properties: Record<string, ElicitPrimitiveSchema>;
        required?: string[];
    };
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
    /** Picked places stored as full POI records for round-tripping to the UI. */
    pickedPois: POI[];
    createdAt?: string;
    completedAt?: string;
}
