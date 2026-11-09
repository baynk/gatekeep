import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './device.ts';

/** Counts from 0 up to `target` with an ease-out, like a scoreboard settling. */
export function useCountUp(target: number, durationMs = 900, delayMs = 0): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));

  useEffect(() => {
    if (prefersReducedMotion() || durationMs <= 0) {
      setValue(target);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) start = now + delayMs;
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, delayMs]);

  return value;
}

/** A message that clears itself. `show` restarts the clock. */
export function useToast(ms = 2200): { message: string | null; show(message: string): void } {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = useCallback(
    (next: string) => {
      window.clearTimeout(timer.current);
      setMessage(next);
      timer.current = window.setTimeout(() => setMessage(null), ms);
    },
    [ms],
  );

  return { message, show };
}
