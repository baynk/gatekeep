/**
 * Tiny localStorage wrapper. Everything here is a convenience (remembering a
 * name, showing a personal best): the app must work when storage is blocked,
 * full, or absent, so every call swallows its errors.
 */

const PREFIX = 'gatekeep:';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode, quota, disabled: not worth telling anyone */
  }
}

export function loadName(): string {
  const name = read<unknown>('name', '');
  return typeof name === 'string' ? name : '';
}

export function saveName(name: string): void {
  write('name', name);
}

export interface Best {
  score: number;
  /** True when the best came with an asterisk. */
  flagged: boolean;
}

function loadBests(): Record<string, Best> {
  const raw = read<unknown>('bests', {});
  return raw && typeof raw === 'object' ? (raw as Record<string, Best>) : {};
}

export function loadBest(packId: string): Best | undefined {
  const best = loadBests()[packId];
  return best && typeof best.score === 'number' ? best : undefined;
}

/**
 * Records a score if it beats the stored one. At the same score a clean round
 * beats an asterisked one, so an old asterisk can always be played off.
 * Returns true if it was stored.
 */
export function recordScore(packId: string, score: number, flagged: boolean): boolean {
  const bests = loadBests();
  const prev = bests[packId];
  if (prev && typeof prev.score === 'number') {
    const cleaner = prev.score === score && prev.flagged && !flagged;
    if (prev.score >= score && !cleaner) return false;
  }
  bests[packId] = { score, flagged };
  write('bests', bests);
  return true;
}

// ── Rounds this device has been shown answers to ────────────────────────
// A challenge link always rebuilds the same eight questions, so reloading it
// after a reveal would be an open-book second go. The round is remembered at
// its first reveal (never at the start: reloading before answering anything
// has shown nothing), and a challenge started on a remembered round is noted.

/** Enough to cover any link someone is likely to reopen; old ones fall off the front. */
const SEEN_LIMIT = 200;

function loadSeen(): string[] {
  const raw = read<unknown>('seen', []);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

function roundKey(packId: string, seed: number): string {
  return `${packId}:${seed >>> 0}`;
}

export function hasSeenRound(packId: string, seed: number): boolean {
  return loadSeen().includes(roundKey(packId, seed));
}

export function markRoundSeen(packId: string, seed: number): void {
  const seen = loadSeen();
  const key = roundKey(packId, seed);
  if (seen.includes(key)) return;
  write('seen', [...seen, key].slice(-SEEN_LIMIT));
}
