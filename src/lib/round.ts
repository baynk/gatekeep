import { hashString, mulberry32, shuffled } from './rng.ts';
import type { Kind, Pack, Tier } from './types.ts';

/** How many questions a round draws from each tier: 2 warm-up, 3 shop talk, 3 deep end. */
export const ROUND_SHAPE: Record<Tier, number> = { 1: 2, 2: 3, 3: 3 };
/** Points per question by tier. 2x8 + 3x12 + 3x16 = 100, so the score needs no scaling. */
export const TIER_POINTS: Record<Tier, number> = { 1: 8, 2: 12, 3: 16 };
export const ROUND_LENGTH = ROUND_SHAPE[1] + ROUND_SHAPE[2] + ROUND_SHAPE[3];

/** The tier of each question by position in a round: [1, 1, 2, 2, 2, 3, 3, 3]. */
export const TIER_SEQUENCE: Tier[] = ([1, 2, 3] as Tier[]).flatMap((t) => Array.from({ length: ROUND_SHAPE[t] }, () => t));

export type Role = 'right' | 'bait' | 'wrong';

export interface RoundOption {
  /** Stable id within the question: 0 is the right answer, 1-3 are wrong[0..2]. */
  id: number;
  text: string;
  role: Role;
}

export interface RoundQuestion {
  /** Index into pack.questions. */
  source: number;
  tier: Tier;
  kind: Kind;
  ask: string;
  why: string;
  points: number;
  /** In display order (already shuffled). */
  options: RoundOption[];
}

export interface Round {
  packId: string;
  seed: number;
  questions: RoundQuestion[];
}

/**
 * A short fingerprint of a pack's questions. A challenge link carries it so we
 * can tell when the pack has been edited since the link was made and the two
 * rounds are no longer the same eight questions.
 */
export function packFingerprint(pack: Pack): string {
  const text = pack.questions.map((q) => `${q.tier}|${q.ask}|${q.right}|${q.wrong.join('|')}`).join('\n');
  return hashString(text).toString(36);
}

/**
 * Build the round for (pack, seed). Pure and deterministic: the same inputs
 * give the same questions, in the same order, with the same answer positions,
 * on any device. That is what makes a head-to-head fair.
 */
export function buildRound(pack: Pack, seed: number): Round {
  const pick = mulberry32((hashString(pack.id) ^ seed) >>> 0);
  const questions: RoundQuestion[] = [];

  for (const tier of [1, 2, 3] as Tier[]) {
    const pool = pack.questions.map((q, i) => ({ q, i })).filter(({ q }) => q.tier === tier);
    const drawn = shuffled(pool, pick).slice(0, ROUND_SHAPE[tier]);
    for (const { q, i } of drawn) {
      // Answer order gets its own stream so it does not depend on draw order.
      const order = mulberry32(hashString(`${pack.id}:${seed}:${i}`));
      const options: RoundOption[] = shuffled(
        [
          { id: 0, text: q.right, role: 'right' as Role },
          ...q.wrong.map((text, j) => ({ id: j + 1, text, role: (q.bait === j ? 'bait' : 'wrong') as Role })),
        ],
        order,
      );
      questions.push({ source: i, tier, kind: q.kind, ask: q.ask, why: q.why, points: TIER_POINTS[tier], options });
    }
  }
  return { packId: pack.id, seed, questions };
}

/** hit = right, trap = picked the bait, miss = any other wrong answer. */
export type Outcome = 'hit' | 'trap' | 'miss';

export function outcomeOf(question: RoundQuestion, choiceId: number): Outcome {
  if (choiceId === 0) return 'hit';
  const picked = question.options.find((o) => o.id === choiceId);
  return picked?.role === 'bait' ? 'trap' : 'miss';
}

/**
 * Score from outcomes alone. Every round has the same tier at each position,
 * so a friend's score can be recomputed from their link without the pack.
 */
export function scoreOutcomes(outcomes: readonly Outcome[]): number {
  return outcomes.reduce((n, o, i) => n + (o === 'hit' ? TIER_POINTS[TIER_SEQUENCE[i] ?? 1] : 0), 0);
}

export interface Tally {
  got: number;
  of: number;
}

export interface Scorecard {
  /** 0-100. */
  score: number;
  outcomes: Outcome[];
  correct: number;
  byTier: Record<Tier, Tally>;
  /** Only kinds that appeared in this round, in a stable order. */
  byKind: { kind: Kind; got: number; of: number; baited: number }[];
  /** Questions in this round that had a bait answer, and how many times it was taken. */
  trapsSet: number;
  trapsTaken: number;
}

const KIND_ORDER: Kind[] = ['instinct', 'trap', 'math', 'scar'];

