'use client';

import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';

function MapPlaceholder() {
  const t = useTranslations('web.a11y');
  return (
    <div className="flex h-80 w-full items-center justify-center rounded-xl border border-slate-300 bg-slate-100 text-slate-600 sm:h-96" role="status">
      {t('mapLoading')}
    </div>
  );
}

/** Leaflet touches `window`, so the map is client-only and split into its own chunk (the other pages never load it). */
export const PinMap = dynamic(() => import('./pin-map').then((m) => m.PinMap), { ssr: false, loading: () => <MapPlaceholder /> });
