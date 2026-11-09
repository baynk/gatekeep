/**
 * Silent integrity signals. Nothing here interrupts play: the tracker just
 * keeps notes, and the result screen reads them back with a straight face.
 *
 * Signals:
 * - leaving the app or tab mid-round (visibility change or window blur)
 * - taking suspiciously long on arithmetic a practitioner knows cold
 * - copying text during a question
 * - answering faster than anyone could have read the question
 * - starting a challenge this device has already been shown answers to
 *
 * The other half of the rule: never put an asterisk on an honest player. The
 * screen is kept awake so it cannot lock mid-question, a blip shorter than a
 * second is not leaving, and Tab stepping off the end of the page is not
 * leaving either.
 */

/** A math question slower than this is "suspiciously slow". */
export const SLOW_MATH_MS = 30_000;
/** Faster than this and they did not read it. */
export const BLITZ_MS = 1_200;
/** Two blurs closer together than this are one trip, not two. */
const AWAY_MERGE_MS = 400;
/**
 * Away for less than this is not leaving: a notification banner, a permission
 * prompt, a mis-tap. Nobody looks anything up in under a second.
 */
export const MIN_AWAY_MS = 1_000;
/**
 * A window blur this soon after a plain Tab is focus stepping off the end of
 * the page into the browser's own controls, not someone leaving.
 */
const TAB_OUT_MS = 100;

export interface IntegrityReport {
  /** Times they left the app or tab during a question. */
  away: number;
  /** Total seconds spent away. */
  awaySec: number;
  /** Math questions that took longer than SLOW_MATH_MS. */
  slowMath: number;
  /** Slowest math answer in seconds (0 if no math question was slow). */
  slowestMathSec: number;
  /** Times they copied text during a question. */
  copies: number;
  /** Answers given faster than BLITZ_MS. */
  blitz: number;
  /** 1 when this device had already been shown answers to this exact round. */
  repeat: number;
}

export const CLEAN_REPORT: IntegrityReport = { away: 0, awaySec: 0, slowMath: 0, slowestMathSec: 0, copies: 0, blitz: 0, repeat: 0 };

interface DocLike {
  visibilityState: string;
  /** Absent in the tests' stand-in document; real documents always have it. */
  getSelection?(): { toString(): string } | null;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}
interface KeyLike {
  key?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}
interface WinLike {
  addEventListener(type: string, fn: (e?: KeyLike) => void): void;
  removeEventListener(type: string, fn: (e?: KeyLike) => void): void;
}
interface LockLike {
  release(): Promise<unknown>;
}
interface NavLike {
  wakeLock?: { request(type: 'screen'): Promise<LockLike> };
}

export class IntegrityTracker {
  private now: () => number;
  private questionStart = 0;
  private questionIsMath = false;
  private inQuestion = false;
  private awaySince: number | null = null;
  private lastReturn = -Infinity;
  private awayMs = 0;
  /** Time away during the live question, so it is not also counted as time spent on it. */
  private awayThisQuestion = 0;
  private away = 0;
  private slowMath = 0;
  private slowestMathMs = 0;
  private copies = 0;
  private blitz = 0;
  private repeat = 0;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /**
   * Start listening, and keep the screen awake while we do. Returns a function
   * that stops both. Safe to call on the server (no-op).
   */
  attach(
    doc: DocLike | undefined = globalThis.document,
    win: WinLike | undefined = globalThis.window,
    nav: NavLike | undefined = globalThis.navigator,
  ): () => void {
    if (!doc || !win) return () => {};

    // A phone that locks its own screen while someone reads a long question
    // hides the page exactly as leaving does. Hold a wake lock so it cannot.
    // Best effort: where the API is missing or refused, play on without it.
    let attached = true;
    let lock: LockLike | null = null;
    const drop = (held: LockLike | null) => {
      try {
        held?.release().catch(() => {});
      } catch {
        /* already gone */
      }
    };
    const keepAwake = () => {
      if (doc.visibilityState !== 'visible') return;
      try {
        nav?.wakeLock?.request('screen').then(
          (held) => {
            if (!attached) return drop(held);
            drop(lock);
            lock = held;
          },
          () => {},
        );
      } catch {
        /* not allowed here: fine */
      }
    };

    const onVisibility = () => {
      if (doc.visibilityState === 'hidden') return this.left();
      this.returned();
      keepAwake(); // the browser drops the lock whenever the page is hidden
    };
    // Tab (or Shift+Tab) past either end of the page moves focus to the
    // browser's toolbar and blurs the window. That is keyboard navigation.
    // Ctrl, Alt and Cmd+Tab switch tabs and apps, so those still count.
    let lastTab = -Infinity;
    const onKeyDown = (e?: KeyLike) => {
      if (e?.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) lastTab = this.now();
    };
    const onBlur = () => {
      if (this.now() - lastTab < TAB_OUT_MS && doc.visibilityState !== 'hidden') return;
      this.left();
    };
    const onFocus = () => this.returned();
    const onCopy = () => {
      // The copy shortcut fires this even with nothing selected, and that copies nothing.
      const selection = doc.getSelection?.();
      if (selection === undefined || String(selection ?? '') !== '') this.copied();
    };
    doc.addEventListener('visibilitychange', onVisibility);
    win.addEventListener('keydown', onKeyDown);
    win.addEventListener('blur', onBlur);
    win.addEventListener('focus', onFocus);
    doc.addEventListener('copy', onCopy);
    keepAwake();
    return () => {
      attached = false;
      drop(lock);
      lock = null;
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('blur', onBlur);
      win.removeEventListener('focus', onFocus);
      doc.removeEventListener('copy', onCopy);
    };
  }

