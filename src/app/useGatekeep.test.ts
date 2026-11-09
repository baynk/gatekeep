import { describe, expect, it } from 'vitest';
import { getPack } from '../lib/catalog.ts';
import { CLEAN_REPORT } from '../lib/integrity.ts';
import { buildRound, packFingerprint } from '../lib/round.ts';
import { challengePath, decodeChallenge, encodeChallenge } from '../lib/share.ts';
import type { Challenge } from '../lib/share.ts';
import { challengeFor, finishLocal, newGame } from './game.ts';
import type { Stage } from './game.ts';
import { backOutOf, stageForHash, stepsHome } from './useGatekeep.ts';

const pack = getPack('bartending')!;
const SEED = 4242424242;
const round = buildRound(pack, SEED);
// Sam gets them all; Jo misses the second and the sixth.
const sam = finishLocal(pack, round, 'Sam', [0, 0, 0, 0, 0, 0, 0, 0], 161, { ...CLEAN_REPORT });
const jo = finishLocal(pack, round, 'Jo', [0, 1, 0, 0, 0, 2, 0, 0], 140, { ...CLEAN_REPORT });

/** The same link as it would read had the pack been different when it was made. */
function madeOnAnotherVersion(c: Challenge): string {
  expect(packFingerprint(pack)).not.toBe('old111');
  return `#/c/${encodeChallenge({ ...c, fingerprint: 'old111' })}`;
}

function versus(stage: Stage) {
  if (stage.at !== 'versus') throw new Error(`expected the head-to-head, got ${stage.at}`);
  return stage;
}
function intro(stage: Stage) {
  if (stage.at !== 'intro') throw new Error(`expected the intro, got ${stage.at}`);
  return stage;
}

describe('a challenge link', () => {
  it('opens on the intro, against whoever sent it', () => {
    const stage = intro(stageForHash(challengePath(challengeFor(pack, SEED, sam))));
    expect(stage.pack).toBe(pack);
    expect(stage.challenger?.attempt.name).toBe('Sam');
    expect(stage.challenger?.score).toBe(100);
    expect(stage.stale).toBe(false);
  });

  it('says the pack has changed when it has, because the round is about to be rebuilt', () => {
    expect(intro(stageForHash(madeOnAnotherVersion(challengeFor(pack, SEED, sam)))).stale).toBe(true);
  });
});

describe('a link with both results', () => {
  it('says the questions matched when they did, whatever has happened to the pack since', () => {
    const link = challengeFor(pack, SEED, sam, jo);
    expect(link.mixed).toBeUndefined();
    const today = versus(stageForHash(challengePath(link)));
    expect(today.mode).toBe('spectate');
    expect(today.stale).toBe(false);
    expect([today.a.score, today.b.score]).toEqual([100, jo.score]);
    // The same link, opened after the pack was edited.
    expect(versus(stageForHash(madeOnAnotherVersion(link))).stale).toBe(false);
  });

  it('says the questions differed when the reply was played on a changed pack', () => {
    // Jo opened Sam's link after the pack changed, played, and sends it back.
    const link = challengeFor(pack, SEED, sam, jo, true);
    expect(link.mixed).toBe(true);
    // The link is stamped with the pack as Jo had it, which is today's...
    expect(link.fingerprint).toBe(packFingerprint(pack));
    // ...and still says the two rounds were not the same eight questions.
    expect(versus(stageForHash(challengePath(link))).stale).toBe(true);
    expect(versus(stageForHash(madeOnAnotherVersion(link))).stale).toBe(true);
  });

  it('opens links made before the flag existed, as matching', () => {
    const code = encodeChallenge(challengeFor(pack, SEED, sam, jo));
    expect(Object.keys(JSON.parse(Buffer.from(code, 'base64url').toString('utf8')) as object).sort()).toEqual(['c', 'f', 'p', 'r', 's', 'v']);
    expect(versus(stageForHash(`#/c/${code}`)).stale).toBe(false);
  });

  it('never marks a link with one result as mixed', () => {
    expect(challengeFor(pack, SEED, sam, undefined, true).mixed).toBeUndefined();
    expect(decodeChallenge(encodeChallenge(challengeFor(pack, SEED, sam, undefined, true)))?.mixed).toBeUndefined();
  });
});

