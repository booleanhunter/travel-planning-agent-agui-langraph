/**
 * /api/itinerary routes.
 *
 *  - POST   /:threadId/entries                                   pin a point-of-interest onto a day
 *  - DELETE /:threadId/days/:dayId/entries/:entryId              remove a pinned entry
 *  - PUT    /:threadId/tripEssentials/:essentialId               upsert a trip-essentials row (add / toggle owned)
 *  - DELETE /:threadId/tripEssentials/:essentialId               remove a trip-essentials row
 *
 * The four mutation routes are thin adapters over the R-M-W helpers in
 * ai/itinerary-workflow/state.ts; they exist so the React UI can mutate
 * checkpointed state directly (card "Add"/"Remove" buttons, checkbox
 * clicks) without round-tripping through an agent turn. Both write paths
 * — REST and agent tool — share the same helpers + graph singleton so the
 * checkpointer is the single source of truth.
 *
 * The CopilotKit runtime endpoint (chat / streaming / state-deltas /
 * interrupt-HITL) is mounted at the app root in index.ts — Hono's basePath
 * router needs the full URL preserved, which Express strips when mounting a
 * sub-router. The compiled LangGraph is registered as `itineraryPlanner`.
 */

import { Router } from 'express';
import {
    pinPointOfInterest,
    unpinPointOfInterest,
    markTripEssential,
    unmarkTripEssential,
    type PinPointOfInterestInput,
    type TimeOfDay,
} from '../../ai/itinerary-workflow/state.ts';
import { AppError, ErrorType, HttpStatusCode } from '../../../lib/errors.ts';

export const itineraryRoutes = Router();

// ─── R-M-W mutation routes ─────────────────────────────────────────────────

const TIME_OF_DAY_VALUES: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'meal'];

function requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new AppError(
            'ValidationError',
            `${field} is required`,
            ErrorType.INVALID_INPUT,
        );
    }
    return value;
}

function requireTimeOfDay(value: unknown): TimeOfDay {
    if (typeof value !== 'string' || !TIME_OF_DAY_VALUES.includes(value as TimeOfDay)) {
        throw new AppError(
            'ValidationError',
            `timeOfDay must be one of ${TIME_OF_DAY_VALUES.join(', ')}`,
            ErrorType.INVALID_INPUT,
        );
    }
    return value as TimeOfDay;
}

itineraryRoutes.post('/:threadId/entries', async (req, res, next) => {
    try {
        const { threadId } = req.params;
        const body = (req.body ?? {}) as Partial<PinPointOfInterestInput>;
        const input: PinPointOfInterestInput = {
            dayId: requireString(body.dayId, 'dayId'),
            timeOfDay: requireTimeOfDay(body.timeOfDay),
            pointOfInterestId: requireString(body.pointOfInterestId, 'pointOfInterestId'),
            pointOfInterestName: requireString(body.pointOfInterestName, 'pointOfInterestName'),
            date: typeof body.date === 'string' ? body.date : undefined,
            note: typeof body.note === 'string' ? body.note : undefined,
        };
        const entry = await pinPointOfInterest(threadId, input);
        res.status(HttpStatusCode.CREATED).json(entry);
    } catch (e) {
        next(e);
    }
});

itineraryRoutes.delete('/:threadId/days/:dayId/entries/:entryId', async (req, res, next) => {
    try {
        const { threadId, dayId, entryId } = req.params;
        await unpinPointOfInterest(threadId, dayId, entryId);
        res.status(HttpStatusCode.NO_CONTENT).end();
    } catch (e) {
        next(e);
    }
});

itineraryRoutes.put('/:threadId/tripEssentials/:essentialId', async (req, res, next) => {
    try {
        const { threadId, essentialId } = req.params;
        const body = (req.body ?? {}) as { label?: unknown; owned?: unknown; productId?: unknown };
        const essential = await markTripEssential(threadId, {
            id: essentialId,
            label: requireString(body.label, 'label'),
            owned: Boolean(body.owned),
            productId: typeof body.productId === 'string' ? body.productId : undefined,
        });
        res.json(essential);
    } catch (e) {
        next(e);
    }
});

itineraryRoutes.delete('/:threadId/tripEssentials/:essentialId', async (req, res, next) => {
    try {
        const { threadId, essentialId } = req.params;
        await unmarkTripEssential(threadId, essentialId);
        res.status(HttpStatusCode.NO_CONTENT).end();
    } catch (e) {
        next(e);
    }
});
