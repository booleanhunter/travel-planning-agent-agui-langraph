import { Router } from 'express';
import { getPreferences, getConversation } from '#modules/user/domain/user-service.js';
import {
    archiveTripToMemory,
    getTrip,
    listPastTrips,
    markComplete,
    resetWorkingTrip,
} from '../domain/trips-service.js';

const router = Router();

/**
 * GET /api/user/profile?userId=ashwin
 * Returns the user's recurring preferences (semantic AMS) + past trips (Redis).
 */
router.get('/profile', async (req, res) => {
    const userId = (req.query.userId as string) ?? 'ashwin';
    try {
        const [preferences, pastTrips] = await Promise.all([
            getPreferences(userId),
            listPastTrips(userId),
        ]);
        res.json({ userId, preferences: preferences ?? null, pastTrips });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

/**
 * POST /api/user/load-trip { tripId }
 * Returns the trip metadata + conversation transcript for client rehydrate.
 */
router.post('/load-trip', async (req, res) => {
    const { userId = 'ashwin', tripId } = req.body as { userId?: string; tripId: string };
    if (!tripId) {
        res.status(400).json({ error: 'tripId is required' });
        return;
    }
    try {
        const trip = await getTrip(userId, tripId);
        if (!trip) {
            res.status(404).json({ error: 'trip not found' });
            return;
        }
        const conversationHistory = await getConversation(trip.tripId);
        res.json({ trip, conversationHistory });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

/**
 * POST /api/user/save-trip { userId?, tripId }
 * Flips the trip-store record to "completed" AND writes a trip-summary
 * memory to AMS long-term so future semantic searches can recall it.
 */
router.post('/save-trip', async (req, res) => {
    const { userId = 'ashwin', tripId } = req.body as { userId?: string; tripId: string };
    if (!tripId) {
        res.status(400).json({ error: 'tripId is required' });
        return;
    }
    try {
        const trip = await markComplete(userId, tripId);
        if (!trip) {
            res.status(404).json({ error: 'trip not found — make at least one pick first' });
            return;
        }
        // Archive to AMS long-term — mirrors what the seed produces for past trips.
        await archiveTripToMemory(userId, trip).catch((err) =>
            console.error(
                '[save-trip] archiveTripToMemory failed:',
                (err as Error).message,
            ),
        );
        res.json({ trip });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

/**
 * POST /api/user/reset { userId?, tripId }
 * Clears the working planning slot for this user/trip: deletes the
 * trip-store HASH and wipes AMS working memory. Past trips remain.
 */
router.post('/reset', async (req, res) => {
    const { userId = 'ashwin', tripId } = req.body as {
        userId?: string;
        tripId: string;
    };
    if (!tripId) {
        res.status(400).json({ error: 'tripId is required' });
        return;
    }
    try {
        await resetWorkingTrip(userId, tripId);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
