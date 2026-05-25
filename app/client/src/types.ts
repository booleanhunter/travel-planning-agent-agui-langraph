/**
 * Types shared with the server. Hand-mirrored from server/src/types.ts.
 */

/**
 * Cities the agent can plan trips for.
 * KEEP IN SYNC with server/src/modules/places/types.ts CitySchema.
 */
export type City =
    | 'bangalore'
    | 'mumbai'
    | 'delhi'
    | 'goa'
    | 'jaipur'
    | 'kochi'
    | 'manali'
    | 'hyderabad'
    | 'tokyo'
    | 'kyoto'
    | 'seoul'
    | 'singapore'
    | 'bangkok'
    | 'hanoi'
    | 'ubud'
    | 'barcelona'
    | 'lisbon'
    | 'paris'
    | 'london'
    | 'berlin'
    | 'amsterdam'
    | 'rome'
    | 'prague'
    | 'istanbul'
    | 'dubai'
    | 'cape-town'
    | 'marrakech'
    | 'new-york'
    | 'san-francisco'
    | 'vancouver'
    | 'mexico-city'
    | 'buenos-aires'
    | 'sydney';

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
    pickedPois: POI[];
    createdAt?: string;
    completedAt?: string;
}

export type DotStatus = 'idle' | 'pending' | 'done' | 'error';
