import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasSeenRound, loadBest, loadName, markRoundSeen, recordScore, saveName } from './storage.ts';

/** A stand-in for the browser's localStorage. */
function fakeStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

let storage: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('best scores', () => {
  it('keeps the highest score', () => {
    expect(recordScore('poker', 72, false)).toBe(true);
    expect(recordScore('poker', 60, false)).toBe(false);
    expect(recordScore('poker', 72, false)).toBe(false);
    expect(loadBest('poker')).toEqual({ score: 72, flagged: false });
    expect(recordScore('poker', 84, true)).toBe(true);
    expect(loadBest('poker')).toEqual({ score: 84, flagged: true });
    expect(loadBest('chess')).toBeUndefined();
  });

  it('lets a clean round take the asterisk off an equal best', () => {
    recordScore('poker', 100, true);
    expect(loadBest('poker')).toEqual({ score: 100, flagged: true });
    expect(recordScore('poker', 100, false)).toBe(true);
    expect(loadBest('poker')).toEqual({ score: 100, flagged: false });

    recordScore('espresso', 84, true);
    expect(recordScore('espresso', 84, false)).toBe(true);
    expect(loadBest('espresso')).toEqual({ score: 84, flagged: false });
  });

  it('never puts an asterisk on a clean best, or lets a lower score replace a higher one', () => {
    recordScore('poker', 100, false);
    expect(recordScore('poker', 100, true)).toBe(false);
    expect(loadBest('poker')).toEqual({ score: 100, flagged: false });

    recordScore('espresso', 84, true);
    expect(recordScore('espresso', 84, true)).toBe(false);
    expect(recordScore('espresso', 80, false)).toBe(false);
    expect(loadBest('espresso')).toEqual({ score: 84, flagged: true });
  });
});

describe('rounds this device has seen', () => {
  it('remembers a round once it is marked, and only that round', () => {
    expect(hasSeenRound('bartending', 4242424242)).toBe(false);
    markRoundSeen('bartending', 4242424242);
    expect(hasSeenRound('bartending', 4242424242)).toBe(true);
    expect(hasSeenRound('bartending', 4242424243)).toBe(false);
    expect(hasSeenRound('poker', 4242424242)).toBe(false);
  });

  it('marks a round once however often it is asked', () => {
    for (let i = 0; i < 8; i++) markRoundSeen('bartending', 7);
    expect(JSON.parse(storage.items.get('gatekeep:seen')!)).toEqual(['bartending:7']);
  });

  it('keeps the most recent rounds and lets the oldest go', () => {
    for (let seed = 1; seed <= 205; seed++) markRoundSeen('poker', seed);
    expect(JSON.parse(storage.items.get('gatekeep:seen')!)).toHaveLength(200);
    expect(hasSeenRound('poker', 5)).toBe(false);
    expect(hasSeenRound('poker', 6)).toBe(true);
    expect(hasSeenRound('poker', 205)).toBe(true);
  });

  it('shrugs off junk left in storage', () => {
    storage.items.set('gatekeep:seen', '{"not":"a list"}');
    expect(hasSeenRound('poker', 1)).toBe(false);
    markRoundSeen('poker', 1);
    expect(hasSeenRound('poker', 1)).toBe(true);
    storage.items.set('gatekeep:seen', '[1, null, "poker:2"');
    expect(hasSeenRound('poker', 2)).toBe(false);
    storage.items.set('gatekeep:seen', '[1, null, "poker:2"]');
    expect(hasSeenRound('poker', 2)).toBe(true);
  });
});

describe('when storage is blocked', () => {
  it('never throws, and nobody is treated as having seen anything', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => markRoundSeen('poker', 1)).not.toThrow();
    expect(hasSeenRound('poker', 1)).toBe(false);
    expect(recordScore('poker', 100, true)).toBe(true);
    expect(loadBest('poker')).toBeUndefined();
    expect(() => saveName('Sam')).not.toThrow();
    expect(loadName()).toBe('');
  });

  it('works with no storage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => markRoundSeen('poker', 1)).not.toThrow();
    expect(hasSeenRound('poker', 1)).toBe(false);
  });
});
