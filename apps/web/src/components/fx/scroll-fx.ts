/**
 * One shared scroll loop for every parallax / scroll-linked element: a passive scroll listener schedules a single
 * requestAnimationFrame, and only elements that are (nearly) on screen are measured. All effects are decorative and
 * are never started for visitors who asked for reduced motion.
 */
type Callback = (rect: DOMRect, viewportHeight: number) => void;

const subscribers = new Map<Element, Callback>();
const visible = new Set<Element>();
let observer: IntersectionObserver | null = null;
let scheduled = false;

function frame() {
  scheduled = false;
  const vh = window.innerHeight;
  for (const el of visible) subscribers.get(el)?.(el.getBoundingClientRect(), vh);
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(frame);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Calls `callback` (once per frame) while `el` is within 25% of the viewport. Returns the unsubscribe function. */
export function subscribeToScroll(el: Element, callback: Callback): () => void {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        schedule();
      },
      { rootMargin: '25% 0px' },
    );
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
  }
  subscribers.set(el, callback);
  observer.observe(el);
  schedule();
  return () => {
    subscribers.delete(el);
    visible.delete(el);
    observer?.unobserve(el);
  };
}
