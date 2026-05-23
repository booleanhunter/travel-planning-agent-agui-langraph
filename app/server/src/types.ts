/**
 * Shared types between server graph nodes, REST routes, and (copied to) the client.
 */

export type City = "bangalore" | "mumbai" | "barcelona";

export type POICategory = "food" | "culture" | "outdoors" | "nightlife" | "shopping" | "other";

export interface POI {
  id: string;            // Google placeId
  name: string;
  description: string;
  rating: number;        // 0..5
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
  month: number;         // 1..12
  high: number;          // celsius
  low: number;
  condition: string;
  precipitationChance: number;  // 0..1
}

export interface ElicitField {
  name: string;
  type: "string" | "enum" | "multi-enum" | "date" | "date-range";
  label: string;
  helpText?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  prefilledFromMemory?: boolean;
  default?: unknown;
}

export interface ElicitSpec {
  message: string;
  /** Fields the client renders as chips/inputs. (For MCP wrapping, this maps to requestedSchema.) */
  fields: ElicitField[];
}

export interface UserPreferences {
  budget?: "low" | "mid" | "high";
  groupSize?: "solo" | "pair" | "family" | "group";
  recurringInterests?: string[];
}

export interface PastTrip {
  tripId: string;
  sessionId: string;
  city: City;
  dates?: { start: string; end: string };
  summary: string;
  pickedPoiIds: string[];
}