/** `choices[i]` is the option id picked for question i (0 = right). */
export function scoreRound(round: Round, choices: readonly number[]): Scorecard {
  const byTier: Record<Tier, Tally> = { 1: { got: 0, of: 0 }, 2: { got: 0, of: 0 }, 3: { got: 0, of: 0 } };
  const kinds = new Map<Kind, { got: number; of: number; baited: number }>();
  const outcomes: Outcome[] = [];
  let score = 0;
  let correct = 0;
  let trapsSet = 0;
  let trapsTaken = 0;

  round.questions.forEach((q, i) => {
    const outcome = outcomeOf(q, choices[i] ?? -1);
    outcomes.push(outcome);
    const kind = kinds.get(q.kind) ?? { got: 0, of: 0, baited: 0 };
    kind.of++;
    byTier[q.tier].of++;
    if (q.options.some((o) => o.role === 'bait')) trapsSet++;
    if (outcome === 'hit') {
      score += q.points;
      correct++;
      kind.got++;
      byTier[q.tier].got++;
    } else if (outcome === 'trap') {
      trapsTaken++;
      kind.baited++;
    }
    kinds.set(q.kind, kind);
  });

  const byKind = KIND_ORDER.filter((k) => kinds.has(k)).map((kind) => ({ kind, ...kinds.get(kind)! }));
  return { score, outcomes, correct, byTier, byKind, trapsSet, trapsTaken };
}

// ── Verdicts ────────────────────────────────────────────────────────────

export type Band = 'certified' | 'legit' | 'weekend' | 'theory' | 'exposed';

export interface Verdict {
  band: Band;
  /** "Legit bartender" */
  title: string;
  /** One dry line under it. */
  line: string;
  passed: boolean;
}

/** "a tile setter", "an electrician", "an SRE". */
export function withArticle(noun: string): string {
  const first = noun.trim().split(/\s+/)[0] ?? '';
  const isAcronym = first.length > 1 && first === first.toUpperCase();
  const vowelSound = isAcronym ? /^[AEFHILMNORSX]/.test(first) : /^[aeiou]/i.test(first);
  return `${vowelSound ? 'an' : 'a'} ${noun}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function bandFor(score: number): Band {
  if (score >= 90) return 'certified';
  if (score >= 70) return 'legit';
  if (score >= 50) return 'weekend';
  if (score >= 30) return 'theory';
  return 'exposed';
}

export function verdictFor(score: number, noun: string): Verdict {
  const band = bandFor(score);
  switch (band) {
    case 'certified':
      return { band, passed: true, title: `Certified ${noun}`, line: 'Nobody fakes this. Hand over the keys.' };
    case 'legit':
      return { band, passed: true, title: `Legit ${noun}`, line: 'A few gaps, but the hours are real.' };
    case 'weekend':
      return { band, passed: false, title: `Weekend ${noun}`, line: 'Has done it. Has also watched a lot of videos about it.' };
    case 'theory':
      return { band, passed: false, title: `${capitalize(noun)} in theory`, line: 'Great vocabulary. Suspiciously clean hands.' };
    default:
      return { band, passed: false, title: `Not ${withArticle(noun)}`, line: 'Exposed. Confidently and repeatedly.' };
  }
}

/**
 * Up to three short lines on how they passed or got exposed. The breakdown
 * table says what happened; these say what it means.
 */
export function highlights(card: Scorecard): string[] {
  const out: string[] = [];
  const { byTier, trapsSet, trapsTaken } = card;

  if (card.correct === card.outcomes.length) out.push('A clean sheet. Every single one.');
  else if (card.correct === 0) out.push('Zero for eight. That takes commitment.');

  if (byTier[3].of > 0 && byTier[3].got === byTier[3].of && card.correct !== card.outcomes.length) {
    out.push('Cleared the deep end without getting wet.');
  }
  if (byTier[1].of > 0 && byTier[1].got < byTier[1].of && card.correct !== 0) {
    out.push(byTier[1].got === 0 ? 'Missed both warm-ups. The warm-ups.' : 'Dropped a warm-up question. A warm-up.');
  }
  if (trapsSet >= 2 && card.correct !== card.outcomes.length && card.correct !== 0) {
    if (trapsTaken === 0) out.push('Did not bite on a single rookie trap.');
    else if (trapsTaken === 1) out.push('Walked into one rookie trap.');
    else out.push(`Walked into ${trapsTaken} rookie traps. Outsider answers.`);
  }
  if (byTier[3].of > 0 && byTier[3].got === 0 && card.correct !== 0) {
    out.push('Went under in the deep end: none of the hard ones.');
  }
  const math = card.byKind.find((k) => k.kind === 'math');
  if (math && math.of >= 2 && math.got === 0) out.push('The napkin math did not survive the napkin.');

  return out.slice(0, 3);
}
