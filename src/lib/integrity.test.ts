import { describe, expect, it } from 'vitest';
import { CLEAN_REPORT, IntegrityTracker, MIN_AWAY_MS, flagCount, flagLines, flagSummary, isFlagged } from './integrity.ts';

function harness() {
  let t = 0;
  const tracker = new IntegrityTracker(() => t);
  return { tracker, tick: (ms: number) => (t += ms) };
}

interface Key {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/** A stand-in page: a document and window whose events the test fires by hand. */
function fakePage(selection?: () => string) {
  const listeners = new Map<string, (e?: Key) => void>();
  const doc = {
    visibilityState: 'visible',
    ...(selection ? { getSelection: () => ({ toString: selection }) } : {}),
    addEventListener: (type: string, fn: () => void) => void listeners.set(`doc:${type}`, fn),
    removeEventListener: (type: string) => void listeners.delete(`doc:${type}`),
  };
  const win = {
    addEventListener: (type: string, fn: (e?: Key) => void) => void listeners.set(`win:${type}`, fn),
    removeEventListener: (type: string) => void listeners.delete(`win:${type}`),
  };
  const fire = (name: string, e?: Key) => listeners.get(name)!(e);
  return {
    doc,
    win,
    listeners,
    hide: () => {
      doc.visibilityState = 'hidden';
      fire('doc:visibilitychange');
    },
    show: () => {
      doc.visibilityState = 'visible';
      fire('doc:visibilitychange');
    },
    blur: () => fire('win:blur'),
    focus: () => fire('win:focus'),
    key: (e: Key) => fire('win:keydown', e),
    copy: () => fire('doc:copy'),
  };
}

/** A stand-in navigator.wakeLock that counts what was asked of it. */
function fakeWakeLock() {
  const log = { requests: 0, releases: 0 };
  const pending: (() => void)[] = [];
  const nav = {
    wakeLock: {
      request: (_type: 'screen') => {
        log.requests++;
        return new Promise<{ release(): Promise<void> }>((grant) => {
          pending.push(() =>
            grant({
              release: () => {
                log.releases++;
                return Promise.resolve();
              },
            }),
          );
        });
      },
    },
  };
  /** The browser grants every request made so far. */
  const grant = async () => {
    for (const g of pending.splice(0)) g();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { nav, log, grant };
}

describe('IntegrityTracker', () => {
  it('reports a clean round as clean', () => {
    const { tracker, tick } = harness();
    for (let i = 0; i < 8; i++) {
      tracker.startQuestion(i === 3);
      tick(6000);
      expect(tracker.endQuestion()).toBe(6000);
      tick(2000); // reading the reveal
    }
    expect(tracker.report()).toEqual(CLEAN_REPORT);
    expect(isFlagged(tracker.report())).toBe(false);
    expect(flagLines(tracker.report())).toEqual([]);
    expect(flagSummary(tracker.report())).toBe('Clean round.');
  });

  it('counts one trip when blur and visibilitychange both fire', () => {
    const { tracker, tick } = harness();
    tracker.startQuestion(false);
    tick(3000);
    tracker.left(); // window blur
    tracker.left(); // visibilitychange hidden
    tick(11000);
    tracker.returned(); // visible
    tracker.returned(); // focus
    tick(2000);
    tracker.endQuestion();
    expect(tracker.report().away).toBe(1);
    expect(tracker.report().awaySec).toBe(11);
  });

  it('merges a re-blur straight after returning into the same trip', () => {
    const { tracker, tick } = harness();
    tracker.startQuestion(false);
    tracker.left();
    tick(5000);
    tracker.returned();
    tick(100);
    tracker.left();
    tick(2000);
    tracker.returned();
    tracker.endQuestion();
    expect(tracker.report().away).toBe(1);
    expect(tracker.report().awaySec).toBe(7);
  });

  it('counts separate trips separately', () => {
    const { tracker, tick } = harness();
    tracker.startQuestion(false);
    tracker.left();
    tick(4000);
    tracker.returned();
    tick(5000);
    tracker.left();
    tick(6000);
    tracker.returned();
    tracker.endQuestion();
    expect(tracker.report().away).toBe(2);
    expect(tracker.report().awaySec).toBe(10);
  });

  it('ignores leaving while no question is live (reading the reveal, sharing)', () => {
    const { tracker, tick } = harness();
    tracker.left();
    tick(60000);
    tracker.returned();
    tracker.startQuestion(false);
    tick(5000);
    tracker.endQuestion();
    tracker.left();
    tick(60000);
    tracker.returned();
    tracker.copied();
    expect(tracker.report()).toEqual(CLEAN_REPORT);
  });

  it('closes out a trip if they answer without a return event', () => {
    const { tracker, tick } = harness();
    tracker.startQuestion(false);
    tracker.left();
    tick(8000);
    tracker.endQuestion();
    expect(tracker.report().away).toBe(1);
    expect(tracker.report().awaySec).toBe(8);
  });

  it('flags slow math but not slow anything else', () => {
    const { tracker, tick } = harness();
    tracker.startQuestion(false);
    tick(50000);
    tracker.endQuestion();
    expect(tracker.report().slowMath).toBe(0);
    tracker.startQuestion(true);
    tick(38000);
    tracker.endQuestion();
    tracker.startQuestion(true);
    tick(29000);
    tracker.endQuestion();
    expect(tracker.report().slowMath).toBe(1);
    expect(tracker.report().slowestMathSec).toBe(38);
    expect(flagLines(tracker.report())).toEqual(['Took 38 seconds on a math question.']);
  });

  it('counts copies during a question and speed-taps', () => {
    const { tracker, tick } = harness();
    for (let i = 0; i < 3; i++) {
      tracker.startQuestion(false);
      tick(600);
      tracker.endQuestion();
    }
    tracker.startQuestion(false);
    tracker.copied();
    tick(9000);
    tracker.endQuestion();
    const report = tracker.report();
    expect(report.blitz).toBe(3);
    expect(report.copies).toBe(1);
    expect(isFlagged(report)).toBe(true);
    expect(flagCount(report)).toBe(1);
    expect(flagLines(report)).toHaveLength(2);
  });

  it('does not put an asterisk on speed-tapping alone', () => {
    expect(isFlagged({ ...CLEAN_REPORT, blitz: 8 })).toBe(false);
  });

  it('writes the sample flags the way the result card shows them', () => {
    const report = { ...CLEAN_REPORT, away: 1, awaySec: 11, slowMath: 1, slowestMathSec: 38 };
    expect(flagLines(report)).toEqual(['Left the app once. Gone 11 seconds.', 'Took 38 seconds on a math question.']);
    expect(flagSummary(report)).toBe('Left the app once, slow on the math.');
    expect(flagCount(report)).toBe(2);
  });

  it('wires up to document and window events', () => {
    const listeners = new Map<string, () => void>();
    const doc = {
      visibilityState: 'visible',
      addEventListener: (type: string, fn: () => void) => void listeners.set(`doc:${type}`, fn),
      removeEventListener: (type: string) => void listeners.delete(`doc:${type}`),
    };
    const win = {
      addEventListener: (type: string, fn: () => void) => void listeners.set(`win:${type}`, fn),
      removeEventListener: (type: string) => void listeners.delete(`win:${type}`),
    };
    const { tracker, tick } = harness();
    const detach = tracker.attach(doc, win);
    tracker.startQuestion(false);
    doc.visibilityState = 'hidden';
    listeners.get('doc:visibilitychange')!();
    tick(3000);
    doc.visibilityState = 'visible';
    listeners.get('doc:visibilitychange')!();
    listeners.get('doc:copy')!();
    tracker.endQuestion();
    expect(tracker.report().away).toBe(1);
    expect(tracker.report().copies).toBe(1);
    detach();
    expect(listeners.size).toBe(0);
  });
});

describe('never an asterisk on an honest player', () => {
  it('does not count a trip shorter than a second, whichever event reported it', () => {
    const { tracker, tick } = harness();
    const page = fakePage();
    tracker.attach(page.doc, page.win);
    tracker.startQuestion(false);
    tick(4000);
    page.blur(); // a notification banner
    tick(400);
    page.focus();
    tick(3000);
    page.hide(); // a permission prompt, a mis-tap on the app switcher
    tick(MIN_AWAY_MS - 1);
    page.show();
    tick(3000);
    tracker.left(); // still open when they answer
    tick(600);
    tracker.endQuestion();
    expect(tracker.report()).toEqual(CLEAN_REPORT);
    expect(isFlagged(tracker.report())).toBe(false);
  });

  it('still counts a trip of a second or more', () => {
    const { tracker, tick } = harness();
    const page = fakePage();
    tracker.attach(page.doc, page.win);
    tracker.startQuestion(false);
    tick(4000);
    page.blur();
    tick(MIN_AWAY_MS);
    page.focus();
    tick(2000);
    tracker.endQuestion();
    expect(tracker.report()).toEqual({ ...CLEAN_REPORT, away: 1, awaySec: 1 });
  });

  it('does not let a blip hide the real trip that follows it', () => {
    const { tracker, tick } = harness();
    tracker.startQuestion(false);
    tick(2000);
    tracker.left();
    tick(200);
    tracker.returned();
    tick(100);
    tracker.left();
    tick(10_000);
    tracker.returned();
    tick(2000);
    tracker.endQuestion();
    expect(tracker.report()).toEqual({ ...CLEAN_REPORT, away: 1, awaySec: 10 });
  });

  it('does not count Tab stepping off the end of the page', () => {
    const { tracker, tick } = harness();
    const page = fakePage();
    tracker.attach(page.doc, page.win);
    tracker.startQuestion(false);
    tick(3000);
    page.key({ key: 'Tab' }); // past the last answer, into the browser's toolbar
    page.blur();
    tick(6000); // tabbing through the toolbar
    page.focus();
    tick(1500);
    page.key({ key: 'Tab', shiftKey: true }); // and back out over the top
    tick(20);
    page.blur();
    tick(4000);
    page.focus();
    tick(2000);
    tracker.endQuestion();
    expect(tracker.report()).toEqual(CLEAN_REPORT);
  });

  it('still counts a blur that Tab did not cause', () => {
    const run = (before: (page: ReturnType<typeof fakePage>, tick: (ms: number) => void) => void) => {
      const { tracker, tick } = harness();
      const page = fakePage();
      tracker.attach(page.doc, page.win);
      tracker.startQuestion(false);
      tick(3000);
      before(page, tick);
      page.blur();
      tick(5000);
      page.focus();
      tick(2000);
      tracker.endQuestion();
      return tracker.report().away;
    };
    expect(run(() => {})).toBe(1);
    expect(run((page) => page.key({ key: 'a' }))).toBe(1);
    // Tab inside the page, then leaving half a second later.
    expect(run((page, tick) => (page.key({ key: 'Tab' }), tick(500)))).toBe(1);
    // Switching tabs, windows or apps from the keyboard.
    expect(run((page) => page.key({ key: 'Tab', ctrlKey: true }))).toBe(1);
    expect(run((page) => page.key({ key: 'Tab', altKey: true }))).toBe(1);
    expect(run((page) => page.key({ key: 'Tab', metaKey: true }))).toBe(1);
  });

  it('still counts leaving after tabbing out, once the page is hidden', () => {
    const { tracker, tick } = harness();
    const page = fakePage();
    tracker.attach(page.doc, page.win);
    tracker.startQuestion(false);
    tick(3000);
    page.key({ key: 'Tab' });
    page.blur();
    tick(2000);
    page.hide();
    tick(9000);
    page.show();
    page.focus();
    tick(2000);
    tracker.endQuestion();
    expect(tracker.report()).toEqual({ ...CLEAN_REPORT, away: 1, awaySec: 9 });
  });

  it('does not count the copy shortcut with nothing selected', () => {
    let selected = '';
    const { tracker, tick } = harness();
    const page = fakePage(() => selected);
    tracker.attach(page.doc, page.win);
    tracker.startQuestion(false);
    tick(3000);
    page.copy();
    expect(tracker.report().copies).toBe(0);
    selected = 'How long do you rest a brisket?';
    page.copy();
    tick(3000);
    tracker.endQuestion();
    expect(tracker.report()).toEqual({ ...CLEAN_REPORT, copies: 1 });
  });

  it('does not call time away on a math question slow math as well', () => {
    const { tracker, tick } = harness();
    tracker.startQuestion(true);
    tick(1500);
    tracker.left(); // a phone call
    tick(28_000);
    tracker.returned();
    tick(1500);
    expect(tracker.endQuestion()).toBe(31_000);
    expect(tracker.report()).toEqual({ ...CLEAN_REPORT, away: 1, awaySec: 28 });
    expect(flagSummary(tracker.report())).toBe('Left the app once.');
    expect(flagCount(tracker.report())).toBe(1);
  });

  it('still calls math slow when the time spent here was slow', () => {
    const { tracker, tick } = harness();
    tracker.startQuestion(false);
    tracker.left();
    tick(20_000); // away on an earlier question: no discount on this one
    tracker.returned();
    tracker.endQuestion();
    tracker.startQuestion(true);
    tick(20_000);
    tracker.left();
    tick(10_000);
    tick(15_000);
    tracker.endQuestion(); // answered without a return event
    expect(tracker.report()).toEqual({ ...CLEAN_REPORT, away: 2, awaySec: 45, slowMath: 0, slowestMathSec: 0 });

    tracker.startQuestion(true);
    tick(20_000);
    tracker.left();
    tick(10_000);
    tracker.returned();
    tick(15_000);
    tracker.endQuestion();
    expect(tracker.report()).toEqual({ ...CLEAN_REPORT, away: 3, awaySec: 55, slowMath: 1, slowestMathSec: 35 });
  });
});

describe('keeping the screen awake', () => {
  it('holds a wake lock while attached, takes it again on return, and lets go on detach', async () => {
    const { tracker } = harness();
    const page = fakePage();
    const lock = fakeWakeLock();
    const detach = tracker.attach(page.doc, page.win, lock.nav);
    expect(lock.log).toEqual({ requests: 1, releases: 0 });
    await lock.grant();

    // The browser drops the lock when the page is hidden; coming back asks again.
    page.hide();
    expect(lock.log.requests).toBe(1);
    page.show();
    expect(lock.log.requests).toBe(2);
    await lock.grant();
    expect(lock.log.releases).toBe(1); // the stale one

    detach();
    expect(lock.log).toEqual({ requests: 2, releases: 2 });
    expect(page.listeners.size).toBe(0);
  });

  it('lets go of a lock that is granted after detaching', async () => {
    const { tracker } = harness();
    const page = fakePage();
    const lock = fakeWakeLock();
    const detach = tracker.attach(page.doc, page.win, lock.nav);
    detach();
    await lock.grant();
    expect(lock.log).toEqual({ requests: 1, releases: 1 });
  });

  it('does not ask while the page is hidden', () => {
    const { tracker } = harness();
    const page = fakePage();
    page.doc.visibilityState = 'hidden';
    const lock = fakeWakeLock();
    tracker.attach(page.doc, page.win, lock.nav);
    expect(lock.log.requests).toBe(0);
  });

  it('never throws where the API is missing, refused or broken', async () => {
    const navs = [
      undefined,
      {},
      { wakeLock: { request: () => Promise.reject(new Error('NotAllowedError')) } },
      {
        wakeLock: {
          request: (): Promise<{ release(): Promise<void> }> => {
            throw new Error('SecurityError');
          },
        },
      },
      { wakeLock: { request: () => Promise.resolve({ release: () => Promise.reject(new Error('gone')) }) } },
    ];
    for (const nav of navs) {
      const { tracker, tick } = harness();
      const page = fakePage();
      const detach = tracker.attach(page.doc, page.win, nav);
      await Promise.resolve();
      tracker.startQuestion(false);
      page.hide();
      tick(5000);
      page.show();
      await Promise.resolve();
      tracker.endQuestion();
      detach();
      await Promise.resolve();
      await Promise.resolve();
      // Without the lock the tracker behaves as before: a real trip still counts.
      expect(tracker.report().away).toBe(1);
    }
  });
});

describe('a round this device has seen before', () => {
  it('is on the report, the card and the asterisk', () => {
    const { tracker, tick } = harness();
    tracker.seenBefore();
    tracker.startQuestion(false);
    tick(5000);
    tracker.endQuestion();
    const report = tracker.report();
    expect(report).toEqual({ ...CLEAN_REPORT, repeat: 1 });
    expect(isFlagged(report)).toBe(true);
    expect(flagCount(report)).toBe(1);
    expect(flagLines(report)).toEqual(['Second look. This phone had already seen answers to these questions.']);
    expect(flagSummary(report)).toBe('Second look at these questions.');
    expect(flagSummary({ ...report, away: 1 })).toBe('Second look at these questions, left the app once.');
  });
});
