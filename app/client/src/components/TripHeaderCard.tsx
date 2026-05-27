import type { City } from '../types';

interface Props {
    destination: City | null;
    dates: { start: string; end: string } | null;
    interests: string[];
}

const CITY_LABEL: Record<string, string> = {
    bangalore: 'Bangalore',
    mumbai: 'Mumbai',
    delhi: 'Delhi',
    goa: 'Goa',
    jaipur: 'Jaipur',
    kochi: 'Kochi',
    manali: 'Manali',
    hyderabad: 'Hyderabad',
    tokyo: 'Tokyo',
    kyoto: 'Kyoto',
    seoul: 'Seoul',
    singapore: 'Singapore',
    bangkok: 'Bangkok',
    hanoi: 'Hanoi',
    ubud: 'Ubud',
    barcelona: 'Barcelona',
    lisbon: 'Lisbon',
    paris: 'Paris',
    london: 'London',
    berlin: 'Berlin',
    amsterdam: 'Amsterdam',
    rome: 'Rome',
    prague: 'Prague',
    istanbul: 'Istanbul',
    dubai: 'Dubai',
    'cape-town': 'Cape Town',
    marrakech: 'Marrakech',
    'new-york': 'New York',
    'san-francisco': 'San Francisco',
    vancouver: 'Vancouver',
    'mexico-city': 'Mexico City',
    'buenos-aires': 'Buenos Aires',
    sydney: 'Sydney',
};

const INTEREST_LABEL: Record<string, string> = {
    food: 'Food',
    landmarks: 'Landmarks',
    offbeat: 'Offbeat',
    slow: 'Slow',
    outdoors: 'Outdoors',
    nightlife: 'Nightlife',
    culture: 'Culture',
};

function formatDateRange(dates: { start: string; end: string }): string {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const start = new Date(dates.start).toLocaleDateString(undefined, opts);
    const end = new Date(dates.end).toLocaleDateString(undefined, opts);
    return `${start} → ${end}`;
}

/**
 * A row of pills at the top of the canvas showing what the agent currently
 * knows about the trip — destination, dates, interests. Populated from the
 * server's streaming snapshots (contextRetriever's hydration on every turn).
 *
 * Renders nothing when none of the three fields are known.
 */
export function TripHeaderCard({ destination, dates, interests }: Props) {
    if (!destination && !dates && interests.length === 0) return null;
    return (
        <div className="trip-header">
            {destination && (
                <span className="trip-header-pill">
                    <span className="trip-header-pill-icon">📍</span>
                    {CITY_LABEL[destination] ?? destination}
                </span>
            )}
            {dates && (
                <span className="trip-header-pill">
                    <span className="trip-header-pill-icon">📅</span>
                    {formatDateRange(dates)}
                </span>
            )}
            {interests.length > 0 && (
                <span className="trip-header-pill">
                    <span className="trip-header-pill-icon">🎯</span>
                    {interests.map((tag) => INTEREST_LABEL[tag] ?? tag).join(', ')}
                </span>
            )}
        </div>
    );
}
