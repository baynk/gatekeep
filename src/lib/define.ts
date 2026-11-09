import { CATEGORIES } from './types.ts';
import type { Kind, Pack, Question, Tier } from './types.ts';

/** Identity helper that gives pack files full type checking and autocomplete. */
export function definePack(pack: Pack): Pack {
  return pack;
}

export const QUESTIONS_PER_PACK = 12;
export const QUESTIONS_PER_TIER = 4;

const KIND_MINIMUM: Record<Kind, number> = { trap: 3, math: 2, instinct: 2, scar: 2 };
const MIN_BAITS = 7;
const BANNED_OPTION = /\b(all|none) of the above\b|\bboth a and b\b|\bboth of these\b/i;

function between(label: string, value: string, min: number, max: number, out: string[]): void {
  const n = value.trim().length;
  if (n < min || n > max) out.push(`${label} is ${n} chars (want ${min}-${max})`);
  if (value !== value.trim()) out.push(`${label} has leading or trailing whitespace`);
}

/**
 * Structural checks for a pack. Returns human-readable problems; empty means
 * the pack is safe to ship. Used by the test suite, by `npm run check:packs`,
 * and (in dev) at catalog load.
 *
 * It cannot tell whether an answer is true. That is on the author.
 */
export function validatePack(pack: Pack, fileId?: string): string[] {
  const out: string[] = [];

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pack.id)) out.push(`id "${pack.id}" is not kebab-case`);
  if (fileId !== undefined && fileId !== pack.id) out.push(`id "${pack.id}" does not match file name "${fileId}"`);
  if (!(pack.category in CATEGORIES)) out.push(`unknown category "${pack.category}"`);
  between('title', pack.title, 3, 34, out);
  between('noun', pack.noun, 3, 28, out);
  between('claim', pack.claim, 12, 80, out);
  if (/["“”]/.test(pack.claim)) out.push('claim should not contain quote marks (the UI adds them)');
  if (pack.aliases.length < 6) out.push(`only ${pack.aliases.length} aliases (want 6+ search terms)`);
  if (pack.aliases.some((a) => a !== a.toLowerCase())) out.push('aliases must be lowercase');

  const qs = pack.questions;
  if (qs.length !== QUESTIONS_PER_PACK) out.push(`${qs.length} questions (want exactly ${QUESTIONS_PER_PACK})`);

  for (const tier of [1, 2, 3] as Tier[]) {
    const n = qs.filter((q) => q.tier === tier).length;
    if (n !== QUESTIONS_PER_TIER) out.push(`tier ${tier} has ${n} questions (want ${QUESTIONS_PER_TIER})`);
  }
  for (const kind of Object.keys(KIND_MINIMUM) as Kind[]) {
    const n = qs.filter((q) => q.kind === kind).length;
    if (n < KIND_MINIMUM[kind]) out.push(`only ${n} "${kind}" questions (want ${KIND_MINIMUM[kind]}+)`);
  }
  const baits = qs.filter((q) => q.bait !== undefined).length;
  if (baits < MIN_BAITS) out.push(`only ${baits} questions mark a bait answer (want ${MIN_BAITS}+)`);

  const asks = new Set<string>();
  let rightIsLongest = 0;
  let rightIsShortest = 0;
  let rightChars = 0;
  let wrongChars = 0;

  qs.forEach((q: Question, i) => {
    const at = `q${i + 1}`;
    if (![1, 2, 3].includes(q.tier)) out.push(`${at}: bad tier ${String(q.tier)}`);
    if (!(q.kind in KIND_MINIMUM)) out.push(`${at}: bad kind "${String(q.kind)}"`);
    between(`${at}.ask`, q.ask, 40, 260, out);
    between(`${at}.right`, q.right, 1, 80, out);
    between(`${at}.why`, q.why, 30, 240, out);
    if (!Array.isArray(q.wrong) || q.wrong.length !== 3) {
      out.push(`${at}: needs exactly 3 wrong answers`);
      return;
    }
    q.wrong.forEach((w, j) => between(`${at}.wrong[${j}]`, w, 1, 80, out));

    const options = [q.right, ...q.wrong];
    const norm = options.map((o) => o.trim().toLowerCase());
    if (new Set(norm).size !== 4) out.push(`${at}: duplicate answer options`);
    if (options.some((o) => BANNED_OPTION.test(o))) out.push(`${at}: "all/none of the above" style option`);

    if (q.bait !== undefined && ![0, 1, 2].includes(q.bait)) out.push(`${at}: bait must be 0, 1 or 2`);
    if ((q.kind === 'trap' || q.kind === 'math') && q.bait === undefined) {
      out.push(`${at}: "${q.kind}" questions must mark which wrong answer is the bait`);
    }

    const key = q.ask.trim().toLowerCase();
    if (asks.has(key)) out.push(`${at}: duplicate question`);
    asks.add(key);

    const wrongLens = q.wrong.map((w) => w.length);
    if (q.right.length > Math.max(...wrongLens)) rightIsLongest++;
    if (q.right.length < Math.min(...wrongLens)) rightIsShortest++;
    rightChars += q.right.length;
    wrongChars += wrongLens.reduce((a, b) => a + b, 0) / 3;
  });

  // Length is the classic test-taker tell. Keep the right answer from standing out.
  if (rightIsLongest > 4) out.push(`right answer is the longest option in ${rightIsLongest} questions (max 4): a bluffer can just pick the long one`);
  if (rightIsShortest > 5) out.push(`right answer is the shortest option in ${rightIsShortest} questions (max 5)`);
  if (wrongChars > 0 && rightChars / wrongChars > 1.3) {
    out.push(`right answers average ${(rightChars / wrongChars).toFixed(2)}x the length of wrong ones (max 1.30x)`);
  }
  if (wrongChars > 0 && rightChars / wrongChars < 0.72) {
    out.push(`right answers average ${(rightChars / wrongChars).toFixed(2)}x the length of wrong ones (min 0.72x)`);
  }

  return out;
}
