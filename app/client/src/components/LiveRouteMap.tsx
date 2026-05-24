import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import { Icon } from 'leaflet';
import { useEffect } from 'react';
import type { POI } from '../types';

const markerIcon = new Icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
});

interface Props {
    picked: POI[];
}

function FitToBounds({ picked }: Props) {
    const map = useMap();
    useEffect(() => {
        if (!picked.length) return;
        const lats = picked.map((p) => p.lat);
        const lngs = picked.map((p) => p.lng);
        const bounds: [[number, number], [number, number]] = [
            [Math.min(...lats), Math.min(...lngs)],
            [Math.max(...lats), Math.max(...lngs)],
        ];
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }, [picked, map]);
    return null;
}

export function LiveRouteMap({ picked }: Props) {
    if (picked.length === 0) return null;

    const center: [number, number] = [picked[0].lat, picked[0].lng];
    const polyline = picked.map((p) => [p.lat, p.lng] as [number, number]);

    return (
        <div className="route-map">
            <MapContainer center={center} zoom={13} scrollWheelZoom={false}>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {picked.map((p, i) => (
                    <Marker key={p.id} position={[p.lat, p.lng]} icon={markerIcon}>
                        <Popup>
                            <strong>
                                {i + 1}. {p.name}
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
