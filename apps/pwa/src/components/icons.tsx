import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
function Base({ children, ...p }: P) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}>
      {children}
    </svg>
  );
}
export const IconHome = (p: P) => (
  <Base {...p}>
    <path d="M4 11 12 4l8 7v9H4v-9Z" />
    <path d="M10 20v-5h4v5" />
  </Base>
);
export const IconPackage = (p: P) => (
  <Base {...p}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </Base>
);
export const IconInbound = (p: P) => (
  <Base {...p}>
    <path d="M4 14v5h16v-5M12 4v10M8 10l4 4 4-4" />
  </Base>
);
export const IconHandover = (p: P) => (
  <Base {...p}>
    <path d="M5 12.5 9.5 17 19 7" />
    <rect x="3" y="3" width="18" height="18" rx="4" />
  </Base>
);
export const IconUser = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6" />
  </Base>
);
export const IconWallet = (p: P) => (
  <Base {...p}>
    <path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    <path d="M3 7l2-3h12v3M16 14h2" />
  </Base>
);
export const IconList = (p: P) => (
  <Base {...p}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Base>
);
export const IconCamera = (p: P) => (
  <Base {...p}>
    <path d="M4 8h3l1.5-2h7L17 8h3v11H4V8Z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Base>
);
export const IconScan = (p: P) => (
  <Base {...p}>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
  </Base>
);
export const IconPrinter = (p: P) => (
  <Base {...p}>
    <path d="M7 9V3h10v6M7 17H4v-7h16v7h-3" />
    <rect x="7" y="14" width="10" height="7" rx="1" />
  </Base>
);
export const IconCheck = (p: P) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Base>
);
export const IconAlert = (p: P) => (
  <Base {...p}>
    <path d="M12 3.5 2.5 20h19L12 3.5Z" />
    <path d="M12 10v4.5M12 17.5h.01" />
  </Base>
);
export const IconPhone = (p: P) => (
  <Base {...p}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  </Base>
);
export const IconChat = (p: P) => (
  <Base {...p}>
    <path d="M4 5h16v11H9l-5 4V5Z" />
  </Base>
);
export const IconPin = (p: P) => (
  <Base {...p}>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Base>
);
export const IconTruck = (p: P) => (
  <Base {...p}>
    <path d="M2 6h11v10H2zM13 9h4l4 4v3h-8" />
    <circle cx="7" cy="17.5" r="2" />
    <circle cx="17" cy="17.5" r="2" />
  </Base>
);
export const IconBus = (p: P) => (
  <Base {...p}>
    <rect x="4" y="3.5" width="16" height="13" rx="2.5" />
    <path d="M4 11h16M8 16.5V19M16 16.5V19" />
  </Base>
);
export const IconShip = (p: P) => (
  <Base {...p}>
    <path d="M3 17c2 0 2 1.5 4.5 1.5S10 17 12 17s2.5 1.5 4.5 1.5S19 17 21 17M5 14l1.5-5h11L19 14M12 9V4h3" />
  </Base>
);
export const IconWifiOff = (p: P) => (
  <Base {...p}>
    <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.4M19 12.5a10 10 0 0 0-4.5-2.7M2 9a15 15 0 0 1 5-3M22 9a15 15 0 0 0-8-3.9M12 20h.01" />
  </Base>
);
export const IconChevron = (p: P) => (
  <Base {...p}>
    <path d="m9 6 6 6-6 6" />
  </Base>
);
export const IconClose = (p: P) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);
