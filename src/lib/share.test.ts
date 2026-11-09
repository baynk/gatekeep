import { describe, expect, it } from 'vitest';
import { CLEAN_REPORT } from './integrity.ts';
import {
  challengePath,
  challengeUrl,
  cleanName,
  decodeChallenge,
  distinctName,
  encodeChallenge,
  resultShareText,
  tileRow,
  versusShareText,
} from './share.ts';
import type { Attempt, Challenge } from './share.ts';

const sam: Attempt = {
  name: 'Sam',
  outcomes: ['hit', 'hit', 'hit', 'trap', 'hit', 'hit', 'miss', 'hit'],
  seconds: 161,
  integrity: { ...CLEAN_REPORT, away: 1, awaySec: 11, slowMath: 1, slowestMathSec: 38 },
};
const jo: Attempt = {
  name: 'Jo',
  outcomes: ['hit', 'hit', 'miss', 'hit', 'hit', 'hit', 'hit', 'hit'],
  seconds: 140,
  integrity: { ...CLEAN_REPORT },
};
const challenge: Challenge = { packId: 'bartending', seed: 4242424242, fingerprint: 'k3j2x', from: sam };

/** What a code carries, as JSON, and a code made from edited JSON: for forging links. */
const wireOf = (code: string) => JSON.parse(Buffer.from(code, 'base64url').toString('utf8')) as Record<string, any>;
const codeOf = (wire: unknown) => Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url');

