import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
function Base({ children, ...p }: P) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}>
      {children}
    </svg>
  );
}
export const IconDashboard = (p: P) => (
  <Base {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Base>
);
export const IconHub = (p: P) => (
  <Base {...p}>
    <path d="M3 21V9l9-6 9 6v12" />
    <path d="M9 21v-7h6v7M3 21h18" />
  </Base>
);
export const IconPartners = (p: P) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.4 3.2-5 6.5-5s5.9 1.6 6.5 5" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 15.3c1.6.8 2.6 2.3 3 4.7" />
  </Base>
);
export const IconWallet = (p: P) => (
  <Base {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h13v4" />
    <path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Z" />
    <circle cx="16.5" cy="14.5" r="1.2" />
  </Base>
);
export const IconClaims = (p: P) => (
  <Base {...p}>
    <path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6l-8-3Z" />
    <path d="M12 8v5M12 16v.5" />
  </Base>
);
export const IconTariff = (p: P) => (
  <Base {...p}>
    <path d="M3 12V4h8l10 10-8 8L3 12Z" />
    <circle cx="7.5" cy="8.5" r="1.3" />
  </Base>
);
export const IconTemplate = (p: P) => (
  <Base {...p}>
    <path d="M4 5h16v11H9l-5 4V5Z" />
    <path d="M8 9h8M8 12h5" />
  </Base>
);
export const IconAccess = (p: P) => (
  <Base {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M16 7l3 3M14 9l2 2" />
  </Base>
);
export const IconAudit = (p: P) => (
  <Base {...p}>
    <path d="M6 3h9l4 4v14H6V3Z" />
    <path d="M14 3v5h5M9 13h7M9 17h7" />
  </Base>
);
export const IconGlobe = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
  </Base>
);
export const IconLogout = (p: P) => (
  <Base {...p}>
    <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />
  </Base>
);
export const IconMenu = (p: P) => (
  <Base {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Base>
);
export const IconClose = (p: P) => (
  <Base {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Base>
);
export const IconAlert = (p: P) => (
  <Base {...p}>
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 10v4.5M12 17.5v.5" />
  </Base>
);
export const IconDownload = (p: P) => (
  <Base {...p}>
    <path d="M12 4v11M8 11l4 4 4-4M4 20h16" />
  </Base>
);
export const IconRefresh = (p: P) => (
  <Base {...p}>
    <path d="M20 11a8 8 0 0 0-14.5-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.5 3.5L20 15M20 20v-5h-5" />
  </Base>
);
export const IconTruck = (p: P) => (
  <Base {...p}>
    <path d="M2 6h11v10H2zM13 9h4l4 4v3h-8" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </Base>
);
