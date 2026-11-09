import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { TAP_GUARD_MS, gliding, shareOrCopy } from './app/device.ts';
import { useToast } from './app/hooks.ts';
import { useGatekeep } from './app/useGatekeep.ts';
import { Home } from './screens/Home.tsx';
import { Intro } from './screens/Intro.tsx';
import { Play } from './screens/Play.tsx';
import { Result } from './screens/Result.tsx';
import { Versus } from './screens/Versus.tsx';

/** A second tap this close to the last one, inside TAP_GUARD_MS, is the same double tap. */
const TAP_GUARD_PX = 32;
/**
 * How long a finger rests on a key before the key goes down. Until then the
 * touch may still turn out to be a scroll, and a scroll must not look like a press.
 */
const PRESS_DELAY_MS = 120;
/** How long a tap quicker than that shows its press for, once the finger has lifted. */
const PRESS_FLASH_MS = 90;

export function App() {
  const gk = useGatekeep();
  const { message, show } = useToast();
  const { stage } = gk;

  // A broken or stale link lands on Home with a word about why. Keyed on the
  // stage, not the text: a second bad link says the same thing and must say it again.
  useEffect(() => {
    if (stage.at === 'home' && stage.notice) show(stage.notice);
  }, [stage, show]);

  const share = useCallback(
    async (text: string, copiedMessage: string) => {
      const outcome = await shareOrCopy(text);
      if (outcome === 'copied') show(copiedMessage);
      else if (outcome === 'failed') show('Could not copy that here. Try another browser.');
    },
    [show],
  );

  // Each question is its own screen, so it gets its own entrance.
  const key = stage.at === 'play' ? `play-${stage.game.round.seed}-${stage.game.name}-${stage.game.index}` : stage.at;

  // A fast double tap must not fall through onto whatever the next screen puts
  // under the same thumb (it would skip the result entirely). Taps in the first
  // moments of a new screen are dropped.
  const guardUntil = useRef(0);
  const screen = useRef<HTMLElement>(null);
  const firstScreen = useRef(true);
  useLayoutEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    guardUntil.current = performance.now() + TAP_GUARD_MS;
    // Screen readers and keyboards start again from the top of the new screen.
    screen.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [key]);
  // A swap inside a screen (the quit sheet closing, an empty search giving way
  // to the list) never changes `key`, so a second tap in the same spot moments
  // after the last one is dropped too. A click from the keyboard has no spot
  // (`detail` is 0), and is never the second half of a double tap.
  const lastTap = useRef({ at: -Infinity, x: 0, y: 0 });
  const dropEarlyTaps = (e: MouseEvent) => {
    const now = performance.now();
    const last = lastTap.current;
    const pointed = e.detail > 0;
    const sameSpot = pointed && now - last.at < TAP_GUARD_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < TAP_GUARD_PX;
    if (now < guardUntil.current || sameSpot) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Only a tap that got through moves the spot: a dropped one must not extend the wait.
    if (pointed) lastTap.current = { at: now, x: e.clientX, y: e.clientY };
  };

  // Keys go down on the press, not on release: `:active` alone waits for the
  // finger to lift on touch screens. A mouse press shows at once. A finger
  // might be starting a scroll, so its press waits a moment, and never shows
  // if the scroll starts first.
  useEffect(() => {
    let held: Element | null = null;
    let timer = 0;
    const release = () => {
      window.clearTimeout(timer);
      timer = 0;
      held?.classList.remove('is-down');
      held = null;
    };
    const press = (e: PointerEvent) => {
      release();
      const key = (e.target as Element | null)?.closest?.('.key, .chip');
      if (!key || (key as HTMLButtonElement).disabled) return;
      held = key;
      if (e.pointerType === 'touch') {
        timer = window.setTimeout(() => {
          timer = 0;
          key.classList.add('is-down');
        }, PRESS_DELAY_MS);
      } else {
        key.classList.add('is-down');
      }
    };
    const lift = () => {
      if (!held || !timer) return release();
      // A tap quicker than the wait is still a press, and now it is known not
      // to be a scroll: show it briefly rather than not at all.
      window.clearTimeout(timer);
      held.classList.add('is-down');
      timer = window.setTimeout(release, PRESS_FLASH_MS);
    };
    // The page moving under a finger ends the press, unless the app is the one
    // moving it (the glide to the explanation): a tap on Next is still a tap.
    const scrolled = () => {
      if (!gliding()) release();
    };
    document.addEventListener('pointerdown', press, { passive: true });
    document.addEventListener('pointerup', lift, { passive: true });
    document.addEventListener('pointercancel', release, { passive: true });
    document.addEventListener('scroll', scrolled, { passive: true, capture: true });
    return () => {
      release();
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('pointerup', lift);
      document.removeEventListener('pointercancel', release);
      document.removeEventListener('scroll', scrolled, { capture: true });
    };
  }, []);

  return (
    <div className="app" data-stage={stage.at} onClickCapture={dropEarlyTaps}>
      <main className="screen" key={key} ref={screen}>
        {stage.at === 'home' && <Home onOpen={gk.openPack} />}
        {stage.at === 'intro' && (
          <Intro
            pack={stage.pack}
            mode={stage.challenger ? 'challenge' : 'solo'}
            rival={stage.challenger}
            stale={stage.stale}
            onStart={gk.start}
            onBack={gk.goHome}
          />
        )}
        {stage.at === 'handoff' && (
          <Intro pack={stage.pack} mode="handoff" rival={stage.first} onStart={gk.start} onBack={gk.cancelHandoff} />
        )}
        {stage.at === 'play' && (
          <Play
            game={stage.game}
            confirmQuit={gk.quitAsked}
            onAskQuit={gk.askQuit}
            onAnswer={gk.answer}
            onNext={gk.next}
            onQuit={gk.goHome}
          />
        )}
        {stage.at === 'result' && (
          <Result
            pack={stage.pack}
            round={stage.round}
            me={stage.me}
            onPass={gk.passPhone}
            onRematch={gk.rematch}
            onHome={gk.goHome}
            onShare={share}
          />
        )}
        {stage.at === 'versus' && (
          <Versus
            pack={stage.pack}
            seed={stage.seed}
            a={stage.a}
            b={stage.b}
            mode={stage.mode}
            stale={stage.stale}
            onRematch={gk.rematch}
            onHome={gk.goHome}
            onShare={share}
          />
        )}
      </main>
      <div className="toast-slot" role="status" aria-live="polite">
        {message && (
          <p className="toast" key={message}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
