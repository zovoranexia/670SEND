'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { prefersReducedMotion, subscribeToScroll } from './scroll-fx';

/**
 * Decorative parallax layer (always `aria-hidden`: never put content in it). The outer box is positioned by
 * `className`; the inner box is the one that moves.
 *   speed > 0  → the layer lags behind the scroll (distant background)
 *   speed < 0  → the layer runs ahead of the scroll (foreground)
 */
export function Parallax({ speed = 0.2, className = '', innerClassName = '', children }: { speed?: number; className?: string; innerClassName?: string; children?: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i || prefersReducedMotion()) return;
    const unsubscribe = subscribeToScroll(o, (rect, vh) => {
      const offset = (rect.top + rect.height / 2 - vh / 2) * speed;
      i.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    });
    return () => {
      unsubscribe();
      i.style.transform = '';
    };
  }, [speed]);

  return (
    <div ref={outer} className={className} aria-hidden="true">
      <div ref={inner} className={`will-change-transform ${innerClassName}`}>
        {children}
      </div>
    </div>
  );
}