describe('links that arrive a little mangled', () => {
  const code = encodeChallenge(challengeFor(pack, SEED, sam));

  it.each(['.', ',', ')', '!', '/', '>', '%3E', '%20', ' ', '?utm_source=share', '&fbclid=abc', '.)', '%E0%A4%A', '%'])(
    'opens a challenge link with %j stuck on the end',
    (junk) => {
      expect(intro(stageForHash(`#/c/${code}${junk}`)).challenger?.attempt.name).toBe('Sam');
    },
  );

  it('opens a challenge link whose slashes were percent-encoded', () => {
    expect(intro(stageForHash(`#%2Fc%2F${code}`)).challenger?.attempt.name).toBe('Sam');
    expect(intro(stageForHash(`#%2Fc%2F${code}%2E`)).challenger?.attempt.name).toBe('Sam');
  });

  it('opens a pack link the same way', () => {
    expect(intro(stageForHash('#/p/bartending')).pack).toBe(pack);
    expect(intro(stageForHash('#/p/bartending.')).pack).toBe(pack);
    expect(intro(stageForHash('#/p/bartending?utm_source=share')).pack).toBe(pack);
    expect(intro(stageForHash('#%2Fp%2Fbartending')).pack).toBe(pack);
  });

  it('still refuses a code that is cut short, altered or not a code', () => {
    const broken = { at: 'home', notice: 'That challenge link is broken or out of date.' };
    expect(stageForHash(`#/c/${code.slice(0, -3)}`)).toEqual(broken);
    expect(stageForHash(`#/c/${code.slice(0, -3)}.`)).toEqual(broken);
    expect(stageForHash(`#/c/.${code}`)).toEqual(broken);
    expect(stageForHash(`#/c/${code.slice(0, 40)}.${code.slice(40)}`)).toEqual(broken);
    expect(stageForHash('#/c/')).toEqual(broken);
    expect(stageForHash('#/c/not-a-real-challenge')).toEqual(broken);
    expect(stageForHash('#/c/%')).toEqual(broken);
    expect(stageForHash('#/p/no-such-pack')).toEqual({ at: 'home', notice: 'That pack is not here. Try a search.' });
    expect(stageForHash('#/p/')).toEqual({ at: 'home', notice: 'That pack is not here. Try a search.' });
  });

  it('lands on home for everything else, with nothing to explain', () => {
    for (const hash of ['', '#', '#/', '#/nowhere', '#%']) expect(stageForHash(hash)).toEqual({ at: 'home' });
  });
});

describe('the system Back button, stepping off a round', () => {
  it('asks before leaving a live round, answered or not', () => {
    const game = newGame(pack, SEED, 'Sam');
    expect(backOutOf({ at: 'play', game })).toBe('ask');
    expect(backOutOf({ at: 'play', game: { ...game, phase: 'revealed', choices: [0], times: [900] } })).toBe('ask');
  });

  it('goes back to the result from the handoff, as the arrow on that screen does', () => {
    expect(backOutOf({ at: 'handoff', pack, round, first: sam })).toBe('result');
  });

  it('leaves a result or a head-to-head for Home: nothing unfinished is lost', () => {
    expect(backOutOf({ at: 'result', pack, round, me: sam })).toBe('home');
    expect(backOutOf({ at: 'versus', pack, seed: SEED, a: sam, b: jo, mode: 'here' })).toBe('home');
    expect(backOutOf({ at: 'versus', pack, seed: SEED, a: sam, b: jo, mode: 'reply' })).toBe('home');
    // "Play again" shows the intro on the round's own entry.
    expect(backOutOf({ at: 'intro', pack })).toBe('home');
  });
});

describe('going home without leaving a screen behind for Back to reopen', () => {
  it('pops one entry from a pack that was opened from Home', () => {
    expect(stepsHome({ fromHome: true })).toBe(1);
    expect(stepsHome({ fromHome: true, under: 'r1' })).toBe(1);
  });

  it('pops two from a round: its own entry, then the pack it was started from', () => {
    expect(stepsHome({ fromHome: true, round: 'r1' })).toBe(2);
  });

  it('has no Home to pop to from a link, so the entry the link opened becomes Home', () => {
    // On the link's own entry: nothing to step back to.
    expect(stepsHome({})).toBe(0);
    expect(stepsHome({ under: 'r1' })).toBe(0);
    // On a round started from it: off the round's entry first, onto the link's.
    expect(stepsHome({ round: 'r1' })).toBe(1);
  });
});
