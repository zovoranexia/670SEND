import type { CSSProperties, ReactNode } from 'react';
import { CurveEdge } from './fx/decor';
import { Parallax } from './fx/parallax';

/** Compact banner at the top of the inner pages: gradient, drifting glows, the page's single <h1> and its lead. */
export function PageHero({ title, lead, children }: { title: string; lead?: string; children?: ReactNode }) {
  return (
    <section className="on-dark relative isolate overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 text-white">
      <Parallax speed={0.3} className="absolute -inset-y-16 inset-x-0 -z-10" innerClassName="relative h-full">
        <div className="absolute -left-16 top-4 h-72 w-72 rounded-full bg-brand-500/40 blur-3xl" />
        <div className="absolute -right-10 top-16 h-72 w-72 rounded-full bg-accent-500/20 blur-3xl" />
      </Parallax>
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-20 [mask-image:linear-gradient(to_bottom,black,transparent)]"
        aria-hidden="true"
        style={{ backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.5) 1.2px, transparent 1.2px)', backgroundSize: '22px 22px' }}
      />
      <div className="container-page pb-6 pt-12 sm:pt-16">
        <div className="mx-auto max-w-5xl">
          <h1 className="rise text-3xl font-extrabold tracking-tight text-balance sm:text-5xl">{title}</h1>
          {lead && (
            <p className="rise mt-4 max-w-2xl text-lg leading-relaxed text-brand-100 sm:text-xl" style={{ '--d': '90ms' } as CSSProperties}>
              {lead}
            </p>
          )}
          {children}
        </div>
      </div>
      <CurveEdge />
    </section>
  );
}
