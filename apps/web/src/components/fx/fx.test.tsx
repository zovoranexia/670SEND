import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Parallax } from './parallax';
import { Reveal } from './reveal';
import { ScrollProgress } from './scroll-progress';
import { Splash } from './splash';

const reducedMotion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.fx;
});

describe('logo splash', () => {
  it('is purely decorative: hidden from assistive technology and carries no text', () => {
    const { container } = render(<Splash />);
    const root = container.firstElementChild!;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.textContent).toBe('');
    // every stroke of the logo is animated with the same dash technique
    expect(container.querySelectorAll('.dash').length).toBeGreaterThanOrEqual(12);
  });
});

describe('<Reveal />', () => {
  it('keeps its content in the DOM and marks it visible at once when motion is reduced', () => {
    reducedMotion(true);
    render(<Reveal>Hello parcel</Reveal>);
    const el = screen.getByText('Hello parcel');
    expect(el).toBeVisible();
    expect(el).toHaveAttribute('data-in');
  });

  it('waits for the element to scroll into view otherwise, and tells the CSS that scripts are running', () => {
    reducedMotion(false);
    const observe = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = observe;
        disconnect = vi.fn();
      },
    );
    render(<Reveal delay={120}>Later</Reveal>);
    const el = screen.getByText('Later');
    expect(el).not.toHaveAttribute('data-in');
    expect(el.style.getPropertyValue('--d')).toBe('120ms');
    expect(observe).toHaveBeenCalledWith(el);
    expect(document.documentElement.dataset.fx).toBe('on');
  });
});

describe('<Parallax /> and <ScrollProgress />', () => {
  it('parallax layers are always aria-hidden and never move under reduced motion', () => {
    reducedMotion(true);
    const { container } = render(<Parallax speed={0.3}>layer</Parallax>);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect((container.firstElementChild!.firstElementChild as HTMLElement).style.transform).toBe('');
  });

  it('scroll progress shows the finished state (--p = 1) under reduced motion', () => {
    reducedMotion(true);
    const { container } = render(<ScrollProgress>steps</ScrollProgress>);
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--p')).toBe('1');
  });
});
