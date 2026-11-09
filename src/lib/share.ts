import { CLEAN_REPORT, flagSummary, isFlagged } from './integrity.ts';
import type { IntegrityReport } from './integrity.ts';
import { ROUND_LENGTH } from './round.ts';
import type { Outcome } from './round.ts';

/**
 * A finished attempt, small enough to live in a URL. With (pack, seed) it is
 * everything needed to rebuild the round and the scorecard on another phone:
 * there is no server.
 */
export interface Attempt {
  /** Display name, already cleaned. */
  name: string;
  /**
   * How each question went, in order. Outcomes rather than raw choices, so a
   * link still reads correctly if the pack is edited after it was made.
   */
  outcomes: Outcome[];
  /** Whole seconds for the round. */
  seconds: number;
  integrity: IntegrityReport;
}

export interface Challenge {
  packId: string;
  seed: number;
  /** Fingerprint of the pack when the link was made. */
  fingerprint: string;
  /** Whoever sent the link. */
  from: Attempt;
  /** Present on a reply link: the person who answered the challenge. */
  reply?: Attempt;
  /**
   * Reply links only: the pack changed between the two rounds, so the questions
   * were not identical. It travels in the link because whoever opens it later
   * cannot work it out: their pack may have changed again, or not at all.
   */
  mixed?: boolean;
}

export const MAX_NAME = 16;

// Names arrive from strangers' links as well as from the name field.
// Controls, lone surrogates, bidi controls (a right-to-left override would
// reverse the rest of the line) and format characters that paint nothing.
// ZWNJ and ZWJ (U+200C, U+200D) stay: Persian and emoji need them.
const STRIP =
  /[\p{Cc}\p{Cs}\u00ad\u061c\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb<>]/gu;
// Everything that paints nothing by itself, blank "letters" included.
const BLANK = /[\p{Cc}\p{Cf}\p{Cs}\p{Z}\p{M}\u115f\u1160\u2800\u3164\uffa0]/gu;

export function cleanName(raw: string, fallback = 'Player'): string {
  const name = raw
    .replace(/\s+/g, ' ')
    .replace(STRIP, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    // The cut can land in the middle of an emoji: drop the half that is left.
    .replace(/\p{Cs}/gu, '')
    .trim();
  // A name nobody can see is no name.
  return name.replace(BLANK, '') ? name : fallback;
}

function sameName(a: string, b: string): boolean {
  return a.normalize('NFKC').toLowerCase() === b.normalize('NFKC').toLowerCase();
}

/**
 * The second player's name, changed if it would read the same as the first's:
 * "Sam wins by 20" has to say which Sam.
 */
export function distinctName(name: string, taken: string): string {
  if (!sameName(name, taken)) return name;
  for (let n = 2; ; n++) {
    const next = cleanName(`${name.slice(0, MAX_NAME - 2)} ${n}`);
    if (!sameName(next, taken)) return next;
  }
}

// ── Wire format (v1) ────────────────────────────────────────────────────
// Short keys, outcomes as a digit string (0 hit, 1 trap, 2 miss), integrity as
// a 5-tuple, or a 6-tuple when the round was a repeat. Around 150 characters
// once base64url-encoded. Additions are optional, so every older link still
// opens: `x` on a reply link, the sixth integrity value.

/** The most a link will carry. The writer clamps to what the reader accepts, so the two cannot drift. */
const MAX_SECONDS = 86_400;
const MAX_SIGNAL = 99_999;

const OUTCOME_CODE: Record<Outcome, string> = { hit: '0', trap: '1', miss: '2' };
const OUTCOME_FROM_CODE: Outcome[] = ['hit', 'trap', 'miss'];

interface WireAttempt {
  n: string;
  a: string;
  t: number;
  /** away, awaySec, slowMath, slowestMathSec, copies, then repeat only when it is set. */
  g: number[];
}
interface Wire {
  v: 1;
  p: string;
  s: number;
  f: string;
  c: WireAttempt;
  r?: WireAttempt;
  /** With `r` only: the two rounds were played on different versions of the pack. */
  x?: 1;
}

function packAttempt(a: Attempt): WireAttempt {
  const g = a.integrity;
  const signals = [g.away, g.awaySec, g.slowMath, g.slowestMathSec, g.copies];
  // Clean links stay exactly as short as they were.
  if (g.repeat > 0) signals.push(g.repeat);
  return {
    n: a.name,
    a: a.outcomes.map((o) => OUTCOME_CODE[o]).join(''),
    // A tab left open for a day must still make a link that opens.
    t: Math.min(a.seconds, MAX_SECONDS),
    g: signals.map((x) => Math.min(x, MAX_SIGNAL)),
  };
}

function isCount(x: unknown, max: number): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max;
}

