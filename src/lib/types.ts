/**
 * Core content types.
 *
 * This file and define.ts must stay runnable by plain `node` (type stripping),
 * so the pack checker needs no build step: erasable syntax only, explicit
 * `.ts` import extensions, `import type` for types.
 */

export const CATEGORIES = {
  trades: { label: 'Trades', blurb: 'Tools, sites, and things that leak' },
  kitchen: { label: 'Kitchen & Bar', blurb: 'Heat, knives, and last call' },
  money: { label: 'Money & Deals', blurb: 'Pipelines, P&L, and tenants' },
  tech: { label: 'Tech', blurb: 'Shipping it, breaking it, getting paged' },
  games: { label: 'Games & Bets', blurb: 'Edges, odds, and bad beats' },
  body: { label: 'Body & Sport', blurb: 'Reps, miles, and mat time' },
  creative: { label: 'Creative', blurb: 'Light, sound, and the timeline' },
  outdoors: { label: 'Outdoors', blurb: 'Rock, trail, and two wheels' },
} as const;

export type CategoryId = keyof typeof CATEGORIES;

/** 1 = warm-up, 2 = shop talk, 3 = deep end. */
export type Tier = 1 | 2 | 3;

/**
 * What a question is really testing:
 * - instinct: tacit judgment — what a practitioner does without thinking
 * - trap:     plain-English bait — the wording suggests an answer that is wrong
 * - math:     naive-math bait — the obvious arithmetic gives the wrong number
 * - scar:     something you only know because it burned you once
 */
export type Kind = 'instinct' | 'trap' | 'math' | 'scar';

export interface Question {
  tier: Tier;
  kind: Kind;
  /** The question, phrased the way it comes up on the job. */
  ask: string;
  /** The answer a real practitioner gives. */
  right: string;
  /** Three wrong answers. Plausible, never silly. */
  wrong: [string, string, string];
  /** Index into `wrong` of the answer an outsider gets baited into. */
  bait?: 0 | 1 | 2;
  /** One or two sentences shown after answering: why the pros say so. */
  why: string;
}

export interface Pack {
  /** kebab-case, must match the file name. */
  id: string;
  /** Display name of the skill, job, or hobby. */
  title: string;
  /** What you call someone who really does this: "tile setter", "line cook". */
  noun: string;
  category: CategoryId;
  /** The brag being tested, in the bluffer's own words. No quote marks. */
  claim: string;
  /** Search terms: synonyms, adjacent jobs, slang, tools of the trade. */
  aliases: string[];
  /** Exactly 12, four per tier. A round draws 8 of them. */
  questions: Question[];
}

export const TIER_LABEL: Record<Tier, string> = {
  1: 'Warm-up',
  2: 'Shop talk',
  3: 'Deep end',
};

export const KIND_LABEL: Record<Kind, string> = {
  instinct: 'Instincts',
  trap: 'Rookie traps',
  math: 'Napkin math',
  scar: 'Scar tissue',
};
