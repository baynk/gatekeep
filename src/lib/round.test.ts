import { describe, expect, it } from 'vitest';
import tile from '../packs/bathroom-tile.ts';
import {
  ROUND_LENGTH,
  ROUND_SHAPE,
  bandFor,
  buildRound,
  highlights,
  outcomeOf,
  packFingerprint,
  scoreRound,
  verdictFor,
  withArticle,
} from './round.ts';
import type { Tier } from './types.ts';

describe('buildRound', () => {
  it('is deterministic for a pack and seed', () => {
    expect(buildRound(tile, 12345)).toEqual(buildRound(tile, 12345));
  });

  it('gives different rounds for different seeds', () => {
    const asks = (seed: number) => buildRound(tile, seed).questions.map((q) => q.source + ':' + q.options.map((o) => o.id).join(''));
    const distinct = new Set(Array.from({ length: 40 }, (_, s) => asks(s).join('|')));
    expect(distinct.size).toBeGreaterThan(30);
  });

  it('draws 2 warm-up, 3 shop talk, 3 deep end, in that order, with no repeats', () => {
    for (let seed = 0; seed < 200; seed++) {
      const round = buildRound(tile, seed);
      expect(round.questions).toHaveLength(ROUND_LENGTH);
      expect(round.questions.map((q) => q.tier)).toEqual([1, 1, 2, 2, 2, 3, 3, 3]);
      expect(new Set(round.questions.map((q) => q.source)).size).toBe(ROUND_LENGTH);
      for (const tier of [1, 2, 3] as Tier[]) {
        expect(round.questions.filter((q) => q.tier === tier)).toHaveLength(ROUND_SHAPE[tier]);
      }
    }
  });

  it('always adds up to 100 points', () => {
    for (let seed = 0; seed < 50; seed++) {
      const total = buildRound(tile, seed).questions.reduce((n, q) => n + q.points, 0);
      expect(total).toBe(100);
    }
  });

  it('keeps exactly one right answer per question and spreads its position', () => {
    const positions = [0, 0, 0, 0];
    for (let seed = 0; seed < 300; seed++) {
      for (const q of buildRound(tile, seed).questions) {
        expect(q.options).toHaveLength(4);
        expect(q.options.map((o) => o.id).sort()).toEqual([0, 1, 2, 3]);
        expect(q.options.filter((o) => o.role === 'right')).toHaveLength(1);
        expect(q.options.filter((o) => o.role === 'bait').length).toBeLessThanOrEqual(1);
        positions[q.options.findIndex((o) => o.role === 'right')]!++;
      }
    }
    const total = positions.reduce((a, b) => a + b, 0);
    // No position should be a safe guess.
    for (const n of positions) expect(n / total).toBeGreaterThan(0.18);
    for (const n of positions) expect(n / total).toBeLessThan(0.32);
  });

  it('uses every question in the pack across seeds', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 100; seed++) buildRound(tile, seed).questions.forEach((q) => seen.add(q.source));
    expect(seen.size).toBe(tile.questions.length);
  });
});

