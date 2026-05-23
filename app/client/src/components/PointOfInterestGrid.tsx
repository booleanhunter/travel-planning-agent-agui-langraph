import type { POI } from "../types";

interface Props {
  pois: POI[];
  pickedIds: string[];
  onToggle: (poi: POI) => void;
}

export function PointOfInterestGrid({ pois, pickedIds, onToggle }: Props) {
  const pickedSet = new Set(pickedIds);

  return (
    <div className="poi-grid">
      {pois.map((p) => {
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