  /** Call when the round being started is one this device has already been shown answers to. */
  seenBefore(): void {
    this.repeat = 1;
  }

  /** Call when a question appears. Only time spent on a live question counts. */
  startQuestion(isMath: boolean): void {
    this.questionStart = this.now();
    this.questionIsMath = isMath;
    this.inQuestion = true;
    this.awaySince = null;
    this.awayThisQuestion = 0;
  }

  /** Call when they answer. Returns the time the question took, in ms. */
  endQuestion(): number {
    if (!this.inQuestion) return 0;
    // If they answered while we still think they are away, close that trip out.
    this.returned();
    const ms = Math.max(0, this.now() - this.questionStart);
    this.inQuestion = false;
    // Time away is already on the report as leaving. Slow math is about the
    // time they were here, or one phone call would read as two offences.
    const present = Math.max(0, ms - this.awayThisQuestion);
    if (this.questionIsMath && present > SLOW_MATH_MS) {
      this.slowMath++;
      this.slowestMathMs = Math.max(this.slowestMathMs, present);
    }
    if (ms < BLITZ_MS) this.blitz++;
    return ms;
  }

  left(): void {
    if (!this.inQuestion || this.awaySince !== null) return;
    this.awaySince = this.now();
  }

  returned(): void {
    if (this.awaySince === null) return;
    const since = this.awaySince;
    const t = this.now();
    const gone = Math.max(0, t - since);
    this.awaySince = null;
    // Too short to be leaving, whichever event reported it. Nothing is kept.
    if (gone < MIN_AWAY_MS) return;
    // Blur and visibilitychange both fire for one trip; a quick re-blur right
    // after returning is the same trip too.
    if (since - this.lastReturn > AWAY_MERGE_MS) this.away++;
    this.awayMs += gone;
    this.awayThisQuestion += gone;
    this.lastReturn = t;
  }

  copied(): void {
    if (this.inQuestion) this.copies++;
  }

  report(): IntegrityReport {
    return {
      away: this.away,
      awaySec: Math.round(this.awayMs / 1000),
      slowMath: this.slowMath,
      slowestMathSec: Math.round(this.slowestMathMs / 1000),
      copies: this.copies,
      blitz: this.blitz,
      repeat: this.repeat,
    };
  }
}

/** Does the result get an asterisk? Speed-tapping is funny, not suspicious. */
export function isFlagged(r: IntegrityReport): boolean {
  return r.away > 0 || r.slowMath > 0 || r.copies > 0 || r.repeat > 0;
}

export function flagCount(r: IntegrityReport): number {
  return (r.away > 0 ? 1 : 0) + (r.slowMath > 0 ? 1 : 0) + (r.copies > 0 ? 1 : 0) + (r.repeat > 0 ? 1 : 0);
}

function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}

/** Full sentences for the result card. Empty when there is nothing to say. */
export function flagLines(r: IntegrityReport): string[] {
  const out: string[] = [];
  // Worded about the phone, not the person: it stays true if someone else is holding it.
  if (r.repeat > 0) out.push('Second look. This phone had already seen answers to these questions.');
  if (r.away > 0) {
    const gone = r.awaySec >= 1 ? ` Gone ${r.awaySec} second${r.awaySec === 1 ? '' : 's'}.` : '';
    out.push(`Left the app ${times(r.away)}.${gone}`);
  }
  if (r.slowMath > 0) {
    out.push(
      r.slowMath === 1
        ? `Took ${r.slowestMathSec} seconds on a math question.`
        : `Took their time on ${r.slowMath} math questions. Longest: ${r.slowestMathSec} seconds.`,
    );
  }
  if (r.copies > 0) out.push(`Copied text ${times(r.copies)} mid-question. For safekeeping, surely.`);
  if (r.blitz >= 3) out.push(`Answered ${r.blitz} in about a second each. Bold.`);
  return out;
}

/** One short clause for tight spots (head-to-head, share text). */
export function flagSummary(r: IntegrityReport): string {
  const bits: string[] = [];
  if (r.repeat > 0) bits.push('second look at these questions');
  if (r.away > 0) bits.push(`left the app ${times(r.away)}`);
  if (r.slowMath > 0) bits.push('slow on the math');
  if (r.copies > 0) bits.push('copied a question');
  if (!bits.length) return 'Clean round.';
  const text = bits.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
