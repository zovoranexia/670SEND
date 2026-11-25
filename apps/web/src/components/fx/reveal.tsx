'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { prefersReducedMotion } from './scroll-fx';

/** Fades and lifts its children in when they scroll into view. `delay` (ms) staggers siblings. */
export function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    document.documentElement.dataset.fx = 'on'; // tells the CSS failsafe that scripts are running
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      el.dataset.in = '';
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          el.dataset.in = '';
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`reveal ${className}`} style={delay ? ({ '--d': `${delay}ms` } as CSSProperties) : undefined}>
      {children}
    </div>
  );
}
