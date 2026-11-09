import { useCallback, useEffect, useRef, useState } from 'react';
import { getPack } from '../lib/catalog.ts';
import { CLEAN_REPORT, IntegrityTracker } from '../lib/integrity.ts';
import { newSeed } from '../lib/rng.ts';
import { packFingerprint } from '../lib/round.ts';
import { cleanName, decodeChallenge, distinctName } from '../lib/share.ts';
import { hasSeenRound, markRoundSeen, recordScore, saveName } from '../lib/storage.ts';
import { finishLocal, finishRemote, newGame } from './game.ts';
import type { Game, Stage } from './game.ts';

/**
 * Where a URL hash lands. Only three things live in the URL: home, a pack's
 * intro, and a challenge link. Everything past those (a round in progress, a
 * result) is in memory, so reloading mid-round simply starts over.
 */
export function stageForHash(hash: string): Stage {
  // Links get copied out of sentences and passed through other apps: the hash
  // can arrive percent-encoded, or with a full stop, a bracket or a tracking
  // parameter stuck on the end. Neither a pack id nor a code contains a "%".
  let raw = hash;
  try {
    raw = decodeURIComponent(hash);
  } catch {
    /* a malformed escape: read the hash as it came */
  }
  const path = raw.replace(/^#\/?/, '');
  if (!path) return { at: 'home' };
  const slash = path.indexOf('/');
  const head = slash < 0 ? path : path.slice(0, slash);
  const rest = slash < 0 ? '' : path.slice(slash + 1);

  if (head === 'p') {
    const pack = getPack(rest.match(/^[a-z0-9-]+/)?.[0] ?? '');
    return pack ? { at: 'intro', pack } : { at: 'home', notice: 'That pack is not here. Try a search.' };
  }

  if (head === 'c') {
    // Only the leading run of code characters is the code; whatever follows is ignored.
    const challenge = decodeChallenge(rest.match(/^[A-Za-z0-9_-]+/)?.[0] ?? '');
    const pack = challenge ? getPack(challenge.packId) : undefined;
    if (!challenge || !pack) return { at: 'home', notice: 'That challenge link is broken or out of date.' };
    // Someone about to play gets today's pack, so compare it with the link's.
    // A link with both results rebuilds nothing: it says for itself whether
    // the two rounds matched, and today's pack has no bearing on that.
    const stale = challenge.reply ? challenge.mixed === true : challenge.fingerprint !== packFingerprint(pack);
    const challenger = finishRemote(pack, challenge.from);
    if (challenge.reply) {
      return {
        at: 'versus',
        pack,
        seed: challenge.seed,
        a: challenger,
        b: finishRemote(pack, challenge.reply),
        mode: 'spectate',
        stale,
      };
    }
    return { at: 'intro', pack, challenge, challenger, stale };
  }

  return { at: 'home' };
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

function toTop(): void {
  if (typeof window !== 'undefined') window.scrollTo(0, 0);
}

/**
 * What the app writes on its own history entries (history.state).
 *
 * A round lives in memory, on a history entry of its own that sits directly
 * above the entry it was started from and has the same URL. Without it, the
 * system Back button would step straight off the page (or onto Home) and take
 * the round with it. With it, Back lands on the entry underneath, which is
 * still this page, and the app decides what that press means.
 */
export interface Mark {
  /** Home is the entry directly behind this pack's entry, so going home can pop to it. */
  fromHome?: boolean;
  /** This is a round's own entry. The id pairs it with the entry underneath. */
  round?: string;
  /** This entry sits directly under the round's entry with this id. */
  under?: string;
}

function mark(): Mark {
  const state: unknown = typeof window === 'undefined' ? null : window.history.state;
  return state !== null && typeof state === 'object' ? (state as Mark) : {};
}

/**
 * Write a mark (and optionally a new hash) on the current entry, or on a new
 * one. A browser may refuse (a sandboxed frame): the app then behaves as plain
 * hash links do, so say whether it worked.
 */
function writeEntry(how: 'push' | 'replace', state: Mark, hash?: string): boolean {
  try {
    if (how === 'push') window.history.pushState(state, '', hash);
    else window.history.replaceState(state, '', hash);
    return true;
  } catch {
    return false;
  }
}

/** A round in progress or what came of it: screens that live in memory, not in the URL. */
function inRound(stage: Stage): boolean {
  return stage.at === 'play' || stage.at === 'handoff' || stage.at === 'result' || (stage.at === 'versus' && stage.mode !== 'spectate');
}

/**
 * What the system Back button means when it steps off a round's entry.
 *  - ask:    a round is live. Stay on it and ask, exactly as the X does.
 *  - result: the phone is being handed over. Back to the result, as the arrow on that screen does.
 *  - home:   a result, a head-to-head or the intro for a rematch. Nothing unfinished is lost: leave.
 */
export function backOutOf(stage: Stage): 'ask' | 'result' | 'home' {
  if (stage.at === 'play') return 'ask';
  if (stage.at === 'handoff') return 'result';
  return 'home';
}

/**
 * How many entries to step back to reach Home without leaving a screen behind
 * for Back to reopen. A round's entry sits on top of the entry it was started
 * from, and Home is behind that one only if the pack was opened from Home.
 * Where the count runs out short of a Home (0 on a pack's own entry), no Home
 * is behind and that entry has to become Home itself.
 */
export function stepsHome(here: Mark): number {
  return (here.round ? 1 : 0) + (here.fromHome ? 1 : 0);
}

export interface Gatekeep {
  stage: Stage;
  /** True while the "Walk away mid-round?" sheet is up. The X opens it, and so does system Back. */
  quitAsked: boolean;
  askQuit(open: boolean): void;
  /** Go to a pack's intro, and put it in the URL so it can be shared or reloaded. */
  openPack(id: string): void;
  /** Back to all packs, without leaving the screen being left in history. */
  goHome(): void;
  /** Begin the round described by the current intro or handoff stage. */
  start(name: string): void;
  /** Answer the live question. Ignored if it has already been answered. */
  answer(choiceId: number): void;
  /** Continue after a reveal: the next question, or the result. */
  next(): void;
  /** From a result: hand the phone to someone else for the same eight questions. */
  passPhone(): void;
  /** Back out of the handoff screen to the result. */
  cancelHandoff(): void;
  /** Same pack, fresh questions. */
  rematch(): void;
}

export function useGatekeep(): Gatekeep {
  const [stage, setStage] = useState<Stage>(() => stageForHash(currentHash()));
  const [quitAsked, setQuitAsked] = useState(false);
  // Actions read the latest stage through a ref, updated synchronously by
  // `go`, so a fast double tap can never act on a stale stage.
  const stageRef = useRef(stage);
  const tracker = useRef<IntegrityTracker | null>(null);
  const detach = useRef<(() => void) | null>(null);
  // Set when we change the hash ourselves and have already set the stage.
  const selfNavigation = useRef(false);
  // The round's entry we were on at the last history event, if we were on one.
  const wasOn = useRef<string | null>(mark().round ?? null);
  // Set while Back off a live round is being undone (one step forward again).
  const bouncing = useRef(false);
  // A result that system Back walked away from. Forward onto its entry puts it back.
  const parked = useRef<{ id: string; stage: Stage } | null>(null);

  const go = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const stopTracking = useCallback(() => {
    detach.current?.();
    detach.current = null;
    tracker.current = null;
  }, []);

  /** Turn the current entry into Home: for when no Home entry is behind it to go back to. */
  const becomeHome = useCallback((here: Mark) => {
    if (writeEntry('replace', here, '#/')) return;
    if ((currentHash() || '#/') !== '#/') {
      selfNavigation.current = true;
      window.location.hash = '#/';
    }
  }, []);

  useEffect(() => {
    const onHash = () => {
      if (selfNavigation.current) {
        selfNavigation.current = false;
        return;
      }
      const s = stageRef.current;
      // A round's entry and the one under it can differ in hash. Stepping
      // between them (see onPop) says nothing new: the round stays.
      if (bouncing.current || (mark().round !== undefined && inRound(s))) return;
      const next = stageForHash(currentHash());
      // "Back to all packs" shows Home at once and lets history catch up.
      if (next.at === 'home' && !next.notice && s.at === 'home') return;
      // Back or forward by more than a step, or a pasted link: whatever was in progress is over.
      stopTracking();
      setQuitAsked(false);
      go(next);
      toTop();
    };

    const onPop = () => {
      const here = mark();
      const left = wasOn.current;
      wasOn.current = here.round ?? null;
      bouncing.current = false;
      const s = stageRef.current;

      if (here.round) {
        // Forward onto a round's entry that Back walked away from: its result is still good.
        if (parked.current?.id === here.round && !inRound(s)) {
          const back = parked.current.stage;
          parked.current = null;
          go(back);
          toTop();
        }
        return;
      }
      // Anything but one step back off a round's entry is ordinary navigation: the hash says where we are.
      if (!left || here.under !== left) return;

      const press = backOutOf(s);
      if (press === 'home') {
        if (s.at === 'result' || s.at === 'versus') parked.current = { id: left, stage: s };
        // This entry is the one the round was started from. Home is behind it, or it becomes Home.
        const back = stepsHome(here);
        if (back > 0) window.history.go(-back);
        else becomeHome(here);
        if (s.at !== 'home') {
          stopTracking();
          go({ at: 'home' });
          toTop();
        }
        return;
      }
      // Never leave a live round without asking: step forward onto its entry again.
      bouncing.current = true;
      window.history.forward();
      if (press === 'ask') {
        // Back with the sheet already up closes it, as it would any dialog.
        setQuitAsked((open) => !open);
      } else if (s.at === 'handoff') {
        go({ at: 'result', pack: s.pack, round: s.round, me: s.first });
        toTop();
      }
    };

    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onPop);
      stopTracking();
    };
  }, [go, stopTracking, becomeHome]);

  /** Show `next` at `hash`. Returns true when that took a new history entry. */
  const navigate = useCallback(
    (hash: string, next: Stage): boolean => {
      stopTracking();
      setQuitAsked(false);
      const here = currentHash() || '#/';
      const pushed = here !== hash;
      if (pushed) {
        selfNavigation.current = true;
        window.location.hash = hash;
        wasOn.current = null;
        parked.current = null;
      }
      go(next);
      toTop();
      return pushed;
    },
    [go, stopTracking],
  );

  const openPack = useCallback(
    (id: string) => {
      const pack = getPack(id);
      if (!pack) return;
      const behind = stageForHash(currentHash());
      const fromHome = stageRef.current.at === 'home' && behind.at === 'home' && !behind.notice;
      const pushed = navigate(`#/p/${pack.id}`, { at: 'intro', pack });
      // Mark the entry just pushed: Home is exactly one step behind it.
      if (fromHome && pushed) writeEntry('replace', { fromHome: true });
    },
    [navigate],
  );

  const goHome = useCallback(() => {
    if (stageRef.current.at === 'home') return; // a second tap must not go back twice
    stopTracking();
    setQuitAsked(false);
    parked.current = null;
    // Pop back to Home rather than push another one, or system Back on Home
    // would reopen every screen that was closed with the app's own controls.
    const here = mark();
    const back = stepsHome(here);
    if (back > 0) window.history.go(-back); // if that lands short of a Home, onPop finishes the job
    else becomeHome(here);
    go({ at: 'home' });
    toTop();
  }, [go, stopTracking, becomeHome]);

  const begin = useCallback(
    (game: Game, seenBefore = false) => {
      stopTracking();
      const t = new IntegrityTracker();
      tracker.current = t;
      detach.current = t.attach();
      if (seenBefore) t.seenBefore();
      t.startQuestion(game.round.questions[0]?.kind === 'math');
      // The round gets a history entry of its own, unless it is already on one
      // (the second player of a handoff, a rematch, a reload).
      if (!mark().round) {
        const here = mark();
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        try {
          // Stepping between the two entries must not move the page.
          window.history.scrollRestoration = 'manual';
        } catch {
          /* not supported here: fine */
        }
        if (writeEntry('replace', { ...here, under: id })) {
          writeEntry('push', here.fromHome ? { fromHome: true, round: id } : { round: id });
        }
      }
      wasOn.current = mark().round ?? null;
      parked.current = null;
      setQuitAsked(false);
      go({ at: 'play', game });
      toTop();
    },
    [go, stopTracking],
  );

  const start = useCallback(
    (rawName: string) => {
      const s = stageRef.current;
      if (s.at === 'intro') {
        // Remember only a name somebody typed: never a stand-in, and never the
        // "2" added below. Either would be prefilled for the next round.
        const typed = cleanName(rawName, '');
        if (typed) saveName(typed);
        let name = typed || (s.challenger ? 'Challenger' : 'Player');
        if (s.challenger) name = distinctName(name, s.challenger.attempt.name);
        const fresh = newGame(s.pack, s.challenge ? s.challenge.seed : newSeed(), name);
        // A challenge link always rebuilds the same round. If this device has
        // already been shown answers to it, that goes on the result.
        const seenBefore = s.challenge ? hasSeenRound(s.pack.id, s.challenge.seed) : false;
        begin(s.challenger ? { ...fresh, opponent: s.challenger, via: 'link', stale: s.stale } : fresh, seenBefore);
      } else if (s.at === 'handoff') {
        // Passing the phone shares a round on one device by design: no note for that.
        const name = distinctName(cleanName(rawName, 'Challenger'), s.first.attempt.name);
        const game: Game = {
          pack: s.pack,
          round: s.round,
          name,
          opponent: s.first,
          via: 'handoff',
          index: 0,
          phase: 'asking',
          choices: [],
          times: [],
        };
        begin(game);
      }
    },
    [begin],
  );

  const answer = useCallback(
    (choiceId: number) => {
      const s = stageRef.current;
      if (s.at !== 'play' || s.game.phase !== 'asking') return;
      const ms = tracker.current?.endQuestion() ?? 0;
      // The reveal shows the right answer: from here on this device has seen the round.
      markRoundSeen(s.game.pack.id, s.game.round.seed);
      go({
        at: 'play',
        game: { ...s.game, phase: 'revealed', choices: [...s.game.choices, choiceId], times: [...s.game.times, ms] },
      });
    },
    [go],
  );

  const next = useCallback(() => {
    const s = stageRef.current;
    if (s.at !== 'play' || s.game.phase !== 'revealed') return;
    const { game } = s;
    const upcoming = game.index + 1;

    if (upcoming < game.round.questions.length) {
      tracker.current?.startQuestion(game.round.questions[upcoming]!.kind === 'math');
      go({ at: 'play', game: { ...game, index: upcoming, phase: 'asking' } });
      toTop();
      return;
    }

    const seconds = Math.round(game.times.reduce((a, b) => a + b, 0) / 1000);
    const integrity = tracker.current?.report() ?? { ...CLEAN_REPORT };
    stopTracking();
    const me = finishLocal(game.pack, game.round, game.name, game.choices, seconds, integrity);
    recordScore(game.pack.id, me.score, me.flagged);

    if (game.opponent) {
      go({
        at: 'versus',
        pack: game.pack,
        seed: game.round.seed,
        a: game.opponent,
        b: me,
        mode: game.via === 'link' ? 'reply' : 'here',
        stale: game.stale,
      });
    } else {
      go({ at: 'result', pack: game.pack, round: game.round, me });
    }
    toTop();
  }, [go, stopTracking]);

  const passPhone = useCallback(() => {
    const s = stageRef.current;
    if (s.at !== 'result') return;
    go({ at: 'handoff', pack: s.pack, round: s.round, first: s.me });
    toTop();
  }, [go]);

  const cancelHandoff = useCallback(() => {
    const s = stageRef.current;
    if (s.at !== 'handoff') return;
    go({ at: 'result', pack: s.pack, round: s.round, me: s.first });
    toTop();
  }, [go]);

  const rematch = useCallback(() => {
    const s = stageRef.current;
    if (s.at === 'home') return;
    const pack = s.at === 'play' ? s.game.pack : s.pack;
    navigate(`#/p/${pack.id}`, { at: 'intro', pack });
  }, [navigate]);

  return { stage, quitAsked, askQuit: setQuitAsked, openPack, goHome, start, answer, next, passPhone, cancelHandoff, rematch };
}
