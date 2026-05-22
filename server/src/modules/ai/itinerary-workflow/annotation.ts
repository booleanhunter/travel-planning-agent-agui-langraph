/**
 * LangGraph `StateSchema` for the itinerary workflow.
 *
 * Lives in its own leaf module so both `graph.ts` and `agents.ts` can import
 * it without forming a runtime cycle. `state.ts` only imports type-level
 * declarations (erased at runtime).
 *
 * Trip-basics intent (destination/dates/budget/groupSize/interests) is NOT
 * declared as state — it lives in the message history and is re-extracted by
 * the LLM each turn. Only durable artifacts (itinerary, tripEssentials,
 * candidatePois, weather) and transient signalling (pendingElicitation) are
 * checkpointed.
 *
 * Why `StateSchema` and not `Annotation.Root`: `createAgent`'s `stateSchema`
 * parameter only consumes `StateSchema` or InteropZodObject — it silently
 * drops Annotation channels (the public TS type is misleading), so any tool
 * writes to `itinerary` / `tripEssentials` would never reach the checkpoint.
 */

import { StateSchema, MessagesValue, ReducedValue } from '@langchain/langgraph';
// Zod v4 satisfies StandardSchema with `jsonSchema`, which StateSchema requires.
// Tools elsewhere still use zod/v3 — that's fine; the StateSchema validators
// only need to type-check the channel shapes at compile time.
import { z } from 'zod/v4';
import type {
    ItineraryState,
    ItineraryDay,
    ItineraryPointOfInterest,
    TripEssential,
} from './state.ts';

/**
 * Channel update types.
 *
 * Both `itinerary` and `tripEssentials` accept either a *delta* (the default,
 * merged into existing state) or a *wholesale replacement* tagged with
 * `{ __action: 'replace', ... }`. The replace sentinel exists for removals
 * and for callers that need to seed the channel from scratch.
 *
 * Deltas are essential for parallel tool calls — when the agent fires N
 * `addPointOfInterestToItinerary` tools in one superstep, each returns a
 * Command with a single-entry delta and the reducer folds them in without
 * races. With a LastValue channel, last-writer-wins would drop N-1 entries.
 */
export type ItineraryUpdate =
    | ItineraryDay[]
    | { __action: 'replace'; days: ItineraryDay[] | undefined };

export type TripEssentialsUpdate =
    | Record<string, TripEssential>
    | { __action: 'replace'; value: Record<string, TripEssential> | undefined };

function itineraryReducer(
    prev: ItineraryDay[] | undefined,
    next: ItineraryUpdate | undefined,
): ItineraryDay[] | undefined {
    if (next == null) return prev;
    if (!Array.isArray(next) && next.__action === 'replace') return next.days;
    if (!Array.isArray(next)) return prev;

    const out = new Map<string, ItineraryDay>();
    for (const d of prev ?? []) out.set(d.dayId, { ...d, entries: [...d.entries] });

    const keyOf = (e: ItineraryPointOfInterest) => `${e.timeOfDay}:${e.pointOfInterestId}`;
    for (const patch of next) {
        const existing = out.get(patch.dayId) ?? {
            dayId: patch.dayId,
            date: patch.date,
            entries: [],
        };
        const seen = new Set(existing.entries.map(keyOf));
        const merged = [...existing.entries];
        for (const e of patch.entries) {
            if (!seen.has(keyOf(e))) {
                merged.push(e);
                seen.add(keyOf(e));
            }
        }
        out.set(patch.dayId, {
            dayId: patch.dayId,
            date: patch.date ?? existing.date,
            entries: merged,
        });
    }
    return Array.from(out.values());
}

// `Record<string, TripEssential>` is structurally compatible with the replace
// sentinel (any key is allowed on a Record), so a bare `'__action' in next`
// narrow doesn't remove the sentinel from the patch branch. An explicit type
// guard keeps the union discrimination unambiguous for TS.
function isReplaceEssentials(
    next: TripEssentialsUpdate,
): next is { __action: 'replace'; value: Record<string, TripEssential> | undefined } {
    return (next as { __action?: string }).__action === 'replace';
}

function tripEssentialsReducer(
    prev: Record<string, TripEssential> | undefined,
    next: TripEssentialsUpdate | undefined,
): Record<string, TripEssential> | undefined {
    if (next == null) return prev;
    if (isReplaceEssentials(next)) return next.value;
    return { ...(prev ?? {}), ...next };
}

// `z.custom` is used for opaque shapes where Zod validation is unnecessary —
// these channels are populated by typed tool helpers, not user input, and the
// runtime types are already enforced by TypeScript at the call sites.
export const ItineraryAnnotation = new StateSchema({
    userId: z.string(),
    sessionId: z.string(),
    messages: MessagesValue,
    candidatePois: z.custom<ItineraryState['candidatePois']>().optional(),
    weather: z.custom<ItineraryState['weather']>().optional(),
    itinerary: new ReducedValue<ItineraryDay[] | undefined, ItineraryUpdate | undefined>(
        z.custom<ItineraryDay[] | undefined>(),
        {
            inputSchema: z.custom<ItineraryUpdate | undefined>(),
            reducer: itineraryReducer,
        },
    ),
    tripEssentials: new ReducedValue<
        Record<string, TripEssential> | undefined,
        TripEssentialsUpdate | undefined
    >(z.custom<Record<string, TripEssential> | undefined>(), {
        inputSchema: z.custom<TripEssentialsUpdate | undefined>(),
        reducer: tripEssentialsReducer,
    }),
    pendingElicitation: z.custom<ItineraryState['pendingElicitation']>().optional(),
});
