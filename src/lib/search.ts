import { CATEGORIES } from './types.ts';
import type { CategoryId, Pack } from './types.ts';

/**
 * Catalog search. Small, dependency-free, typo-tolerant: people type things
 * like "bartendr", "tiling", "sdr" or "poker" and expect the right pack.
 */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface Field {
  weight: number;
  words: string[];
}

interface Entry {
  pack: Pack;
  fields: Field[];
}

const STOP = new Set([
  'a', 'an', 'the', 'and', 'of', 'at', 'to', 'in', 'is', 'im', 'i', 'am', 'my', 'for', 'on',
  'he', 'she', 'they', 'hes', 'shes', 'says', 'good', 'great', 'really',
]);

function words(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean);
}

export function buildIndex(packs: readonly Pack[]): Entry[] {
  return packs.map((pack) => ({
    pack,
    fields: [
      { weight: 10, words: words(pack.title) },
      { weight: 8, words: words(pack.noun) },
      { weight: 6, words: pack.aliases.flatMap(words) },
      { weight: 3, words: words(CATEGORIES[pack.category].label) },
      { weight: 2, words: words(pack.claim).filter((w) => !STOP.has(w)) },
    ],
  }));
}

/** Edit distance with an early exit once it exceeds `max`. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length]! <= max;
}

/** How well a typed token matches one indexed word, 0-1. */
function wordScore(token: string, word: string): number {
  if (word === token) return 1;
  if (word.startsWith(token)) return token.length === 1 ? 0.3 : 0.8;
  if (token.length >= 3 && word.includes(token)) return 0.5;
  if (token.length >= 4) {
    // One typo, or a typo in a prefix ("bartendr" -> "bartending").
    if (within(token, word, 1)) return 0.45;
    if (word.length > token.length && within(token, word.slice(0, token.length), 1)) return 0.4;
  }
  return 0;
}

function entryScore(entry: Entry, tokens: string[]): number {
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of entry.fields) {
      for (const word of field.words) {
        const s = wordScore(token, word) * field.weight;
        if (s > best) best = s;
      }
    }
    if (best === 0) return 0; // every token has to land somewhere
    total += best;
  }
  return total;
}

export interface SearchOptions {
  category?: CategoryId | 'all';
}

/** Ranked packs for a query. An empty query returns everything in catalog order. */
export function searchIndex(index: readonly Entry[], query: string, opts: SearchOptions = {}): Pack[] {
  const inCategory = index.filter((e) => !opts.category || opts.category === 'all' || e.pack.category === opts.category);
  const all = words(query);
  const meaningful = all.filter((w) => !STOP.has(w));
  const tokens = meaningful.length ? meaningful : all;
  if (!tokens.length) return inCategory.map((e) => e.pack);
  return inCategory
    .map((entry) => ({ entry, score: entryScore(entry, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.pack.title.localeCompare(b.entry.pack.title))
    .map((r) => r.entry.pack);
}
