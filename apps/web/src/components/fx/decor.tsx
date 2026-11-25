import { Parallax } from './parallax';

/** Purely decorative SVG building blocks shared by the hero, the page banners and the CTA band. */

/** Two mountain ridges (Timor's spine) that drift at different speeds, ending in a white wave into the page. */
export function Ridges({ className = '' }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-x-0 bottom-0 ${className}`} aria-hidden="true">
      <Parallax speed={-0.06} className="absolute inset-x-0 bottom-0 h-48 sm:h-64" innerClassName="h-full">
        <svg viewBox="0 0 1440 260" preserveAspectRatio="none" className="h-full w-full" focusable="false">
          <path fill="#083d47" fillOpacity="0.85" d="M0 150 L120 96 L230 140 L360 62 L470 128 L610 48 L760 138 L880 84 L1010 146 L1150 70 L1290 130 L1440 90 V260 H0Z" />
        </svg>
      </Parallax>
      <Parallax speed={-0.14} className="absolute inset-x-0 bottom-0 h-32 sm:h-44" innerClassName="h-full">
        <svg viewBox="0 0 1440 180" preserveAspectRatio="none" className="h-full w-full" focusable="false">
          <path fill="#0b4f5c" fillOpacity="0.9" d="M0 110 L150 60 L300 112 L430 70 L580 120 L720 52 L860 118 L1010 76 L1160 124 L1300 82 L1440 118 V180 H0Z" />
        </svg>
      </Parallax>
      <svg viewBox="0 0 1440 70" preserveAspectRatio="none" className="relative block h-10 w-full sm:h-16" focusable="false" aria-hidden="true">
        <path fill="#ffffff" d="M0 38 C180 78 360 6 600 30 C840 54 1060 74 1240 34 C1330 14 1390 18 1440 30 V70 H0Z" />
      </svg>
    </div>
  );
}

/** Dotted municipality route network, a nod to the parcel corridors. */
export function RouteMap({ className = '' }: { className?: string }) {
  const nodes: Array<[number, number]> = [
    [120, 420],
    [330, 300],
    [520, 360],
    [700, 220],
    [900, 290],
    [1080, 170],
  ];
  return (
    <svg viewBox="0 0 1200 520" preserveAspectRatio="xMidYMid slice" className={className} fill="none" aria-hidden="true" focusable="false">
      <path
        className="route-flow"
        d="M120 420 C220 400 250 290 330 300 S450 380 520 360 S640 230 700 220 S830 300 900 290 S1010 190 1080 170"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path d="M330 300 C380 220 420 180 480 150 M900 290 C940 360 980 400 1040 420" stroke="rgba(255,255,255,0.14)" strokeWidth="2" strokeDasharray="2 10" strokeLinecap="round" />
      {nodes.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="16" fill="rgba(255,122,69,0.16)" />
          <circle cx={x} cy={y} r="6" fill={i % 2 ? '#ff7a45' : '#ffffff'} fillOpacity="0.9" />
        </g>
      ))}
    </svg>
  );
}

/** Soft curved bottom edge for the compact banners of the inner pages. */
export function CurveEdge({ className = 'text-white' }: { className?: string }) {
  return (
    <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className={`block h-8 w-full sm:h-12 ${className}`} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M0 34 C240 70 480 4 720 26 C960 48 1200 66 1440 24 V60 H0Z" />
    </svg>
  );
}