function unpackAttempt(w: unknown): Attempt | null {
  if (!w || typeof w !== 'object') return null;
  const { n, a, t, g } = w as Partial<WireAttempt>;
  if (typeof n !== 'string' || typeof a !== 'string') return null;
  if (!new RegExp(`^[0-2]{${ROUND_LENGTH}}$`).test(a)) return null;
  if (!isCount(t, MAX_SECONDS)) return null;
  // Five values on every link made before repeats were recorded.
  if (!Array.isArray(g) || (g.length !== 5 && g.length !== 6) || !g.every((x) => isCount(x, MAX_SIGNAL))) return null;
  return {
    name: cleanName(n),
    outcomes: a.split('').map((ch) => OUTCOME_FROM_CODE[Number(ch)]!),
    seconds: t,
    integrity: {
      ...CLEAN_REPORT,
      away: g[0],
      awaySec: g[1],
      slowMath: g[2],
      slowestMathSec: g[3],
      copies: g[4],
      repeat: g[5] ? 1 : 0,
    },
  };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function encodeChallenge(c: Challenge): string {
  const wire: Wire = { v: 1, p: c.packId, s: c.seed >>> 0, f: c.fingerprint, c: packAttempt(c.from) };
  if (c.reply) {
    wire.r = packAttempt(c.reply);
    if (c.mixed) wire.x = 1;
  }
  return toBase64Url(JSON.stringify(wire));
}

/** Returns null for anything malformed. Links come from strangers: trust nothing. */
export function decodeChallenge(code: string): Challenge | null {
  if (!code || code.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  let wire: Partial<Wire>;
  try {
    wire = JSON.parse(fromBase64Url(code)) as Partial<Wire>;
  } catch {
    return null;
  }
  if (!wire || typeof wire !== 'object' || wire.v !== 1) return null;
  if (typeof wire.p !== 'string' || !/^[a-z0-9-]{1,48}$/.test(wire.p)) return null;
  if (!isCount(wire.s, 0xffffffff)) return null;
  if (typeof wire.f !== 'string' || !/^[a-z0-9]{1,12}$/.test(wire.f)) return null;
  const from = unpackAttempt(wire.c);
  if (!from) return null;
  const challenge: Challenge = { packId: wire.p, seed: wire.s, fingerprint: wire.f, from };
  if (wire.r !== undefined) {
    const reply = unpackAttempt(wire.r);
    if (!reply) return null;
    challenge.reply = reply;
    if (wire.x === 1) challenge.mixed = true;
  }
  return challenge;
}

export function challengePath(c: Challenge): string {
  return `#/c/${encodeChallenge(c)}`;
}

/** Absolute link for the current deployment, wherever it is hosted. */
export function challengeUrl(c: Challenge, base: string = globalThis.location?.href ?? ''): string {
  return `${base.split('#')[0]}${challengePath(c)}`;
}

// ── Share text ──────────────────────────────────────────────────────────

const TILE: Record<Outcome, string> = { hit: '🟩', trap: '🪤', miss: '🟥' };

export function tileRow(outcomes: readonly Outcome[]): string {
  return outcomes.map((o) => TILE[o]).join('');
}

export interface ShareLine {
  name: string;
  verdict: string;
  score: number;
  outcomes: readonly Outcome[];
  integrity: IntegrityReport;
}

/** The spoiler-free text that goes to the group chat. */
export function resultShareText(packTitle: string, me: ShareLine, url: string): string {
  const star = isFlagged(me.integrity) ? '*' : '';
  const lines = [
    `gatekeep · ${packTitle}`,
    `${me.name}: ${me.verdict}${star} (${me.score}/100)`,
    tileRow(me.outcomes),
  ];
  if (star) lines.push(`*${flagSummary(me.integrity)}`);
  lines.push('', `Same 8 questions. Think you'd do better?`, url);
  return lines.join('\n');
}

export function versusShareText(packTitle: string, a: ShareLine, b: ShareLine, url: string): string {
  const row = (p: ShareLine) => `${tileRow(p.outcomes)} ${p.name} ${p.score}${isFlagged(p.integrity) ? '*' : ''}`;
  const lead = a.score === b.score ? 'Dead even.' : `${a.score > b.score ? a.name : b.name} wins by ${Math.abs(a.score - b.score)}.`;
  return [`gatekeep · ${packTitle}`, row(a), row(b), lead, '', url].join('\n');
}
