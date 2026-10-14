import { useEffect, useState } from 'react';

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** False on the first paint, true on the next frame, so CSS transitions run from their start state. */
export function useMounted(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') { setOn(true); return; }
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

/** Counts from 0 to target over `ms`; returns target immediately under reduced motion or without matchMedia. */
export function useCountUp(target: number, ms = 600): number {
  const [v, setV] = useState(() => (prefersReducedMotion() ? target : 0));
  useEffect(() => {
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') { setV(target); return; }
    const t0 = performance.now();
    let id = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target, ms]);
  return v;
}
