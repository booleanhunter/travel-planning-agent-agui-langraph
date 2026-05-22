/**
 * Unified itinerary-workflow state.
 *
 * Flows through: START → itinerary_agent → END
 *
 * The single agent owns all 8 tools (search, weather, pin, unpin, products,
 * mark essential, unmark essential, requestTripBasicsFromUser). Trip-basics
 * intent (destination, dates, interests, budget, group size) lives in the
 * message history — it is re-extracted by the LLM per turn rather than
 * persisted to dedicated state slots, so pivot prompts ("actually, change to
 * Munnar") work without explicit cache-busting.
 *
 * State is checkpointed by `MemorySaver` (see `helpers/checkpointer.ts`).
 */

import { randomUUID } from 'node:crypto';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import type { WeatherForecast } from '../../infrastructure/web-search-client.ts';
import type { CachedPointOfInterest } from '../../points-of-interest/data/redis-points-of-interest-index.ts';
import type { ElicitRequest } from './elicit.ts';
import { getItineraryGraph } from './graph.ts';
import type { ItineraryUpdate, TripEssentialsUpdate } from './annotation.ts';
import { AppError, ErrorType } from '../../../lib/errors.ts';

// Time-of-day slot a point-of-interest occupies on an itinerary day.
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'meal';

// One pinned entry inside an itinerary day. `pointOfInterestName` is
// denormalised so cards still render after the 7-day index TTL on
// `pointsOfInterest:{placeId}` has elapsed.
export interface ItineraryPointOfInterest {
    id: string;
    timeOfDay: TimeOfDay;
    pointOfInterestId: string;
    pointOfInterestName: string;
    note?: string;
}

// One day of the composed plan. Ordering is implicit in the array index.
export interface ItineraryDay {
    dayId: string;
    date?: string;
    entries: ItineraryPointOfInterest[];
}

// One row in the trip-essentials list. `owned` is the checkbox state;
// `productId` is set only when searchProducts surfaced a buy suggestion.
export interface TripEssential {
    id: string;
    label: string;
    owned: boolean;
    productId?: string;
}

export interface ItineraryState {
    userId: string;
    sessionId: string;

    // Chat history — populated by the CopilotKit runtime adapter on each turn.
    // Trip basics (destination, dates, interests, budget, group size) are NOT
    // persisted as separate slots — the LLM extracts them from this history
    // every turn it needs them, and re-extracts on pivot prompts.
    messages: BaseMessage[];

    // Ranked POI candidates produced by `searchAndRankPointsOfInterest`. The
    // tool is destination-keyed and idempotent — repeat calls with the same
    // destination short-circuit to the cached results without re-fetching.
    // The destination is captured in the struct itself so the tool can
    // compare its input to what's already in state on every invocation
    // (no separate cache key field, no chance of drift).
    candidatePois?: {
        destination: string;
        results: CachedPointOfInterest[];
    };

    // Weather for the trip dates. Populated by the `lookupWeather` tool;
    // shaped as a struct (destination + date range + forecast) so the tool
    // can decide cache hit/miss from its own input alone. The trip-preparation
    // agent reads `.forecast` and never re-fetches.
    weather?: {
        destination: string;
        startDate: string;
        endDate: string;
        forecast: WeatherForecast[];
    };

    // Composed day-by-day plan. Written by `addPointOfInterestToItinerary` /
    // `removePointOfInterestFromItinerary` tools and the matching REST
    // endpoint, both through the mutation helpers below.
    itinerary?: ItineraryDay[];

    // Trip essentials keyed by essential id. Written by `addItemToTripEssentials`
    // / `removeItemFromTripEssentials` tools and the matching REST endpoint,
    // both through the mutation helpers below.
    tripEssentials?: Record<string, TripEssential>;

    // Pending elicitation payload — declared for REST-only introspection of
    // what the agent is waiting on. The live source of truth is the LangGraph
    // interrupt mechanism itself: `requestTripBasicsFromUser` calls
    // `interrupt(elicit)` and CopilotKit / MCP adapters read the payload
    // from `graph.getState().tasks[].interrupts[].value`.
    pendingElicitation?: ElicitRequest;
}

/** Initial state for a new session. */
export function createInitialState(userId: string, sessionId: string): ItineraryState {
    return {
        userId,
        sessionId,
        messages: [],
    };
}

// ────────────────────────────────────────────────────────────────────
// Mutations — shared write layer for `state.itinerary` and `state.tripEssentials`.
//
// Every mutation — whether triggered by an agent tool call or a REST endpoint
// serving a UI click — goes through these helpers. They own the read-modify-
// write cycle against the checkpointed graph state so the two write paths
// can't drift.
//
//   pinPointOfInterest      — add an entry to a day in state.itinerary
//   unpinPointOfInterest    — remove an entry from a day in state.itinerary
//   markTripEssential       — set / upsert a row in state.tripEssentials
//   unmarkTripEssential     — remove a row from state.tripEssentials
//
// Each call snapshots the current state for the given threadId, applies the
// change in-process, and writes the new full value back via
// `graph.updateState`. CopilotKit's runtime forwards the resulting state
// delta to subscribed clients.
// ────────────────────────────────────────────────────────────────────

