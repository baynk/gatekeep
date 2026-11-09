import { isFlagged } from '../lib/integrity.ts';
import type { IntegrityReport } from '../lib/integrity.ts';
import { buildRound, packFingerprint, scoreOutcomes, scoreRound, verdictFor } from '../lib/round.ts';
import type { Round, Scorecard, Verdict } from '../lib/round.ts';
import type { Attempt, Challenge } from '../lib/share.ts';
import type { Pack } from '../lib/types.ts';

/**
 * A finished attempt plus what is derived from it. `card` (the per-kind and
 * per-tier breakdown) exists only for attempts played on this device; someone
 * who arrives in a link has a score, a verdict and their tiles.
 */
export interface Finished {
  attempt: Attempt;
  score: number;
  verdict: Verdict;
  /** True when the result carries an asterisk. */
  flagged: boolean;
  card?: Scorecard;
  /** Option id picked for each question. Local attempts only: links never carry answers. */
  choices?: number[];
}

/** Score an attempt that was just played here. */
export function finishLocal(
  pack: Pack,
  round: Round,
  name: string,
  choices: readonly number[],
  seconds: number,
  integrity: IntegrityReport,
): Finished {
  const card = scoreRound(round, choices);
  const attempt: Attempt = { name, outcomes: card.outcomes, seconds, integrity };
  return {
    attempt,
    card,
    choices: [...choices],
    score: card.score,
    verdict: verdictFor(card.score, pack.noun),
    flagged: isFlagged(integrity),
  };
}

/** Rebuild someone else's result from what their link carried. */
export function finishRemote(pack: Pack, attempt: Attempt): Finished {
  const score = scoreOutcomes(attempt.outcomes);
  return { attempt, score, verdict: verdictFor(score, pack.noun), flagged: isFlagged(attempt.integrity) };
}

/** A round in progress. */
export interface Game {
  pack: Pack;
  round: Round;
  name: string;
  /** Someone this attempt will be compared against when it ends. */
  opponent?: Finished;
  /** How the opponent got here: handed the phone, or a link. */
  via?: 'handoff' | 'link';
  /** True when the pack changed after the opponent's link was made. */
  stale?: boolean;
  index: number;
  /** 'asking' until they tap, then 'revealed' until they continue. */
  phase: 'asking' | 'revealed';
  /** Option id picked for each answered question (0 = right). */
  choices: number[];
  /** Milliseconds each answered question took. */
  times: number[];
}

export function newGame(pack: Pack, seed: number, name: string): Game {
  return { pack, round: buildRound(pack, seed), name, index: 0, phase: 'asking', choices: [], times: [] };
}

export type Stage =
  | { at: 'home'; notice?: string }
  | { at: 'intro'; pack: Pack; challenge?: Challenge; challenger?: Finished; stale?: boolean }
  | { at: 'play'; game: Game }
  | { at: 'result'; pack: Pack; round: Round; me: Finished }
  | { at: 'handoff'; pack: Pack; round: Round; first: Finished }
  | {
      at: 'versus';
      pack: Pack;
      /** The shared seed, so a reply link can be made. */
      seed: number;
      /** Whoever went first (or sent the link). */
      a: Finished;
      b: Finished;
      /**
       * here     = both played on this phone
       * reply    = I just answered someone's link
       * spectate = opened a link that already has both results
       */
      mode: 'here' | 'reply' | 'spectate';
      /**
       * True when the pack changed between the two rounds, so the questions
       * differed. A link that carries both results says so itself.
       */
      stale?: boolean;
    };

/**
 * `mixed` is for a link that carries both results: true when the pack changed
 * between the two rounds. The link has to say so itself, because its
 * fingerprint is the pack as the second player had it and says nothing about
 * the first.
 */
export function challengeFor(pack: Pack, seed: number, from: Finished, reply?: Finished, mixed = false): Challenge {
  const challenge: Challenge = {
    packId: pack.id,
    seed,
    fingerprint: packFingerprint(pack),
    from: from.attempt,
    reply: reply?.attempt,
  };
  if (reply && mixed) challenge.mixed = true;
  return challenge;
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export interface VersusSummary {
  /** "Jo wins by 16" or "Dead even" */
  headline: string;
  winner: 'a' | 'b' | null;
  /** 1-based question numbers where one was right and the other was not. */
  split: number[];
  /** "They disagreed on questions 3, 4 and 7." */
  splitLine: string;
}

function list(nums: number[]): string {
  if (nums.length <= 1) return nums.join('');
  return `${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`;
}

export function summarizeVersus(a: Finished, b: Finished): VersusSummary {
  const diff = a.score - b.score;
  const winner = diff === 0 ? null : diff > 0 ? 'a' : 'b';
  const headline = winner === null ? 'Dead even' : `${(winner === 'a' ? a : b).attempt.name} wins by ${Math.abs(diff)}`;
  const split: number[] = [];
  a.attempt.outcomes.forEach((o, i) => {
    if ((o === 'hit') !== (b.attempt.outcomes[i] === 'hit')) split.push(i + 1);
  });
  const splitLine =
    split.length === 0
      ? 'They got exactly the same ones right.'
      : `They disagreed on question${split.length === 1 ? '' : 's'} ${list(split)}.`;
  return { headline, winner, split, splitLine };
}
