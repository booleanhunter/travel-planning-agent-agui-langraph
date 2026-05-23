import type { POI } from "../types";

interface Props {
  picked: POI[];
  onRemove: (id: string) => void;
}

export function ComposedItineraryPane({ picked, onRemove }: Props) {
  return (
    <div className="composed">
      <div className="section-title" style={{ marginTop: 0 }}>Your itinerary</div>
      {picked.length === 0 ? (
        <div className="composed-empty">No places picked yet. Click POI cards above to add them.</div>
      ) : (
        <div className="composed-list">
          {picked.map((p, i) => (
            <div key={p.id} className="composed-row">
              <span className="composed-row-num">{i + 1}</span>
              <span className="composed-row-name">{p.name}</span>
              <button
                className="composed-row-x"
                aria-label={`Remove ${p.name}`}
                onClick={() => onRemove(p.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
