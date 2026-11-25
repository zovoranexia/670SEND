'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { prefersReducedMotion, subscribeToScroll } from './scroll-fx';

/** Sets `--p` (0 → 1) on its box as it scrolls through the viewport, for scroll-linked lines and fills. */
export function ScrollProgress({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.style.setProperty('--p', '1');
      return;
    }
    return subscribeToScroll(el, (rect, vh) => {
      const p = Math.min(1, Math.max(0, (vh * 0.78 - rect.top) / rect.height));
      el.style.setProperty('--p', p.toFixed(3));
    });
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