describe('scoreRound', () => {
  const round = buildRound(tile, 7);

  it('scores a perfect round at 100', () => {
    const card = scoreRound(round, round.questions.map(() => 0));
    expect(card.score).toBe(100);
    expect(card.correct).toBe(8);
    expect(card.outcomes.every((o) => o === 'hit')).toBe(true);
    expect(card.trapsTaken).toBe(0);
  });

  it('scores taking every bait as traps', () => {
    const choices = round.questions.map((q) => (q.options.find((o) => o.role === 'bait') ?? q.options.find((o) => o.role === 'wrong')!).id);
    const card = scoreRound(round, choices);
    expect(card.score).toBe(0);
    expect(card.trapsTaken).toBe(card.trapsSet);
    expect(card.outcomes.filter((o) => o === 'trap')).toHaveLength(card.trapsSet);
  });

  it('weights harder tiers more', () => {
    const onlyFirst = scoreRound(round, round.questions.map((_, i) => (i === 0 ? 0 : 1)));
    const onlyLast = scoreRound(round, round.questions.map((_, i) => (i === 7 ? 0 : 1)));
    expect(onlyFirst.score).toBe(8);
    expect(onlyLast.score).toBe(16);
  });

  it('treats a missing answer as a miss', () => {
    const card = scoreRound(round, []);
    expect(card.score).toBe(0);
    expect(card.outcomes.every((o) => o === 'miss')).toBe(true);
  });

  it('tallies by tier and kind consistently', () => {
    const card = scoreRound(round, round.questions.map((_, i) => (i % 2 === 0 ? 0 : 1)));
    expect(card.byTier[1].of + card.byTier[2].of + card.byTier[3].of).toBe(8);
    expect(card.byKind.reduce((n, k) => n + k.of, 0)).toBe(8);
    expect(card.byKind.reduce((n, k) => n + k.got, 0)).toBe(card.correct);
  });

  it('classifies outcomes', () => {
    const q = round.questions.find((x) => x.options.some((o) => o.role === 'bait'))!;
    expect(outcomeOf(q, 0)).toBe('hit');
    expect(outcomeOf(q, q.options.find((o) => o.role === 'bait')!.id)).toBe('trap');
    expect(outcomeOf(q, q.options.find((o) => o.role === 'wrong')!.id)).toBe('miss');
    expect(outcomeOf(q, 99)).toBe('miss');
  });
});

describe('verdicts', () => {
  it('bands scores', () => {
    expect(bandFor(100)).toBe('certified');
    expect(bandFor(90)).toBe('certified');
    expect(bandFor(89)).toBe('legit');
    expect(bandFor(70)).toBe('legit');
    expect(bandFor(69)).toBe('weekend');
    expect(bandFor(50)).toBe('weekend');
    expect(bandFor(49)).toBe('theory');
    expect(bandFor(30)).toBe('theory');
    expect(bandFor(29)).toBe('exposed');
    expect(bandFor(0)).toBe('exposed');
  });

  it('writes titles that read as English', () => {
    expect(verdictFor(72, 'bartender').title).toBe('Legit bartender');
    expect(verdictFor(40, 'tile setter').title).toBe('Tile setter in theory');
    expect(verdictFor(10, 'electrician').title).toBe('Not an electrician');
    expect(verdictFor(10, 'SRE').title).toBe('Not an SRE');
    expect(verdictFor(10, 'poker player').title).toBe('Not a poker player');
    expect(verdictFor(95, 'line cook').passed).toBe(true);
    expect(verdictFor(60, 'line cook').passed).toBe(false);
  });

  it('picks the right article', () => {
    expect(withArticle('editor')).toBe('an editor');
    expect(withArticle('golfer')).toBe('a golfer');
    expect(withArticle('SRE')).toBe('an SRE');
    expect(withArticle('outbound rep')).toBe('an outbound rep');
  });

  it('never writes more than three highlights, and always sensible ones', () => {
    const round = buildRound(tile, 3);
    for (let mask = 0; mask < 256; mask++) {
      const choices = round.questions.map((q, i) =>
        mask & (1 << i) ? 0 : (q.options.find((o) => o.role === 'bait') ?? q.options.find((o) => o.role === 'wrong')!).id,
      );
      const lines = highlights(scoreRound(round, choices));
      expect(lines.length).toBeLessThanOrEqual(3);
      for (const line of lines) expect(line).toMatch(/[.]$/);
    }
    expect(highlights(scoreRound(round, round.questions.map(() => 0)))[0]).toMatch(/clean sheet/i);
  });
});

describe('packFingerprint', () => {
  it('is stable and changes when a question changes', () => {
    const a = packFingerprint(tile);
    expect(a).toBe(packFingerprint(tile));
    const edited = { ...tile, questions: tile.questions.map((q, i) => (i === 0 ? { ...q, right: q.right + '!' } : q)) };
    expect(packFingerprint(edited)).not.toBe(a);
  });
});
