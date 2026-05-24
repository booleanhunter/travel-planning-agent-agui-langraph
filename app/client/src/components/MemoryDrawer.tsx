import { useEffect, useState } from 'react';
import type { PastTrip, UserPreferences } from '../types';

interface Props {
    open: boolean;
    onClose: () => void;
    onLoadTrip: (trip: PastTrip) => void;
}

interface Profile {
    userId: string;
    preferences: UserPreferences | null;
    pastTrips: PastTrip[];
}

const USER_ID = 'ashwin';

export function MemoryDrawer({ open, onClose, onLoadTrip }: Props) {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        fetch(`/api/user/profile?userId=${USER_ID}`)
            .then((r) => r.json())
            .then((data: Profile) => setProfile(data))
            .finally(() => setLoading(false));
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <>
            <div className="drawer-backdrop" onClick={onClose} />
            <div className="drawer" onClick={(e) => e.stopPropagation()}>
                <div className="drawer-header">
                    <strong>Memory & history</strong>
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
                        <h3>Past trips</h3>
                        {profile && profile.pastTrips.length > 0 ? (
                            profile.pastTrips.map((trip) => {
                                const placeNames = trip.pickedPois.map((p) => p.name).join(', ');
                                return (
                                    <div
                                        key={trip.tripId}
                                        className="past-trip"
                                        onClick={() => onLoadTrip(trip)}
                                    >
                                        <div className="past-trip-city">{trip.city}</div>
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
