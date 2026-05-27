import { useEffect, useState } from 'react';
import type { PastTrip, UserPreferences } from '../types';

interface Props {
    userId: string;
    open: boolean;
    onClose: () => void;
    onLoadTrip: (trip: PastTrip) => void;
    onReset: () => void | Promise<void>;
}

interface Profile {
    userId: string;
    preferences: UserPreferences | null;
    pastTrips: PastTrip[];
}

export function MemoryDrawer({ userId, open, onClose, onLoadTrip, onReset }: Props) {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        fetch(`/api/user/profile?userId=${userId}`)
            .then((response) => response.json())
            .then((data: Profile) => setProfile(data))
            .finally(() => setLoading(false));
    }, [open, userId]);

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <>
            <div className="drawer-backdrop" onClick={onClose} />
            <div className="drawer" onClick={(event) => event.stopPropagation()}>
                <div className="drawer-header">
                    <strong>Memory & history</strong>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
                        ({userId})
                    </span>
                    <button className="drawer-close" onClick={onClose} aria-label="Close drawer">
                        ×
                    </button>
                </div>
                <div className="drawer-body">
                    {loading && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}

                    <div className="drawer-section">
                        <h3>Preferences</h3>
                        {profile?.preferences ? (
                            <>
                                {profile.preferences.budget && (
                                    <div className="drawer-row">
                                        <span className="drawer-row-label">Budget</span>
                                        <span
                                            className="drawer-row-value"
                                            style={{ textTransform: 'capitalize' }}
                                        >
                                            {profile.preferences.budget}
                                        </span>
                                    </div>
                                )}
                                {profile.preferences.groupSize && (
                                    <div className="drawer-row">
                                        <span className="drawer-row-label">Group size</span>
                                        <span
                                            className="drawer-row-value"
                                            style={{ textTransform: 'capitalize' }}
                                        >
                                            {profile.preferences.groupSize}
                                        </span>
                                    </div>
                                )}
                                {profile.preferences.recurringInterests &&
                                    profile.preferences.recurringInterests.length > 0 && (
                                        <div className="drawer-row">
                                            <span className="drawer-row-label">
                                                Recurring interests
                                            </span>
                                            <span className="drawer-row-value">
                                                {profile.preferences.recurringInterests.join(', ')}
                                            </span>
                                        </div>
                                    )}
                            </>
                        ) : (
                            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                                No preferences yet. They'll appear here after you've planned a few
                                trips.
                            </div>
                        )}
                    </div>

                    <div className="drawer-section">
                        <h3>Current planning session</h3>
                        <button
                            type="button"
                            className="drawer-reset"
                            onClick={() => {
                                void onReset();
                                onClose();
                            }}
                        >
                            Reset working trip
                        </button>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
                            Clears the in-progress trip + conversation history. Past trips below
                            stay.
                        </div>
                    </div>

                    <div className="drawer-section">
                        <h3>Past trips</h3>
                        {profile && profile.pastTrips.length > 0 ? (
                            profile.pastTrips.map((trip) => {
                                const placeNames = trip.pickedPois.map((poi) => poi.name).join(', ');
                                return (
                                    <div
                                        key={trip.tripId}
                                        className="past-trip"
                                        onClick={() => onLoadTrip(trip)}
                                    >
                                        <div className="past-trip-city">{trip.destination}</div>
                                        <div className="past-trip-meta">
                                            {trip.dates
                                                ? `${trip.dates.start} → ${trip.dates.end}`
                                                : 'no dates'}{' '}
                                            · {trip.pickedPois.length} places
                                        </div>
                                        {placeNames && (
                                            <div
                                                className="past-trip-meta"
                                                style={{ marginTop: 4 }}
                                            >
                                                {placeNames}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                                No saved trips yet. Click "Save this trip" once you've composed an
                                itinerary.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