function configFor(threadId: string): RunnableConfig {
    return { configurable: { thread_id: threadId } };
}

async function snapshot(threadId: string): Promise<ItineraryState> {
    const graph = await getItineraryGraph();
    const snap = await graph.getState(configFor(threadId));
    return (snap.values ?? {}) as ItineraryState;
}

// `asNode` is left undefined so the checkpoint is attributed to the external
// caller (REST endpoint or agent tool) rather than to a graph node — there is
// no "state_mutations" node in the topology and LangGraph rejects unknown ones.
//
// The `values` shape carries channel-level update types (e.g. ItineraryUpdate)
// rather than the resolved state types — that's how delta writes and replace
// sentinels reach the channel reducers in annotation.ts.
type StatePatch = Partial<Omit<ItineraryState, 'itinerary' | 'tripEssentials'>> & {
    itinerary?: ItineraryUpdate;
    tripEssentials?: TripEssentialsUpdate;
};

async function patch(threadId: string, values: StatePatch): Promise<void> {
    const graph = await getItineraryGraph();
    await graph.updateState(configFor(threadId), values);
}

export interface PinPointOfInterestInput {
    dayId: string;
    date?: string;
    timeOfDay: TimeOfDay;
    pointOfInterestId: string;
    pointOfInterestName: string;
    note?: string;
}

/**
 * Add a point-of-interest entry to `state.itinerary`. Creates the day if it
 * doesn't already exist. Entries are deduped per day by
 * `(timeOfDay, pointOfInterestId)` — repeat pins return the existing entry.
 *
 * Writes a single-day delta so the `itinerary` reducer can merge concurrent
 * writes (e.g. a REST pin landing while a sibling REST pin is in flight) and
 * survive checkpoint-step boundaries. Snapshot is still taken so the duplicate
 * pin contract can return the existing entry id.
 */
export async function pinPointOfInterest(
    threadId: string,
    input: PinPointOfInterestInput,
): Promise<ItineraryPointOfInterest> {
    const state = await snapshot(threadId);
    const existingDay = (state.itinerary ?? []).find((d) => d.dayId === input.dayId);
    const existingEntry = existingDay?.entries.find(
        (e) => e.timeOfDay === input.timeOfDay && e.pointOfInterestId === input.pointOfInterestId,
    );
    if (existingEntry) return existingEntry;

    const entry: ItineraryPointOfInterest = {
        id: randomUUID(),
        timeOfDay: input.timeOfDay,
        pointOfInterestId: input.pointOfInterestId,
        pointOfInterestName: input.pointOfInterestName,
        note: input.note,
    };

    await patch(threadId, {
        itinerary: [{ dayId: input.dayId, date: input.date, entries: [entry] }],
    });
    return entry;
}

/**
 * Remove an entry from a day in `state.itinerary` by entry id.
 *
 * Uses the wholesale-replace sentinel because the merge reducer is
 * additive — removals cannot be encoded as deltas.
 */
export async function unpinPointOfInterest(
    threadId: string,
    dayId: string,
    entryId: string,
): Promise<void> {
    const state = await snapshot(threadId);
    const days = state.itinerary;
    if (!days?.length) {
        throw new AppError('NotFoundError', `itinerary day "${dayId}" not found`, ErrorType.NOT_FOUND);
    }

    const day = days.find((d) => d.dayId === dayId);
    if (!day) {
        throw new AppError('NotFoundError', `itinerary day "${dayId}" not found`, ErrorType.NOT_FOUND);
    }

    const before = day.entries.length;
    const nextEntries = day.entries.filter((e) => e.id !== entryId);
    if (nextEntries.length === before) {
        throw new AppError(
            'NotFoundError',
            `itinerary entry "${entryId}" not found`,
            ErrorType.NOT_FOUND,
        );
    }

    const nextDays = days.map((d) => (d.dayId === dayId ? { ...d, entries: nextEntries } : d));
    await patch(threadId, { itinerary: { __action: 'replace', days: nextDays } });
}

/**
 * Upsert a `TripEssential` row in `state.tripEssentials` keyed by `essential.id`.
 * Used both to add a new row and to flip `owned` on an existing one. Writes a
 * single-row delta; the channel reducer spreads it over existing state.
 */
export async function markTripEssential(
    threadId: string,
    essential: TripEssential,
): Promise<TripEssential> {
    if (!essential.id) {
        throw new AppError(
            'ValidationError',
            'TripEssential.id is required',
            ErrorType.INVALID_INPUT,
        );
    }
    await patch(threadId, { tripEssentials: { [essential.id]: essential } });
    return essential;
}

/** Remove a `TripEssential` row by id — uses the wholesale-replace sentinel. */
export async function unmarkTripEssential(threadId: string, essentialId: string): Promise<void> {
    const state = await snapshot(threadId);
    const current = state.tripEssentials;
    if (!current || !(essentialId in current)) {
        throw new AppError(
            'NotFoundError',
            `trip essential "${essentialId}" not found`,
            ErrorType.NOT_FOUND,
        );
    }
    const { [essentialId]: _removed, ...rest } = current;
    await patch(threadId, { tripEssentials: { __action: 'replace', value: rest } });
}
