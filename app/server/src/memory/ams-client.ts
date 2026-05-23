import { MemoryAPIClient, type MemoryRecord, type WorkingMemoryResponse } from "agent-memory-client";
import { config } from "../config.js";
import type { PastTrip, UserPreferences } from "../types.js";

let client: MemoryAPIClient | null = null;

// Only these values are valid interest descriptors. AMS topics that aren't in
// this set (like "trip_history" or city names) must not bleed into prefs.
const LEGAL_INTERESTS = new Set([
  "food", "landmarks", "offbeat", "slow", "outdoors", "nightlife", "culture",
]);

export function getAms(): MemoryAPIClient {
  if (client) return client;
  client = new MemoryAPIClient({ baseUrl: config.agentMemoryServerUrl });
  return client;
}

/**
 * Look up the user's recurring travel preferences via long-term semantic memory.
 * Returns undefined if nothing matches.
 */
export async function searchUserPreferences(userId: string): Promise<UserPreferences | undefined> {
  const ams = getAms();
  const results = await ams.searchLongTermMemory({
    text: "travel preferences budget group size interests",
    userId: { eq: userId },
    topics: { any: ["travel_preferences", "interests", "budget"] },
    limit: 10,
  });
  if (!results.memories.length) return undefined;

  // Roll up findings into a simple shape — heuristic for v1.
  const prefs: UserPreferences = {};
  const interestSet = new Set<string>();
  for (const m of results.memories) {
    const text = m.text.toLowerCase();
    if (text.includes("budget")) {
      if (text.includes("low") || text.includes("shoestring")) prefs.budget = "low";
      else if (text.includes("high") || text.includes("luxury")) prefs.budget = "high";
      else prefs.budget = "mid";
    }
    if (text.includes("solo")) prefs.groupSize = "solo";
    else if (text.includes("family")) prefs.groupSize = "family";
    else if (text.includes("group")) prefs.groupSize = "group";
    else if (text.includes("pair") || text.includes("couple")) prefs.groupSize = "pair";

    for (const t of m.topics ?? []) {
      if (LEGAL_INTERESTS.has(t)) interestSet.add(t);
    }
  }
  if (interestSet.size) prefs.recurringInterests = Array.from(interestSet);
  return prefs;
}

/**
 * Fetch the conversation transcript for a session, if any.
 */
export async function getConversation(sessionId: string): Promise<WorkingMemoryResponse | null> {
  return getAms().getWorkingMemory(sessionId);
}

/**
 * Append a user/assistant message pair to the session's working memory.
 * Fire-and-forget at the call site.
 */
export async function appendTurn(
  sessionId: string,
  userId: string,
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
): Promise<void> {
  const ams = getAms();
  const existing = await ams.getOrCreateWorkingMemory(sessionId, { userId });
  await ams.putWorkingMemory(sessionId, {
    session_id: sessionId,
    user_id: userId,
    messages: [...(existing.messages ?? []), ...messages.map((m, i) => ({
      role: m.role,
      content: m.content,
      id: `${sessionId}-${Date.now()}-${i}`,
    }))],
  });
}

/**
 * List the user's past trips from long-term episodic memory.
 */
export async function listPastTrips(userId: string): Promise<PastTrip[]> {
  const ams = getAms();
  const results = await ams.searchLongTermMemory({
    text: "trip itinerary",
    userId: { eq: userId },
    topics: { any: ["trip_history"] },
    limit: 50,
  });
  return results.memories
    .map((m) => parseTripFromMemory(m))
    .filter((t): t is PastTrip => t !== null);
}

function parseTripFromMemory(m: MemoryRecord): PastTrip | null {
  try {
    // Episodes are stored as JSON in the `text` field — see saveTrip below.
    const parsed = JSON.parse(m.text);
    if (!parsed.tripId || !parsed.sessionId || !parsed.city) return null;
    return parsed as PastTrip;
  } catch {
    return null;
  }
}

/**
 * Save a completed trip as a long-term episodic memory record.
 */
export async function saveTrip(userId: string, trip: PastTrip): Promise<void> {
  const ams = getAms();
  await ams.createLongTermMemory([
    {
      id: trip.tripId,
      text: JSON.stringify(trip),
      user_id: userId,
      session_id: trip.sessionId,
      topics: ["trip_history", trip.city],
      memory_type: "episodic" as MemoryRecord["memory_type"],
    },
  ]);
}
