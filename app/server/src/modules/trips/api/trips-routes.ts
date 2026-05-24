import { Router } from 'express';
import { getPreferences, getConversation } from '../../user/domain/user-service.js';
import { getTrip, listPastTrips, markComplete } from '../domain/trips-service.js';

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
        const conv = await getConversation(trip.sessionId);
        res.json({
            trip,
            conversationHistory: conv?.messages ?? [],
        });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

/**
 * POST /api/user/save-trip { userId?, tripId }
 * Marks the trip as completed (flips status, sets completedAt, adds to past-trips set).
 * All trip metadata (city, dates, picked POIs) is already in Redis from prior writes.
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
        res.json({ trip });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
