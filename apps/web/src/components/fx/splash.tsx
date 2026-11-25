import type { CSSProperties } from 'react';

/**
 * Logo loading animation: the 670Send mark and wordmark draw themselves stroke by stroke over a teal field, then the
 * overlay fades away. Pure CSS and server-rendered, so it can never get stuck waiting for JavaScript; the inline
 * script in the layout skips it after the first view in a browser session. Hidden from assistive technology.
 */
const P = { pathLength: 1, className: 'dash' } as const;
const i = (n: number) => ({ style: { '--i': n } as CSSProperties });

export function Splash() {
  // Same paths as brand/logo-reversed.svg (icon tile left out); pathLength=1 lets one dash animation draw all of them.
  return (
    <div className="splash" aria-hidden="true" data-testid="splash">
      <div className="splash-inner">
        <svg className="splash-logo" viewBox="14 8 456 108" fill="none" strokeLinecap="round" strokeLinejoin="round" focusable="false">
          <g strokeWidth="9" transform="translate(0 2)">
            <rect {...P} {...i(0)} x="20" y="58" width="80" height="42" rx="11" stroke="#F8FAFC" />
            <path {...P} {...i(1)} d="M60 58 V76" stroke="#F8FAFC" />
            <g className="arrow-down">
              <path {...P} {...i(2)} d="M44 16 V44 M34 34 L44 44 L54 34" stroke="#FF7A45" />
            </g>
            <g className="arrow-up">
              <path {...P} {...i(3)} d="M76 46 V18 M66 28 L76 18 L86 28" stroke="#FF7A45" />
            </g>
          </g>
          <g transform="translate(155 28)" strokeWidth="10">
            <g stroke="#F8FAFC">
              <path {...P} {...i(4)} d="M27.16 14.21 A14 14 0 0 0 0 19 V45" />
              <circle {...P} {...i(5)} cx="14" cy="45" r="14" />
              <path {...P} {...i(6)} d="M46 5 H74 L55 59" />
              <rect {...P} {...i(7)} x="91" y="5" width="28" height="54" rx="14" />
            </g>
            <g stroke="#FF7A45">
              <path {...P} {...i(8)} transform="translate(145 0)" d="M26.6 13.9 A13.5 13.5 0 1 0 14 32 A13.5 13.5 0 1 1 1.4 51.1" />
              <path {...P} {...i(9)} transform="translate(194.5 0)" d="M0 43 H32 A16 16 0 1 0 27.3 54.3" />
              <path {...P} {...i(10)} transform="translate(248.5 0)" d="M0 27 V59 M0 41 A14 14 0 0 1 28 41 V59" />
              <g transform="translate(298.5 0)">
                <rect {...P} {...i(11)} x="0" y="27" width="32" height="32" rx="16" />
                <path {...P} {...i(12)} d="M32 5 V59" />
              </g>
            </g>
          </g>
        </svg>
        <div className="splash-bar">
          <span />
        </div>
      </div>
    </div>
  );
}