describe('challenge links', () => {
  it('round-trips a challenge', () => {
    expect(decodeChallenge(encodeChallenge(challenge))).toEqual(challenge);
  });

  it('round-trips a reply', () => {
    const withReply = { ...challenge, reply: jo };
    expect(decodeChallenge(encodeChallenge(withReply))).toEqual(withReply);
  });

  it('survives names with accents, emoji and non-Latin scripts', () => {
    for (const name of ['Zoë', 'José 🍸', '田中', 'Åsa-Maj']) {
      const c = { ...challenge, from: { ...sam, name } };
      expect(decodeChallenge(encodeChallenge(c))?.from.name).toBe(name);
    }
  });

  it('is URL-safe and short', () => {
    const code = encodeChallenge({ ...challenge, reply: jo });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(320);
    expect(challengePath(challenge).startsWith('#/c/')).toBe(true);
    expect(challengeUrl(challenge, 'https://example.com/app/#/p/poker')).toBe(`https://example.com/app/${challengePath(challenge)}`);
  });

  it('rejects anything malformed', () => {
    const bad = (mutate: (w: Record<string, unknown>) => void) => {
      const wire = JSON.parse(Buffer.from(encodeChallenge(challenge), 'base64url').toString('utf8')) as Record<string, unknown>;
      mutate(wire);
      return Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url');
    };
    expect(decodeChallenge('')).toBeNull();
    expect(decodeChallenge('not base64 at all!')).toBeNull();
    expect(decodeChallenge('aGVsbG8')).toBeNull();
    expect(decodeChallenge('A'.repeat(5000))).toBeNull();
    expect(decodeChallenge(bad((w) => (w.v = 2)))).toBeNull();
    expect(decodeChallenge(bad((w) => (w.p = '../etc/passwd')))).toBeNull();
    expect(decodeChallenge(bad((w) => (w.s = -1)))).toBeNull();
    expect(decodeChallenge(bad((w) => (w.s = 1.5)))).toBeNull();
    expect(decodeChallenge(bad((w) => ((w.c as { a: string }).a = '0000')))).toBeNull();
    expect(decodeChallenge(bad((w) => ((w.c as { a: string }).a = '00000009')))).toBeNull();
    expect(decodeChallenge(bad((w) => ((w.c as { g: unknown }).g = [1, 2])))).toBeNull();
    expect(decodeChallenge(bad((w) => ((w.c as { t: unknown }).t = 'soon')))).toBeNull();
    expect(decodeChallenge(bad((w) => (w.r = { n: 'x' })))).toBeNull();
    expect(decodeChallenge(bad((w) => delete w.c))).toBeNull();
  });

  it('says in a reply link when the two rounds were on different versions of the pack', () => {
    const mixed: Challenge = { ...challenge, reply: jo, mixed: true };
    expect(wireOf(encodeChallenge(mixed)).x).toBe(1);
    expect(decodeChallenge(encodeChallenge(mixed))).toEqual(mixed);
    // Unset, it adds nothing: links for matching rounds are unchanged.
    expect('x' in wireOf(encodeChallenge({ ...challenge, reply: jo }))).toBe(false);
    expect('x' in wireOf(encodeChallenge({ ...challenge, reply: jo, mixed: false }))).toBe(false);
    expect(decodeChallenge(encodeChallenge({ ...challenge, reply: jo }))?.mixed).toBeUndefined();
  });

  it('keeps that flag off a link with one result, where it means nothing', () => {
    expect('x' in wireOf(encodeChallenge({ ...challenge, mixed: true }))).toBe(false);
    const forged = wireOf(encodeChallenge(challenge));
    forged.x = 1;
    expect(decodeChallenge(codeOf(forged))).toEqual(challenge);
    // Only a 1 counts.
    const odd = wireOf(encodeChallenge({ ...challenge, reply: jo }));
    odd.x = 'yes';
    expect(decodeChallenge(codeOf(odd))?.mixed).toBeUndefined();
  });

  it('carries a second look in the link, and still opens links made before that existed', () => {
    const again: Attempt = { ...jo, integrity: { ...CLEAN_REPORT, repeat: 1 } };
    const code = encodeChallenge({ ...challenge, reply: again });
    expect(wireOf(code).r.g).toEqual([0, 0, 0, 0, 0, 1]);
    expect(decodeChallenge(code)?.reply).toEqual(again);
    // A round that was not a repeat is written exactly as it always was.
    expect(wireOf(code).c.g).toEqual([1, 11, 1, 38, 0]);
    expect(wireOf(encodeChallenge({ ...challenge, reply: jo })).r.g).toEqual([0, 0, 0, 0, 0]);

    // An old link: five values, no repeat.
    const old = wireOf(encodeChallenge({ ...challenge, reply: jo }));
    expect(old.c.g).toHaveLength(5);
    expect(decodeChallenge(codeOf(old))?.from.integrity).toEqual({ ...sam.integrity, repeat: 0 });
    // Anything else is still malformed.
    for (const g of [[], [0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, -1], [0, 0, 0, 0, 0, 1.5], [0, 0, 0, 0, 0, '1']]) {
      const bad = wireOf(encodeChallenge(challenge));
      bad.c.g = g;
      expect(decodeChallenge(codeOf(bad))).toBeNull();
    }
  });

  it('never makes a link its own reader rejects, however long the round sat open', () => {
    const dayLong: Attempt = {
      ...sam,
      seconds: 100_803,
      integrity: { ...CLEAN_REPORT, away: 1, awaySec: 100_800, slowMath: 1, slowestMathSec: 100_000, copies: 123_456, repeat: 1 },
    };
    const decoded = decodeChallenge(encodeChallenge({ ...challenge, from: dayLong, reply: { ...jo, seconds: 90_003 } }));
    expect(decoded).not.toBeNull();
    expect(decoded!.from.seconds).toBe(86_400);
    expect(decoded!.from.integrity).toEqual({ ...CLEAN_REPORT, away: 1, awaySec: 99_999, slowMath: 1, slowestMathSec: 99_999, copies: 99_999, repeat: 1 });
    expect(decoded!.reply!.seconds).toBe(86_400);
    // The limits themselves have not moved: a forged link past them is still refused.
    const forged = wireOf(encodeChallenge(challenge));
    forged.c.t = 86_401;
    expect(decodeChallenge(codeOf(forged))).toBeNull();
    forged.c.t = 86_400;
    forged.c.g = [1, 100_000, 0, 0, 0];
    expect(decodeChallenge(codeOf(forged))).toBeNull();
  });

  it('cleans hostile names instead of trusting them', () => {
    const wire = JSON.parse(Buffer.from(encodeChallenge(challenge), 'base64url').toString('utf8')) as { c: { n: string } };
    wire.c.n = '<img src=x onerror=alert(1)>   and a very long name indeed';
    const decoded = decodeChallenge(Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url'));
    expect(decoded?.from.name).not.toMatch(/[<>]/);
    expect(decoded!.from.name.length).toBeLessThanOrEqual(16);
  });
});

describe('cleanName', () => {
  it('trims, collapses and caps', () => {
    expect(cleanName('  Sam   the   Man  ')).toBe('Sam the Man');
    expect(cleanName('')).toBe('Player');
    expect(cleanName('   ', 'Challenger')).toBe('Challenger');
    expect(cleanName('x'.repeat(50))).toHaveLength(16);
    expect(cleanName('a\u0000b\nc')).toBe('ab c');
  });

  it('strips direction overrides, which would reverse the rest of the line', () => {
    expect(cleanName('\u202eevil')).toBe('evil');
    expect(cleanName('\u2066ev\u2069il\u200f')).toBe('evil');
    expect(cleanName('a \u202e b')).toBe('a b');
    expect(cleanName('a\u0085b\u009fc')).toBe('abc');
  });

  it('falls back when nothing visible is left', () => {
    for (const blank of ['\u200b', '\u2060', '\u200d', '\u00ad', '\u3164', '\u2800', '\ufe0f', '\ud83d', '\u200d\u200c', ' \u0301 ', '\u115f\uffa0']) {
      expect(cleanName(blank), JSON.stringify(blank)).toBe('Player');
      expect(cleanName(`  ${blank} `, 'Challenger'), JSON.stringify(blank)).toBe('Challenger');
    }
    expect(cleanName('\u200b', '')).toBe('');
  });

  it('never leaves half an emoji behind', () => {
    expect(cleanName('A'.repeat(15) + '🍸')).toBe('A'.repeat(15));
    expect(cleanName('🍸'.repeat(20))).toBe('🍸'.repeat(8));
    expect(cleanName('Sam \ud83d')).toBe('Sam');
    expect(cleanName('\udc00Sam')).toBe('Sam');
  });

  it('leaves honest names alone', () => {
    for (const name of ['Zoë', 'José 🍸', '田中', 'Åsa-Maj', "O'Neil", 'דנה', 'محمد', 'می‌خواهم', 'สมชาย', 'अमित', '👨‍👩‍👧', '🇸🇪 Åsa', '❤️ Jo', 'e\u0301ric']) {
      expect(cleanName(name), name).toBe(name);
    }
  });
});

describe('distinctName', () => {
  it('leaves a different name alone', () => {
    expect(distinctName('Jo', 'Sam')).toBe('Jo');
    expect(distinctName('Challenger', 'Player')).toBe('Challenger');
    expect(distinctName('Sam 2', 'Sam')).toBe('Sam 2');
  });

  it('marks the second of two players who would read the same', () => {
    expect(distinctName('Sam', 'Sam')).toBe('Sam 2');
    expect(distinctName('sam', 'Sam')).toBe('sam 2');
    expect(distinctName('Player', 'Player')).toBe('Player 2');
    expect(distinctName('Challenger', 'challenger')).toBe('Challenger 2');
    // Composed and decomposed forms of the same letters look identical.
    expect(distinctName('Zoe\u0308', 'Zoë')).toBe('Zoe\u0308 2');
  });

  it('stays within the name limit and never returns the taken name', () => {
    expect(distinctName('Maximilian Johns', 'Maximilian Johns')).toBe('Maximilian Joh 2');
    expect(distinctName('AAAAAAAAAAAAAA 2', 'AAAAAAAAAAAAAA 2')).toBe('AAAAAAAAAAAAAA 3');
    // The cut for the suffix can land inside an emoji.
    const emoji = 'A'.repeat(13) + '🍸';
    expect(distinctName(emoji, emoji)).toBe('A'.repeat(13) + ' 2');
    for (const name of ['Sam', 'Maximilian Johns', 'AAAAAAAAAAAAAA 2', emoji]) {
      expect(distinctName(name, name).length).toBeLessThanOrEqual(16);
      expect(distinctName(name, name)).not.toBe(name);
    }
  });
});

describe('share text', () => {
  const samLine = { name: 'Sam', verdict: 'Legit bartender', score: 72, outcomes: ['hit', 'hit', 'hit', 'trap', 'hit', 'hit', 'miss', 'hit'] as const, integrity: sam.integrity };
  const joLine = { name: 'Jo', verdict: 'Legit bartender', score: 88, outcomes: ['hit', 'hit', 'miss', 'hit', 'hit', 'hit', 'hit', 'hit'] as const, integrity: jo.integrity };

  it('renders a spoiler-free tile row', () => {
    expect(tileRow(samLine.outcomes)).toBe('🟩🟩🟩🪤🟩🟩🟥🟩');
  });

  it('includes the verdict, the asterisk and the link', () => {
    const text = resultShareText('Bartending', samLine, 'https://x.test/#/c/abc');
    expect(text).toContain('gatekeep · Bartending');
    expect(text).toContain('Sam: Legit bartender* (72/100)');
    expect(text).toContain('*Left the app once, slow on the math.');
    expect(text.trim().endsWith('https://x.test/#/c/abc')).toBe(true);
  });

  it('has no asterisk for a clean round', () => {
    const text = resultShareText('Bartending', joLine, 'https://x.test/');
    expect(text).toContain('Jo: Legit bartender (88/100)');
    expect(text).not.toContain('*');
  });

  it('names the winner in a head-to-head', () => {
    expect(versusShareText('Bartending', samLine, joLine, 'u')).toContain('Jo wins by 16.');
    expect(versusShareText('Bartending', samLine, { ...joLine, score: 72 }, 'u')).toContain('Dead even.');
  });
});
