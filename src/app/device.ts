/** Small wrappers around device features that may be missing or blocked. None of them throw. */

/**
 * How long a new screen, or whatever a closing sheet uncovers, ignores taps.
 * Long enough to catch the second tap of a double tap, short enough not to be felt.
 */
export const TAP_GUARD_MS = 260;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

let glides = 0;

/** True while the page is being moved by `glideTo`, and for the frame its last scroll event takes to arrive. */
export function gliding(): boolean {
  return glides > 0;
}

/**
 * Scroll the page to `top` over a few frames, easing out, or at once for
 * anyone who asked for less motion. Returns a function that stops it where it
 * is. A touch or the wheel stops it too: the page is theirs.
 *
 * Done by hand, not with `behavior: 'smooth'`, because a browser's own smooth
 * scroll cannot be called off: a jump to the top made while one is running
 * (a quick tap on Next) lands part-way down the next screen.
 */
export function glideTo(top: number, ms = 260): () => void {
  const from = window.scrollY;
  if (Math.abs(top - from) < 1) return () => {};
  if (prefersReducedMotion()) {
    window.scrollTo(0, top);
    return () => {};
  }
  let frame = 0;
  let start: number | null = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    window.removeEventListener('touchstart', stop);
    window.removeEventListener('wheel', stop);
    requestAnimationFrame(() => glides--);
  };
  const step = (now: number) => {
    start ??= now;
    const t = Math.min(1, (now - start) / ms);
    window.scrollTo(0, from + (top - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) frame = requestAnimationFrame(step);
    else stop();
  };
  glides++;
  window.addEventListener('touchstart', stop, { passive: true });
  window.addEventListener('wheel', stop, { passive: true });
  frame = requestAnimationFrame(step);
  return stop;
}

/** A short vibration where the platform has one (Android, mostly). Silent elsewhere. */
export function buzz(pattern: number | number[] = 10): void {
  try {
    if (!prefersReducedMotion()) navigator.vibrate?.(pattern);
  } catch {
    /* not allowed here: fine */
  }
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and insecure contexts: fall back to a hidden field.
    try {
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand('copy');
      field.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Hand text to the system share sheet on phones, or the clipboard elsewhere.
 * `text` should already end with the link: some share targets drop `url`.
 */
export async function shareOrCopy(text: string): Promise<ShareOutcome> {
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
  if (touch && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return 'cancelled';
      // Fall through to the clipboard.
    }
  }
  return (await copy(text)) ? 'copied' : 'failed';
}
