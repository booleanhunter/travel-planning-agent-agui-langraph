import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  searchUserPreferences,
  listPastTrips,
  getConversation,
  saveTrip,
} from "../memory/ams-client.js";
import { searchPois } from "../data/pois-redis.js";
import type { PastTrip } from "../types.js";

const router = Router();

/**
 * GET /api/user/profile?userId=ashwin
 * Returns the user's recurring preferences (semantic) + past trips (episodic).
 */
router.get("/profile", async (req, res) => {
  const userId = (req.query.userId as string) ?? "ashwin";
  try {
    const [preferences, pastTrips] = await Promise.all([
      searchUserPreferences(userId),
      listPastTrips(userId),
    ]);
    res.json({ userId, preferences: preferences ?? null, pastTrips });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/user/load-trip { tripId }
 * Returns the past trip's metadata + conversation transcript for client rehydrate.
 */
router.post("/load-trip", async (req, res) => {
  const { userId = "ashwin", tripId } = req.body as { userId?: string; tripId: string };
  if (!tripId) {
    res.status(400).json({ error: "tripId is required" });
    return;
  }
  try {
    const trips = await listPastTrips(userId);
    const trip = trips.find((t) => t.tripId === tripId);
    if (!trip) {
      res.status(404).json({ error: "trip not found" });
      return;
    }

    const conv = await getConversation(trip.sessionId);
    // Rehydrate POI details so the client can re-render the picked cards
    const pois = await searchPois({
      city: trip.city,
      interestQuery: "varied places",
      k: 50,
    });
    const pickedPois = pois.filter((p) => trip.pickedPoiIds.includes(p.id));

    res.json({
      trip,
      conversationHistory: conv?.messages ?? [],
      pickedPois,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/user/save-trip { userId, sessionId, city, dates, pickedPoiIds, summary }
 * Writes the trip as an episodic AMS record.
 */
router.post("/save-trip", async (req, res) => {
  const { userId = "ashwin", sessionId, city, dates, pickedPoiIds, summary } = req.body as {
    userId?: string;
    sessionId: string;
    city: PastTrip["city"];
    dates?: PastTrip["dates"];
    pickedPoiIds: string[];
    summary: string;
  };
  if (!sessionId || !city || !pickedPoiIds) {
    res.status(400).json({ error: "sessionId, city, pickedPoiIds are required" });
    return;
  }
  const trip: PastTrip = {
    tripId: `trip-${randomUUID()}`,
    sessionId,
    city,
    dates,
    summary,
    pickedPoiIds,
  };
  try {
    await saveTrip(userId, trip);
    res.json({ trip });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
