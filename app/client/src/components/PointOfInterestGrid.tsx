import { useMemo } from "react";
import type { POI } from "../types";

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
    const order = new Map(sortByIds.map((id, i) => [id, i]));
    return [...pois].sort((a, b) => {
      const ai = order.get(a.id);
      const bi = order.get(b.id);
      if (ai !== undefined && bi === undefined) return -1;
      if (ai === undefined && bi !== undefined) return 1;
      if (ai !== undefined && bi !== undefined) return ai - bi;
      return 0;
    });
  }, [pois, sortByIds]);

  return (
    <div className="poi-grid">
      {orderedPois.map((p) => {
        const picked = pickedSet.has(p.id);
        return (
          <div
            key={p.id}
            className={`poi-card ${picked ? "picked" : ""}`}
            onClick={() => onToggle(p)}
          >
            {p.photoUrl && (
              <div className="poi-photo" style={{ backgroundImage: `url(${p.photoUrl})` }} />
            )}
            <div className="poi-info">
              <h4 className="poi-name">{p.name}</h4>
              <div className="poi-meta">
                <span className="poi-rating">★ {p.rating.toFixed(1)}</span>
                <span className="poi-category">{p.category}</span>
              </div>
              <div className="poi-desc">{p.description.slice(0, 100)}{p.description.length > 100 ? "…" : ""}</div>
            </div>
            <div className="poi-check">
              <input type="checkbox" checked={picked} readOnly />
              <span>{picked ? "Added to itinerary" : "Add to itinerary"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
