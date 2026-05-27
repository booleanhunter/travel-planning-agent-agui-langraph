/**
 * Google Calendar — create an all-day event for a saved trip.
 *
 * One method: createEventForTrip. Uses the Calendar API directly via
 * fetch (no `googleapis` SDK dep — the call is one POST).
 */

import { CITY_DISPLAY_NAMES } from '#modules/places/types.js';
import type { PastTrip } from '#modules/trips/types.js';

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

interface CreatedEvent {
    htmlLink: string;
    id: string;
}

/**
 * Build the event description text from a trip — prose + bulleted picks.
 */
function buildDescription(trip: PastTrip): string {
    const lines: string[] = [];
    if (trip.interests.length) lines.push(`Focus: ${trip.interests.join(', ')}.`);
    if (trip.pickedPois.length) {
        lines.push('');
        lines.push('Places to visit:');
        for (const poi of trip.pickedPois) {
            lines.push(`• ${poi.name}`);
        }
    }
    return lines.join('\n');
}

/**
 * Add a day to a YYYY-MM-DD date — Google all-day events use an EXCLUSIVE
 * end.date, so a 3-day trip from May 10 → May 12 needs end.date = May 13.
 */
function addOneDay(isoDate: string): string {
    const d = new Date(isoDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

export async function createEventForTrip(
    accessToken: string,
    trip: PastTrip,
): Promise<CreatedEvent> {
    if (!trip.dates) {
        throw new Error('Cannot create calendar event — trip has no dates.');
    }
    const displayCity = CITY_DISPLAY_NAMES[trip.city] ?? trip.city;
    const body = {
        summary: `Trip to ${displayCity}`,
        description: buildDescription(trip),
        start: { date: trip.dates.start },
        end: { date: addOneDay(trip.dates.end) }, // Google's end.date is exclusive
        transparency: 'transparent', // shown as "free" — it's a personal trip placeholder
    };

    const res = await fetch(EVENTS_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Google Calendar create failed (${res.status}): ${text}`);
    }
    const created = (await res.json()) as { id: string; htmlLink: string };
    return { id: created.id, htmlLink: created.htmlLink };
}
