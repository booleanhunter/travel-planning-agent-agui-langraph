/** /api/user routes — used by the left-side memory drawer in the UI. */

import { Router } from 'express';
import { getProfile, loadTripSession } from '../domain/user-service.ts';
import { AppError, ErrorType } from '../../../lib/errors.ts';

export const userRoutes = Router();

userRoutes.get('/profile', async (req, res, next) => {
    try {
        const userId = String(req.query.userId ?? 'demo-user');
        const profile = await getProfile(userId);
        res.json(profile);
    } catch (e) {
        next(e);
    }
});

userRoutes.post('/load-trip', async (req, res, next) => {
    try {
        const { tripId } = req.body as { tripId?: string };
        if (!tripId) throw new AppError('ValidationError', 'tripId is required', ErrorType.INVALID_INPUT);
        const session = await loadTripSession(tripId);
        res.json(session);
    } catch (e) {
        next(e);
    }
});
