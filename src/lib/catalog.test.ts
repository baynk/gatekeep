import { describe, expect, it } from 'vitest';
import { ACTIVE_CATEGORIES, PACKS, QUESTION_COUNT, getPack, searchPacks } from './catalog.ts';
import { validatePack } from './define.ts';
import { ROUND_LENGTH, buildRound, scoreRound } from './round.ts';
import { normalize } from './search.ts';
import { CATEGORIES } from './types.ts';

describe('the catalog', () => {
  it('has a broad library', () => {
    expect(PACKS.length).toBeGreaterThanOrEqual(30);
    expect(QUESTION_COUNT).toBe(PACKS.length * 12);
    expect(ACTIVE_CATEGORIES.length).toBe(Object.keys(CATEGORIES).length);
  });

  it('has unique ids and titles', () => {
    expect(new Set(PACKS.map((p) => p.id)).size).toBe(PACKS.length);
    expect(new Set(PACKS.map((p) => p.title)).size).toBe(PACKS.length);
    for (const p of PACKS) expect(getPack(p.id)).toBe(p);
  });

  it.each(PACKS.map((p) => [p.id, p] as const))('pack %s passes validation', (_id, pack) => {
    expect(validatePack(pack)).toEqual([]);
  });

  it('never repeats a question across packs', () => {
    const seen = new Map<string, string>();
    for (const p of PACKS) {
      for (const q of p.questions) {
        const key = normalize(q.ask);
        expect(seen.get(key), `"${q.ask}" appears in ${seen.get(key)} and ${p.id}`).toBeUndefined();
        seen.set(key, p.id);
      }
    }
  });

  it('builds a full, playable round from every pack for many seeds', () => {
    for (const p of PACKS) {
      for (let seed = 1; seed <= 25; seed++) {
        const round = buildRound(p, seed);
        expect(round.questions).toHaveLength(ROUND_LENGTH);
        expect(scoreRound(round, round.questions.map(() => 0)).score).toBe(100);
      }
    }
  });

  it('keeps copy free of things that break the voice', () => {
    for (const p of PACKS) {
      const text = [p.title, p.claim, ...p.questions.flatMap((q) => [q.ask, q.right, ...q.wrong, q.why])].join('\n');
      expect(text, `${p.id} has an exclamation mark`).not.toMatch(/!/);
      expect(text, `${p.id} has an em dash`).not.toMatch(/—/);
      expect(text, `${p.id} has an emoji`).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('search', () => {
  const top = (q: string) => searchPacks(q)[0]?.id;

  it('returns everything for an empty query', () => {
    expect(searchPacks('')).toHaveLength(PACKS.length);
    expect(searchPacks('   ')).toHaveLength(PACKS.length);
  });

  it('finds packs by title, noun and alias', () => {
    expect(top('bartending')).toBe('bartending');
    expect(top('bartender')).toBe('bartending');
    expect(top('tile')).toBe('bathroom-tile');
    expect(top('grout')).toBe('bathroom-tile');
    expect(top('poker')).toBe('poker');
    expect(top('electrician')).toBe('home-electrical');
  });

  it('forgives typos and partial words', () => {
    expect(top('bartendr')).toBe('bartending');
    expect(top('bartnding')).toBe('bartending');
    expect(top('pokr')).toBe('poker');
    expect(top('tili')).toBe('bathroom-tile');
    expect(top('BATHROOM   TILE')).toBe('bathroom-tile');
  });

  it('requires every word to match something', () => {
    expect(searchPacks('poker zzzzqqq')).toEqual([]);
    expect(searchPacks('xyzzyplugh')).toEqual([]);
  });

  it('filters by category', () => {
    const kitchen = searchPacks('', { category: 'kitchen' });
    expect(kitchen.length).toBeGreaterThan(0);
    expect(kitchen.every((p) => p.category === 'kitchen')).toBe(true);
    expect(searchPacks('poker', { category: 'kitchen' })).toEqual([]);
    expect(searchPacks('poker', { category: 'all' })[0]?.id).toBe('poker');
  });

  it('ignores filler words in a natural phrase', () => {
    expect(top('i am a bartender')).toBe('bartending');
  });
});
