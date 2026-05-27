import { useMemo } from 'react';
import type { POI } from '../types';

interface Props {
    pois: POI[];
    /** Drives the checkbox state — reflects the user's *staged* picks. */
    pickedIds: string[];
    /** Drives the picked-first sort — reflects the user's *committed* picks.
     *  Sort only shifts when the user clicks "Update plan" (committing changes),
     *  so the grid stays stable during selection. */
    sortByIds: string[];
    onToggle: (poi: POI) => void;
}

export function PointOfInterestGrid({ pois, pickedIds, sortByIds, onToggle }: Props) {
    const pickedSet = new Set(pickedIds);

    const orderedPois = useMemo(() => {
        const order = new Map(sortByIds.map((id, index) => [id, index]));
        return [...pois].sort((poiA, poiB) => {
            const aIndex = order.get(poiA.id);
            const bIndex = order.get(poiB.id);
            if (aIndex !== undefined && bIndex === undefined) return -1;
            if (aIndex === undefined && bIndex !== undefined) return 1;
            if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
            return 0;
        });
    }, [pois, sortByIds]);

    return (
        <div className="poi-grid">
            {orderedPois.map((poi) => {
                const picked = pickedSet.has(poi.id);
                return (
                    <div
                        key={poi.id}
                        className={`poi-card ${picked ? 'picked' : ''}`}
                        onClick={() => onToggle(poi)}
                    >
                        {poi.photoUrl && (
                            <div
                                className="poi-photo"
                                style={{ backgroundImage: `url(${poi.photoUrl})` }}
                            />
                        )}
                        <div className="poi-info">
                            <h4 className="poi-name">{poi.name}</h4>
                            <div className="poi-meta">
                                <span className="poi-rating">★ {poi.rating.toFixed(1)}</span>
                                <span className="poi-category">{poi.category}</span>
                            </div>
                            <div className="poi-desc">
                                {poi.description.slice(0, 100)}
                                {poi.description.length > 100 ? '…' : ''}
                            </div>
                        </div>
                        <div className="poi-check">
                            <input type="checkbox" checked={picked} readOnly />
                            <span>{picked ? 'Added to itinerary' : 'Add to itinerary'}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
