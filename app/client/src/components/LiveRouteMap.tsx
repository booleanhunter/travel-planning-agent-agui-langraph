import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import { DivIcon } from 'leaflet';
import { useEffect, useMemo } from 'react';
import type { POI } from '../types';

/**
 * Build a circular badge marker. Used for start (S), end (E), and
 * intermediate numbered stops along the route.
 */
function makeBadgeIcon(label: string, color: string): DivIcon {
    return new DivIcon({
        className: 'route-marker',
        html: `<div class="route-marker-badge" style="background:${color}">${label}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
    });
}

interface Props {
    picked: POI[];
}

function FitToBounds({ picked }: Props) {
    const map = useMap();
    useEffect(() => {
        if (!picked.length) return;
        const lats = picked.map((poi) => poi.lat);
        const lngs = picked.map((poi) => poi.lng);
        const bounds: [[number, number], [number, number]] = [
            [Math.min(...lats), Math.min(...lngs)],
            [Math.max(...lats), Math.max(...lngs)],
        ];
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }, [picked, map]);
    return null;
}

export function LiveRouteMap({ picked }: Props) {
    // Memoize icons per turn so we're not constructing fresh DivIcons on
    // every render — Leaflet keys markers by identity for redraws.
    const startIcon = useMemo(() => makeBadgeIcon('S', '#1c866b'), []);
    const endIcon = useMemo(() => makeBadgeIcon('E', '#c4423a'), []);

    if (picked.length === 0) return null;

    const center: [number, number] = [picked[0].lat, picked[0].lng];
    const polyline = picked.map((poi) => [poi.lat, poi.lng] as [number, number]);

    const iconFor = (index: number, total: number): DivIcon => {
        if (index === 0) return startIcon;
        if (index === total - 1 && total > 1) return endIcon;
        return makeBadgeIcon(String(index + 1), '#7280b0');
    };

    return (
        <div className="route-map">
            <MapContainer center={center} zoom={13} scrollWheelZoom={false}>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {picked.map((poi, index) => (
                    <Marker
                        key={poi.id}
                        position={[poi.lat, poi.lng]}
                        icon={iconFor(index, picked.length)}
                    >
                        <Popup>
                            <strong>
                                {index + 1}. {poi.name}
                            </strong>
                        </Popup>
                    </Marker>
                ))}
                {picked.length > 1 && <Polyline positions={polyline} color="#1c866b" />}
                <FitToBounds picked={picked} />
            </MapContainer>
        </div>
    );
}
