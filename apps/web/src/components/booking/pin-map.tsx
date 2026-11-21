'use client';

import 'leaflet/dist/leaflet.css';
import type * as Leaflet from 'leaflet';
import { useEffect, useRef } from 'react';
import { MAP } from '@/lib/config';

export interface Pin {
  lat: number;
  lng: number;
}

const PIN_HTML = `<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true"><path d="M16 41S3 27.5 3 16a13 13 0 0 1 26 0c0 11.5-13 25-13 25Z" fill="#C2410C" stroke="#fff" stroke-width="2.5"/><circle cx="16" cy="16" r="5.5" fill="#fff"/></svg>`;

/**
 * Click / tap to drop the pick-up pin; drag it to fine-tune. Vanilla Leaflet, loaded only on the booking page
 * and only in the browser. The pin is optional — the address field is the primary way to say where.
 */
export function PinMap({ value, onChange, describedBy }: { value: Pin | null; onChange: (pin: Pin) => void; describedBy?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const libRef = useRef<typeof Leaflet | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  const sync = () => {
    const L = libRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const v = valueRef.current;
    if (!v) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const marker = L.marker([v.lat, v.lng], { icon: L.divIcon({ html: PIN_HTML, className: '', iconSize: [32, 42], iconAnchor: [16, 41] }), draggable: true, keyboard: false, autoPan: true }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        onChangeRef.current({ lat: p.lat, lng: p.lng });
      });
      markerRef.current = marker;
    } else {
      const cur = markerRef.current.getLatLng();
      if (Math.abs(cur.lat - v.lat) > 1e-9 || Math.abs(cur.lng - v.lng) > 1e-9) markerRef.current.setLatLng([v.lat, v.lng]);
    }
    // Bring far-away positions (e.g. from "use my location") into view; leave near ones alone so a click never jumps the map.
    if (!map.getBounds().pad(-0.15).contains([v.lat, v.lng])) map.setView([v.lat, v.lng], Math.max(map.getZoom(), 16), { animate: true });
  };

  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((mod) => {
      const L = (mod as unknown as { default?: typeof Leaflet }).default ?? mod;
      if (cancelled || !host.current) return;
      libRef.current = L;
      const b = MAP.bounds;
      const map = L.map(host.current, {
        center: [MAP.center.lat, MAP.center.lng],
        zoom: MAP.zoom,
        minZoom: 7,
        maxBounds: [[b.south, b.west], [b.north, b.east]],
        maxBoundsViscosity: 0.9,
      });
      L.tileLayer(MAP.tileUrl, { attribution: MAP.attribution, maxZoom: 19 }).addTo(map);
      map.on('click', (e: Leaflet.LeafletMouseEvent) => onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
      mapRef.current = map;
      sync();
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; `sync` reads refs
  }, []);

  useEffect(sync, [value?.lat, value?.lng, value === null]);

  return <div ref={host} className="isolate z-0 h-80 w-full overflow-hidden rounded-xl border border-slate-300 sm:h-96" role="application" aria-roledescription="map" aria-describedby={describedBy} />;
}
