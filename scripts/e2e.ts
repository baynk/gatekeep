/**
 * End-to-end check of the built app, at phone size, the way people use it.
 *
 *   npm run e2e          # builds, serves the build, runs every flow
 *
 * It plays whole rounds (it knows the answers: it reads the packs), leaves the
 * app mid-question, dawdles on the math, passes the phone, opens challenge
 * links in fresh browsers, and fails on any console error, page error, failed
 * request or sideways scroll. Screenshots land in .e2e/.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { Pack } from '../src/lib/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, '.e2e');
// Never assume a port is ours: ask the system for a free one.
const PORT = await new Promise<number>((done, fail) => {
  const probe = createServer();
  probe.once('error', fail);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as AddressInfo;
    probe.close(() => done(port));
  });
});
const BASE = `http://127.0.0.1:${PORT}/`;

// ── The answer key, straight from the packs ───────────────────────────
interface Key {
  right: string;
  bait: string | null;
  wrong: string;
  math: boolean;
}
const KEY = new Map<string, Key>();
const packs: Pack[] = [];
for (const file of readdirSync(join(root, 'src', 'packs')).filter((f) => f.endsWith('.ts'))) {
  const mod = (await import(pathToFileURL(join(root, 'src', 'packs', file)).href)) as { default: Pack };
  packs.push(mod.default);
  for (const q of mod.default.questions) {
    KEY.set(q.ask, {
      right: q.right,
      bait: q.bait === undefined ? null : q.wrong[q.bait]!,
      wrong: q.wrong[q.bait === 0 ? 1 : 0]!,
      math: q.kind === 'math',
    });
  }
}

// ── Reporting ─────────────────────────────────────────────────────────
const failures: string[] = [];
let checks = 0;
function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) {
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}
function section(name: string): void {
  console.log(`\n${name}`);
}

// ── Browser plumbing ──────────────────────────────────────────────────
const noise: string[] = [];
function watch(page: Page, label: string): void {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') noise.push(`[${label}] console ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => noise.push(`[${label}] page error: ${e.message}`));
  // A request the browser dropped because its page went away (a font still arriving when the
  // test moves on) is not a failure. One that could not be made, or was refused, still is.
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText !== 'net::ERR_ABORTED') noise.push(`[${label}] request failed: ${r.url()} (${r.failure()?.errorText ?? 'no reason given'})`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) noise.push(`[${label}] HTTP ${r.status()}: ${r.url()}`);
  });
}

interface PhoneOptions {
  width?: number;
  height?: number;
  reducedMotion?: boolean;
  /**
   * Stand in for the screen wake lock and count what the app asks of it.
   * Headless Chromium refuses the real one, so every other phone here plays
   * with the lock refused, which must be silent.
   */
  wakeLock?: boolean;
}
/** What the test hooks on the page have counted. */
interface Hooks {
  __skew: number;
  __fired: { blur: number; copy: number };
  __wake: { requests: number; held: number };
}
const hooks = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as Hooks;
    return { fired: { ...w.__fired }, wake: { ...w.__wake }, focused: document.hasFocus(), selection: String(document.getSelection() ?? '') };
  });
/** Make time pass on the page without waiting for it. */
const skew = (page: Page, ms: number) => page.evaluate((by) => ((window as unknown as Hooks).__skew += by), ms);

async function phone(browser: Browser, label: string, opts: PhoneOptions = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 390, height: opts.height ?? 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  // Lets a test make time pass on a question without waiting for it, and see
  // which events really reached the page.
  await ctx.addInitScript((fakeWakeLock) => {
    const w = window as unknown as Hooks;
    w.__skew = 0;
    const real = performance.now.bind(performance);
    performance.now = () => real() + w.__skew;
    w.__fired = { blur: 0, copy: 0 };
    window.addEventListener('blur', () => w.__fired.blur++);
    document.addEventListener('copy', () => w.__fired.copy++);
    w.__wake = { requests: 0, held: 0 };
    if (fakeWakeLock) {
      const request = async () => {
        w.__wake.requests++;
        w.__wake.held++;
        let held = true;
        return {
          release: async () => {
            if (held) w.__wake.held--;
            held = false;
          },
        };
      };
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    }
  }, opts.wakeLock ?? false);
  const page = await ctx.newPage();
  watch(page, label);
  return { ctx, page };
}

let shotCount = 0;
async function snap(page: Page, name: string): Promise<void> {
  shotCount++;
  await page.screenshot({ path: join(shots, `${String(shotCount).padStart(2, '0')}-${name}.png`) });
}

async function layout(page: Page, where: string): Promise<void> {
  const r = await page.evaluate(() => {
    const over = document.documentElement.scrollWidth - window.innerWidth;
    const small: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, input, summary'))) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.height < 43.5 || b.width < 43.5) small.push(`${el.className || el.tagName} ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    return { over, small };
  });
  check(`${where}: no sideways scroll`, r.over <= 0, `${r.over}px`);
  check(`${where}: every control at least 44px`, r.small.length === 0, r.small.slice(0, 4).join(', '));
}

const settle = (page: Page, ms = 330) => page.waitForTimeout(ms);

/** Which screen is up, where history thinks we are, and how far down the page is. */
const where = (page: Page) =>
  page.evaluate(() => ({
    stage: document.querySelector('.app')?.getAttribute('data-stage') ?? '',
    hash: window.location.hash,
    entries: window.history.length,
    scrollY: Math.round(window.scrollY),
    sheet: document.querySelector('dialog.sheet[open]') !== null,
    // "Question 3 of 8", read as 3/8.
    count: (document.querySelector('.bar__count')?.textContent ?? '').replace(/^\s*Question\s*/, '').replace(/\s*of\s*/, '/').trim(),
    answered: document.querySelectorAll('.answer:disabled').length,
  }));
/** What has keyboard focus: a button's name, or the element's class. */
const focusOn = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'nothing';
    if (el instanceof HTMLButtonElement) return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
    return el.id ? `#${el.id}` : `.${el.className}`;
  });
/** Wait for history to settle on a hash (the app shows a screen first and lets history catch up). */
const hashBecomes = (page: Page, hashes: string[]) =>
  page.waitForFunction((want) => want.includes(window.location.hash), hashes, { timeout: 2000 }).then(
    () => true,
    () => false,
  );
/** The system back or forward button, and the moment the app needs to react. */
async function press(page: Page, button: 'back' | 'forward'): Promise<void> {
  if (button === 'back') await page.goBack();
  else await page.goForward();
  await settle(page, 250);
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Pick = 'right' | 'bait' | 'wrong';
/** Time to sit on one question that is not math (slow is only suspicious on arithmetic). */
interface Idle {
  ms: number;
  done: boolean;
}

/** Answer the question on screen. Returns what the outcome should be. */
async function answer(
  page: Page,
  pick: Pick,
  opts: { awayMs?: number; dawdleMathMs?: number; keyboard?: boolean; idle?: Idle } = {},
): Promise<'hit' | 'trap' | 'miss'> {
  await page.locator('.ask').waitFor({ state: 'visible' });
  const ask = (await page.locator('.ask').innerText()).trim();
  const key = KEY.get(ask);
  if (!key) throw new Error(`question not found in any pack: "${ask}"`);

  if (opts.awayMs) {
    // Leave the app the way a phone does: the page goes hidden, then comes back.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await skew(page, opts.awayMs);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  if (opts.dawdleMathMs && key.math) {
    await skew(page, opts.dawdleMathMs);
  }
  if (opts.idle && !opts.idle.done && !key.math) {
    await skew(page, opts.idle.ms);
    opts.idle.done = true;
  }

  const text = pick === 'right' ? key.right : pick === 'bait' ? (key.bait ?? key.wrong) : key.wrong;
  const expected = pick === 'right' ? 'hit' : pick === 'bait' && key.bait ? 'trap' : 'miss';
  const button = page.locator('.answer').filter({ has: page.locator('.answer__text', { hasText: new RegExp(`^${esc(text)}$`) }) });
  check(`answer "${text.slice(0, 30)}" is on screen once`, (await button.count()) === 1, `found ${await button.count()}`);

  if (opts.keyboard) {
    const texts = await page.locator('.answer__text').allInnerTexts();
    await page.keyboard.press('abcd'[texts.findIndex((t) => t.trim() === text)]!);
  } else {
    await button.click();
  }
  const next = page.locator('.dock--play .btn--primary');
  const t0 = Date.now();
  await next.waitFor({ state: 'visible', timeout: 3000 });
  check('the reveal lands within 600ms', Date.now() - t0 < 600, `${Date.now() - t0}ms`);
  check('the right answer is marked', (await page.locator('.answer--right').count()) === 1);
  check('the "why" is shown', (await page.locator('.why__text').innerText()).trim().length > 20);
  return expected;
}

async function playRound(
  page: Page,
  picks: Pick[],
  opts: { awayOn?: number; dawdleMath?: boolean; keyboard?: boolean; snapAt?: number; label?: string; idle?: Idle } = {},
): Promise<('hit' | 'trap' | 'miss')[]> {
  const expected: ('hit' | 'trap' | 'miss')[] = [];
  for (let i = 0; i < picks.length; i++) {
    await settle(page);
    expected.push(
      await answer(page, picks[i]!, {
        awayMs: opts.awayOn === i ? 11_000 : undefined,
        dawdleMathMs: opts.dawdleMath ? 38_000 : undefined,
        keyboard: opts.keyboard,
        idle: opts.idle,
      }),
    );
    if (opts.snapAt === i) {
      await settle(page, 450);
      await snap(page, `${opts.label ?? 'play'}-revealed`);
      await layout(page, 'question, revealed');
      // A screen reader hears the verdict once and finds it in the page once.
      const said = await page.evaluate(() => {
        const regions = Array.from(document.querySelectorAll('.play [role="status"]'));
        const why = document.querySelector('.why__text')?.textContent ?? '';
        return { regions: regions.length, inside: regions[0]?.querySelector('.why__text') !== null, times: (document.querySelector('.play')?.textContent ?? '').split(why).length - 1 };
      });
      check('the verdict and explanation are in the page once, in one live region', said.regions === 1 && said.inside && said.times === 1, JSON.stringify(said));
    }
    if (opts.keyboard) await page.keyboard.press('Enter');
    else await page.locator('.dock--play .btn--primary').click();
  }
  return expected;
}

function scoreOf(outcomes: string[]): number {
  const points = [8, 8, 12, 12, 12, 16, 16, 16];
  return outcomes.reduce((n, o, i) => n + (o === 'hit' ? points[i]! : 0), 0);
}

async function tilesOf(page: Page, scope: string): Promise<string[]> {
  return page.locator(`${scope} .tile`).evaluateAll((els) => els.map((el) => (el.className.match(/tile--(hit|trap|miss)/) ?? [])[1] ?? '?'));
}

async function openPack(page: Page, title: string): Promise<void> {
  await page.locator('.pack', { has: page.locator('.pack__title', { hasText: new RegExp(`^${esc(title)}$`) }) }).click();
  await page.locator('.intro').waitFor({ state: 'visible' });
  await settle(page);
}

// ── Links ─────────────────────────────────────────────────────────────
/** What a challenge link carries. */
function wireOf(url: string): Record<string, any> {
  return JSON.parse(Buffer.from(url.split('#/c/')[1]!, 'base64url').toString('utf8')) as Record<string, any>;
}
/** The same link with its contents edited: stands in for a link made on another version of a pack. */
function withWire(url: string, edit: (wire: Record<string, any>) => void): string {
  const wire = wireOf(url);
  edit(wire);
  return `${url.split('#/c/')[0]}#/c/${Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url')}`;
}
/** Each side of a head-to-head: name, verdict and what the app noticed. */
async function sidesOf(page: Page): Promise<{ name: string; verdict: string; flag: string }[]> {
  return page.locator('.side').evaluateAll((els) =>
    els.map((el) => ({
      name: el.querySelector('.side__name')?.textContent?.trim() ?? '',
      verdict: el.querySelector('.side__verdict')?.textContent?.trim() ?? '',
      flag: el.querySelector('.side__flag')?.textContent?.trim() ?? '',
    })),
  );
}

// ── Serve the build ───────────────────────────────────────────────────
async function serve(): Promise<ChildProcess> {
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  let exited = false;
  child.once('exit', () => (exited = true));
  for (let i = 0; i < 80 && !exited; i++) {
    try {
      const res = await fetch(BASE);
      // Make sure it is this app answering, not something else on the machine.
      if (res.ok && (await res.text()).includes('<title>gatekeep</title>')) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  throw new Error(`the preview server did not come up as gatekeep on ${BASE} (is dist/ missing?)`);
}

// ── The flows ─────────────────────────────────────────────────────────
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
const server = await serve();
const browser = await chromium.launch();

try {
  // 1. Home, search, a full solo round with the app watching
  section('1. Home and search');
  const a = await phone(browser, 'sam', { wakeLock: true });
  await a.page.goto(BASE);
  await a.page.locator('.wordmark').waitFor();
  await settle(a.page, 500);
  await snap(a.page, 'home');
  await layout(a.page, 'home');
  check('home lists every pack', (await a.page.locator('.pack').count()) === packs.length, `${await a.page.locator('.pack').count()} of ${packs.length}`);
  check('home counts packs and questions', (await a.page.locator('.count').innerText()).includes(`${packs.length} packs. ${packs.length * 12} questions.`));

  const search = a.page.locator('#q');
  await search.fill('bartendr');
  check('a typo still finds Bartending first', (await a.page.locator('.pack__title').first().textContent()) === 'Bartending');
  await search.fill('grout');
  check('an alias finds the pack', (await a.page.locator('.pack__title').first().textContent()) === 'Bathroom Tile Work');
  // Both of the next two buttons disappear when pressed. Focus must not go with them.
  await search.press('Tab');
  check('Tab from the search box reaches "Clear search"', (await focusOn(a.page)) === 'Clear search', await focusOn(a.page));
  await a.page.keyboard.press('Enter');
  check('clearing the search puts focus back in the box', (await search.inputValue()) === '' && (await focusOn(a.page)) === '#q', await focusOn(a.page));
  await a.page.keyboard.type('zzzzqq');
  check('so typing carries straight on', (await search.inputValue()) === 'zzzzqq', await search.inputValue());
  check('no results says so', await a.page.getByText('No pack for that yet').isVisible());
  await snap(a.page, 'home-empty');
  await a.page.getByRole('button', { name: 'Show everything' }).focus();
  await a.page.keyboard.press('Enter');
  check('reset brings everything back', (await a.page.locator('.pack').count()) === packs.length);
  check('reset hands focus to the line above the list', (await focusOn(a.page)) === '.count', await focusOn(a.page));
  await a.page.keyboard.press('Tab');
  check('one Tab from there is the first pack', (await a.page.evaluate(() => document.activeElement === document.querySelector('.pack'))) === true, await focusOn(a.page));
  await a.page.locator('.chip', { hasText: 'Kitchen & Bar' }).click();
  const kitchen = packs.filter((p) => p.category === 'kitchen').length;
  check('a category chip filters', (await a.page.locator('.pack').count()) === kitchen, `${await a.page.locator('.pack').count()} of ${kitchen}`);
  await a.page.locator('.chip', { hasText: /^All$/ }).click();

  section('2. A solo round: leaves the app once, dawdles on the math');
  await openPack(a.page, 'Bartending');
  check('the pack is in the URL', a.page.url().endsWith('#/p/bartending'), a.page.url());
  check('the claim is on the intro', (await a.page.locator('.claim').innerText()).includes('bartend'));
  await snap(a.page, 'intro');
  await layout(a.page, 'intro');
  await a.page.locator('.field__input').fill('Sam');
  check('the screen is not held awake before a round', (await hooks(a.page)).wake.requests === 0);
  await a.page.getByRole('button', { name: /^Start/ }).click();
  await a.page.locator('.ask').waitFor();
  await settle(a.page, 450);
  await snap(a.page, 'question');
  await layout(a.page, 'question');
  check('the kind of question is hidden before answering', (await a.page.locator('.play__kind').count()) === 0);
  check('the live region for the verdict is there, empty, before the answer', (await a.page.locator('.play [role="status"]').evaluateAll((els) => els.map((el) => el.textContent).join('|'))) === '');
  // A phone that locks its own screen mid-question hides the page, which reads as leaving.
  check('the screen is held awake during a round', (await hooks(a.page)).wake.held === 1, JSON.stringify((await hooks(a.page)).wake));

  const samPicks: Pick[] = ['right', 'right', 'right', 'bait', 'right', 'right', 'wrong', 'right'];
  const samExpected = await playRound(a.page, samPicks, { awayOn: 1, dawdleMath: true, snapAt: 3, label: 'question' });

  section('3. The result');
  await a.page.locator('.result').waitFor();
  const wakeAfter = (await hooks(a.page)).wake;
  // The browser drops the lock when the page is hidden, so coming back asks again.
  check('the wake lock is taken again after leaving and coming back', wakeAfter.requests === 2, `${wakeAfter.requests} request(s)`);
  check('the screen is let go when the round ends', wakeAfter.held === 0, `${wakeAfter.held} still held`);
  await a.page.waitForTimeout(1500);
  await snap(a.page, 'result');
  await layout(a.page, 'result');
  const samScore = scoreOf(samExpected);
  check('the score is right', (await a.page.locator('.score__num').innerText()) === String(samScore), `${await a.page.locator('.score__num').innerText()} vs ${samScore}`);
  check('the tiles match what was answered', (await tilesOf(a.page, '.card')).join() === samExpected.join(), (await tilesOf(a.page, '.card')).join());
  const cardText = ((await a.page.locator('.card').textContent()) ?? '').replace(/\s+/g, ' ');
  check('the name, the pack and the claim are on the card', cardText.includes('Sam') && cardText.includes('Bartending') && cardText.includes('“'), cardText);
  const verdict = (await a.page.locator('.verdict').innerText()).trim();
  check('the verdict carries an asterisk', verdict.endsWith('*'), verdict);
  const pageText = await a.page.locator('.result').innerText();
  check('leaving the app is on the result', /Left the app once\. Gone 11 seconds\./.test(pageText), pageText.match(/Left the app[^\n]*/)?.[0] ?? 'missing');
  const hadMath = /Napkin math/.test(pageText);
  if (hadMath) check('slow math is on the result', /Took \d+ seconds on a math question|Took their time on \d math questions/.test(pageText));
  check('the breakdown is shown', (await a.page.locator('.breakdown__row').count()) >= 2);
  // Sam took the bait once, so one kind carries a note. Read aloud or copied, it is two phrases, not one word.
  const terms = await a.page.locator('.breakdown dt').evaluateAll((els) => els.map((el) => el.textContent ?? ''));
  const noted = terms.filter((t) => /took the bait|dodged/.test(t));
  check('a breakdown note is a separate phrase from its label', noted.length > 0 && noted.every((t) => /\S (took the bait|dodged)/.test(t)), JSON.stringify(terms));
  check('the primary action is on the first screen', await a.page.getByRole('button', { name: /Challenge a friend/ }).isVisible());

  await a.page.locator('.review summary').click();
  check('every question can be reviewed', (await a.page.locator('.review__item').count()) === 8);
  // The icons and the strike-through are for the eye. Each line also says, in words, what it is.
  const review = await a.page.locator('.review__item').evaluateAll((items) =>
    items.map((item) => ({
      outcome: (item.className.match(/review__item--(hit|trap|miss)/) ?? [])[1] ?? '?',
      lines: Array.from(item.querySelectorAll('.review__pick')).map((line) => (line.textContent ?? '').trim()),
    })),
  );
  check('the review matches what was answered', review.map((r) => r.outcome).join() === samExpected.join(), review.map((r) => r.outcome).join());
  check(
    'a right answer in the review says it was theirs and correct',
    review.filter((r) => r.outcome === 'hit').every((r) => r.lines.length === 1 && r.lines[0]!.startsWith('Your answer, correct: ')),
    JSON.stringify(review.find((r) => r.outcome === 'hit')),
  );
  check(
    'a wrong answer in the review says which line was theirs and which is correct',
    review.filter((r) => r.outcome !== 'hit').every((r) => r.lines.length === 2 && r.lines[0]!.startsWith('Your answer, wrong: ') && r.lines[1]!.startsWith('Correct answer: ')),
    JSON.stringify(review.find((r) => r.outcome !== 'hit')),
  );
  const tag = await a.page.locator('.review__tag').evaluateAll((els) =>
    els.map((el) => {
      const lines = new Set(Array.from(el.getClientRects()).map((r) => Math.round(r.top)));
      return { display: getComputedStyle(el).display, lines: lines.size, said: (el.parentElement?.textContent ?? '').endsWith(' Rookie trap') };
    }),
  );
  // An inline-block sits in the line of text: the pick's strike-through skips it and it cannot wrap in two.
  check('the rookie-trap label in the review is whole, on one line and not struck through', tag.length === 1 && tag[0]!.display === 'inline-block' && tag[0]!.lines === 1 && tag[0]!.said, JSON.stringify(tag));
  await a.page.locator('.review').scrollIntoViewIfNeeded();
  await snap(a.page, 'result-review');
  await a.page.evaluate(() => window.scrollTo(0, 0));

  await a.page.getByRole('button', { name: 'Share result' }).click();
  await settle(a.page);
  const shared = await a.page.evaluate(() => navigator.clipboard.readText());
  check('share text names the pack and the score', shared.includes('gatekeep · Bartending') && shared.includes(`(${samScore}/100)`), shared.split('\n')[1]);
  check('share text gives away no answers', !/\$|vermouth|ice|pour/i.test(shared.split('\n').slice(0, 4).join(' ')));
  check('a toast confirms the copy', await a.page.locator('.toast').isVisible());

  await a.page.waitForTimeout(400);
  await a.page.getByRole('button', { name: /Challenge a friend/ }).click();
  await settle(a.page);
  const challengeText = await a.page.evaluate(() => navigator.clipboard.readText());
  const challengeUrl = challengeText.match(/https?:\/\/\S+#\/c\/[A-Za-z0-9_-]+/)?.[0] ?? '';
  check('the challenge is a link', challengeUrl !== '', challengeText);

  section('4. Pass the phone');
  await a.page.waitForTimeout(400);
  await a.page.getByRole('button', { name: 'Pass the phone' }).click();
  await a.page.locator('.intro').waitFor();
  await settle(a.page);
  check('the handoff does not prefill the last name', (await a.page.locator('.field__input').inputValue()) === '');
  check('the handoff hides nothing it should show', (await a.page.locator('.claim').innerText()).includes('Hand it over'));
  await snap(a.page, 'handoff');
  await a.page.locator('.field__input').fill('Jo');
  await a.page.getByRole('button', { name: /^Start/ }).click();
  const joExpected = await playRound(a.page, ['right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']);
  await a.page.locator('.versus').waitFor();
  await a.page.waitForTimeout(1400);
  await snap(a.page, 'versus');
  await layout(a.page, 'head to head');
  check('the winner is named', (await a.page.locator('.versus__headline').innerText()).replace(/\s+/g, ' ') === `Jo wins by ${100 - samScore}`, await a.page.locator('.versus__headline').innerText());
  check('both scores are shown', (await a.page.locator('.side__score').allInnerTexts()).join() === `${samScore},100`);
  check('both tile rows are shown', (await tilesOf(a.page, '.matrix')).join() === [...samExpected, ...joExpected].join());
  check('where they differed is said', /They disagreed on questions 4 and 7\./.test(await a.page.locator('.versus__split').innerText()), await a.page.locator('.versus__split').innerText());
  check('Jo was asked the same questions', true);
  // Sam was shown all eight answers on this phone. Passing it on is the point, not a second look.
  check('passing the phone is not held against the second player', (await sidesOf(a.page))[1]?.flag === 'Clean round.', (await sidesOf(a.page))[1]?.flag);
  check('the screen is let go after the second round too', (await hooks(a.page)).wake.held === 0);
  await a.page.getByRole('button', { name: /Rematch/ }).click();
  await a.page.locator('.intro').waitFor();
  check('a rematch goes back to the pack', a.page.url().endsWith('#/p/bartending'));
  await a.ctx.close();

  // 5. The challenge link, opened on another phone
  section('5. A challenge link on another phone');
  const b = await phone(browser, 'ana', { width: 360, height: 740 });
  await b.page.goto(challengeUrl.replace(/^https?:\/\/[^/]+\//, BASE));
  await b.page.locator('.intro').waitFor();
  await settle(b.page, 500);
  await snap(b.page, 'challenge-intro');
  await layout(b.page, 'challenge intro (360 wide)');
  check('the challenger and score are named', (await b.page.locator('.claim').innerText()).includes(`Sam scored ${samScore}*`), await b.page.locator('.claim').innerText());
  await b.page.locator('.field__input').fill('Ana');
  await b.page.getByRole('button', { name: /Take the challenge/ }).click();
  await b.page.locator('.ask').waitFor();
  await settle(b.page, 450);
  await layout(b.page, 'question (360 wide)');
  const anaExpected = await playRound(b.page, ['right', 'bait', 'right', 'right', 'right', 'right', 'right', 'right'], { snapAt: 0, label: 'small-question' });
  await b.page.locator('.versus').waitFor();
  await b.page.waitForTimeout(1300);
  await snap(b.page, 'versus-reply');
  await layout(b.page, 'head to head (360 wide)');
  const anaScore = scoreOf(anaExpected);
  check('the reply compares against the sender', (await b.page.locator('.side__name').allInnerTexts()).join() === 'Sam,Ana');
  check('the sender’s tiles came through the link intact', (await tilesOf(b.page, '.matrix')).slice(0, 8).join() === samExpected.join());
  await b.page.getByRole('button', { name: /Send it back to Sam/ }).click();
  await settle(b.page);
  const replyText = await b.page.evaluate(() => navigator.clipboard.readText());
  const replyUrl = replyText.match(/https?:\/\/\S+#\/c\/[A-Za-z0-9_-]+/)?.[0] ?? '';
  check('the reply is a link', replyUrl !== '');
  check('a reply on the same questions is written the way links always were', !('x' in wireOf(replyUrl)) && wireOf(replyUrl).r?.g?.length === 5, JSON.stringify(wireOf(replyUrl)));
  await b.ctx.close();

  section('6. The reply link, opened by anyone');
  const c = await phone(browser, 'viewer', { width: 430, height: 932 });
  await c.page.goto(replyUrl.replace(/^https?:\/\/[^/]+\//, BASE));
  await c.page.locator('.versus').waitFor();
  await c.page.waitForTimeout(1300);
  await snap(c.page, 'versus-spectate');
  await layout(c.page, 'head to head (430 wide)');
  check('both results open from one link', (await c.page.locator('.side__score').allInnerTexts()).join() === `${samScore},${anaScore}`);
  check('a spectator can start their own round', await c.page.getByRole('button', { name: /Take a round yourself/ }).isVisible());

  section('7. Bad links');
  await c.page.goto(`${BASE}#/c/not-a-real-challenge`);
  await c.page.locator('.wordmark').waitFor();
  check('a broken challenge link lands on home with a word about it', await c.page.getByText('That challenge link is broken or out of date.').isVisible());
  await c.page.goto(`${BASE}#/p/no-such-pack`);
  await c.page.waitForTimeout(300);
  check('an unknown pack lands on home with a word about it', await c.page.getByText('That pack is not here.').isVisible());
  // The same explanation twice running: the second one is as new to the person as the first.
  await c.page.waitForTimeout(2600);
  check('the word about it clears', (await c.page.locator('.toast').count()) === 0);
  await c.page.goto(`${BASE}#/p/no-such-pack-either`);
  await c.page.waitForTimeout(300);
  check('a second bad link in the same tab gets its word too', await c.page.getByText('That pack is not here.').isVisible());

  // Links get copied out of sentences and passed through other apps.
  const code = challengeUrl.split('#/c/')[1]!;
  for (const [what, hash] of [
    ['a full stop stuck on the end', `#/c/${code}.`],
    ['a closing bracket and a comma on the end', `#/c/${code}),`],
    ['a tracking parameter on the end', `#/c/${code}?utm_source=share`],
    ['its slashes percent-encoded', `#%2Fc%2F${code}`],
  ] as const) {
    await c.page.goto(`${BASE}#/`);
    await c.page.locator('.packs').waitFor();
    await c.page.goto(`${BASE}${hash}`);
    await c.page.waitForTimeout(300);
    check(`a challenge link with ${what} still opens`, await c.page.getByRole('button', { name: /Take the challenge/ }).isVisible(), await c.page.locator('.app').getAttribute('data-stage') ?? '');
  }
  await c.ctx.close();

  // 8. Keyboard only, reduced motion, quitting, the back button, a double tap
  section('8. Keyboard, reduced motion, quitting');
  const d = await phone(browser, 'keys', { reducedMotion: true });
  await d.page.goto(`${BASE}#/p/poker`);
  await d.page.locator('.intro').waitFor();
  await d.page.locator('.field__input').fill('Kit');
  await d.page.keyboard.press('Enter');
  await d.page.locator('.ask').waitFor();
  await settle(d.page);

  // Three things an honest player does mid-question that are not leaving.
  // 1. Tab past the last answer: focus steps into the browser's own controls
  //    and the window blurs, for as long as it takes to tab back.
  for (let i = 0; i < 5; i++) await d.page.keyboard.press('Tab');
  const out = await hooks(d.page);
  check('Tab past the last answer steps off the page', !out.focused && out.fired.blur === 1, `focused ${out.focused}, ${out.fired.blur} blur(s)`);
  await skew(d.page, 6000);
  await d.page.keyboard.press('Tab');
  check('one more Tab steps back on', (await hooks(d.page)).focused);
  // 2. A notification banner: the window loses focus for half a second.
  await d.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await skew(d.page, 600);
  await d.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  // 3. The copy shortcut with nothing selected (C is also an answer key).
  await d.page.keyboard.press('ControlOrMeta+c');
  const copied = await hooks(d.page);
  check('the copy shortcut fires with nothing selected', copied.fired.copy === 1 && copied.selection === '', `${copied.fired.copy} copy event(s), "${copied.selection}" selected`);
  check('the copy shortcut does not answer C', (await d.page.locator('.answer--right').count()) === 0);

  // 4. Open the quit sheet and think better of it, all from the keyboard.
  await d.page.getByRole('button', { name: 'Quit this round' }).focus();
  await d.page.keyboard.press('Enter');
  check('the quit sheet opens with focus on "Keep going"', (await where(d.page)).sheet && (await focusOn(d.page)) === 'Keep going', await focusOn(d.page));
  check('the question behind the sheet cannot be reached', await d.page.locator('dialog.sheet').evaluate((el) => el.matches(':modal')));
  await d.page.keyboard.press('Escape');
  check('Escape closes the sheet and puts focus back on the button that opened it', !(await where(d.page)).sheet && (await focusOn(d.page)) === 'Quit this round', await focusOn(d.page));
  await d.page.keyboard.press('Enter');
  // Shift+Tab from the first button used to land on answer D, behind the sheet, where Space answered it.
  const stops: string[] = [];
  for (let i = 0; i < 3; i++) {
    await d.page.keyboard.press('Shift+Tab');
    stops.push(await focusOn(d.page));
  }
  check('Tab stays inside the sheet (and the browser\'s own controls)', stops.join() === 'nothing,Quit,Keep going', stops.join());
  await d.page.keyboard.press('b');
  check('an answer key does nothing while the sheet is up', (await where(d.page)).answered === 0 && (await where(d.page)).sheet);
  const blursBefore = (await hooks(d.page)).fired.blur;
  await d.page.keyboard.press('Enter');
  check('"Keep going" puts focus back on the button that opened the sheet', !(await where(d.page)).sheet && (await focusOn(d.page)) === 'Quit this round', await focusOn(d.page));
  await d.page.keyboard.press('Tab');
  // It used to step off the page from here, which reads as leaving the app.
  const afterTab = await hooks(d.page);
  check(
    'the next Tab goes to the first answer, not out of the page',
    afterTab.focused && afterTab.fired.blur === blursBefore && (await d.page.evaluate(() => document.activeElement === document.querySelector('.answer'))),
    `${await focusOn(d.page)}, ${afterTab.fired.blur - blursBefore} blur(s)`,
  );

  const kit = await playRound(d.page, ['right', 'wrong', 'right', 'right', 'bait', 'right', 'right', 'right'], { keyboard: true });
  await d.page.locator('.result').waitFor();
  check('a whole round works from the keyboard', (await tilesOf(d.page, '.card')).join() === kit.join());
  check('reduced motion shows the score at once', (await d.page.locator('.score__num').innerText()) === String(scoreOf(kit)));
  check('a clean round has no asterisk', !(await d.page.locator('.verdict').innerText()).includes('*'));
  const noticed = (await d.page.locator('.noticed').count()) ? (await d.page.locator('.noticed').innerText()).replace(/\s+/g, ' ') : '';
  check('tabbing off the page, a banner, an empty copy and a look at the quit sheet are not held against anyone', !/Left the app|Copied text/.test(noticed), noticed);
  await settle(d.page);
  await d.page.getByRole('button', { name: /Play again/ }).scrollIntoViewIfNeeded();
  await d.page.getByRole('button', { name: /Play again/ }).click();
  await d.page.locator('.intro').waitFor();
  await d.page.waitForTimeout(300);
  check('the name is remembered for next time', (await d.page.locator('.field__input').inputValue()) === 'Kit');
  await d.page.getByRole('button', { name: /^Start/ }).click();
  await d.page.locator('.ask').waitFor();
  await d.page.waitForTimeout(300);
  await d.page.getByRole('button', { name: 'Quit this round' }).click();
  check('quitting asks first', await d.page.getByText('Walk away mid-round?').isVisible());
  await snap(d.page, 'quit-sheet');
  await d.page.getByRole('button', { name: 'Keep going' }).click();
  check('keep going stays on the question', await d.page.locator('.ask').isVisible());
  await d.page.getByRole('button', { name: 'Quit this round' }).click();
  await d.page.getByRole('button', { name: /^Quit$/ }).click();
  await d.page.locator('.wordmark').waitFor();
  // Home shows at once; the address follows as history steps back off the round.
  await hashBecomes(d.page, ['#/']);
  check('quitting goes home', d.page.url().endsWith('#/'), d.page.url());
  await d.page.waitForTimeout(300);
  check('the best score shows on the pack', (await d.page.locator('.pack', { hasText: "No-Limit Hold'em" }).locator('.pack__best').innerText()) === String(scoreOf(kit)));

  // The system back button mid-round is the X by another name: it asks, it does not leave.
  await d.page.locator('.pack', { hasText: "No-Limit Hold'em" }).click();
  await d.page.locator('.intro').waitFor();
  await d.page.waitForTimeout(300);
  await d.page.getByRole('button', { name: /^Start/ }).click();
  await d.page.locator('.ask').waitFor();
  await settle(d.page);
  await press(d.page, 'back');
  const asked = await where(d.page);
  check('the back button mid-round asks before leaving', asked.stage === 'play' && asked.sheet && asked.count === '1/8' && (await d.page.getByText('Walk away mid-round?').isVisible()), JSON.stringify(asked));
  await d.page.getByRole('button', { name: /^Quit$/ }).click();
  await d.page.locator('.packs').waitFor();
  check('quitting from there goes home', (await d.page.locator('.pack').count()) === packs.length);
  await hashBecomes(d.page, ['#/']);
  // This tab opened on a link to the pack, so there is nothing of ours behind Home.
  await settle(d.page);
  await d.page.goBack();
  check('back on home then leaves: the pack that was quit does not come back', d.page.url() === 'about:blank', d.page.url());
  await d.ctx.close();

  section('9. A double tap never skips a screen');
  const e = await phone(browser, 'doubletap');
  // This phone's best at espresso is a perfect round that carried an asterisk.
  const espresso = e.page.locator('.pack', { has: e.page.locator('.pack__title', { hasText: new RegExp(`^${esc(packs.find((p) => p.id === 'espresso')!.title)}$`) }) });
  await e.page.goto(BASE);
  await e.page.evaluate(() => localStorage.setItem('gatekeep:bests', JSON.stringify({ espresso: { score: 100, flagged: true } })));
  await e.page.reload();
  await e.page.locator('.packs').waitFor();
  check('a best that carried an asterisk shows it', (await espresso.locator('.pack__best').innerText()) === '100*', await espresso.locator('.pack__best').innerText());
  await e.page.goto(`${BASE}#/p/espresso`);
  await e.page.locator('.intro').waitFor();
  await e.page.waitForTimeout(300);
  await e.page.getByRole('button', { name: /^Start/ }).click();
  for (let i = 0; i < 8; i++) {
    await settle(e.page);
    await answer(e.page, 'right');
    const next = e.page.locator('.dock--play .btn--primary');
    const box = (await next.boundingBox())!;
    // Two taps in the same spot, 60ms apart.
    await e.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await e.page.waitForTimeout(60);
    await e.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    if (i < 7) {
      await e.page.waitForTimeout(350);
      check(`double tap on Next lands on question ${i + 2}`, ((await e.page.locator('.bar__count').textContent()) ?? '').endsWith(`${i + 2} of 8`), (await e.page.locator('.bar__count').textContent()) ?? '');
    }
  }
  await e.page.waitForTimeout(500);
  check('a double tap on "See the verdict" stays on the result', await e.page.locator('.result').isVisible());
  check('a perfect round is certified', /^Certified/.test(await e.page.locator('.verdict').innerText()), await e.page.locator('.verdict').innerText());
  await snap(e.page, 'result-perfect');
  check('the perfect round was a clean one', !(await e.page.locator('.verdict').innerText()).includes('*'));
  await e.page.getByRole('button', { name: 'Back to all packs' }).click();
  await e.page.locator('.packs').waitFor();
  await settle(e.page);
  check('a clean round at the same score takes the asterisk off the best', (await espresso.locator('.pack__best').innerText()) === '100', await espresso.locator('.pack__best').innerText());

  // A swap inside a screen is the same hazard: the empty search gives way to
  // the list, and a pack lands under the thumb that pressed "Show everything".
  await e.page.locator('#q').fill('zzzzqq');
  const everything = (await e.page.getByRole('button', { name: 'Show everything' }).boundingBox())!;
  await e.page.touchscreen.tap(everything.x + everything.width / 2, everything.y + everything.height / 2);
  await e.page.waitForTimeout(100);
  await e.page.touchscreen.tap(everything.x + everything.width / 2, everything.y + everything.height / 2);
  await e.page.waitForTimeout(400);
  check(
    'a double tap on "Show everything" shows everything and opens nothing',
    (await where(e.page)).stage === 'home' && (await e.page.locator('.pack').count()) === packs.length,
    JSON.stringify(await where(e.page)),
  );
  await e.ctx.close();

  // And the one that costs a question: "Keep going" sits over the answers, and
  // an answer cannot be taken back. A short phone, where the page scrolls.
  const e2 = await phone(browser, 'doubletap-sheet', { width: 360, height: 560 });
  await e2.page.goto(`${BASE}#/p/plumbing`);
  await e2.page.locator('.intro').waitFor();
  await e2.page.waitForTimeout(300);
  await e2.page.getByRole('button', { name: /^Start/ }).click();
  await e2.page.locator('.ask').waitFor();
  await settle(e2.page, 450);
  await e2.page.getByRole('button', { name: 'Quit this round' }).click();
  await settle(e2.page);
  const keep = (await e2.page.getByRole('button', { name: 'Keep going' }).boundingBox())!;
  const spot = { x: keep.x + keep.width / 2, y: keep.y + keep.height / 2 };
  // Scroll the question behind the sheet until an answer is under that spot.
  const answerUnder = await e2.page.evaluate(({ x, y }) => {
    const answers = Array.from(document.querySelectorAll('.answer'));
    const max = document.documentElement.scrollHeight - window.innerHeight;
    for (const el of answers.reverse()) {
      const box = el.getBoundingClientRect();
      const to = window.scrollY + box.top + box.height / 2 - y;
      if (to >= 0 && to <= max) {
        window.scrollTo(0, to);
        break;
      }
    }
    return answers.some((el) => {
      const box = el.getBoundingClientRect();
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    });
  }, spot);
  check('an answer sits under "Keep going"', answerUnder);
  await e2.page.touchscreen.tap(spot.x, spot.y);
  await e2.page.waitForTimeout(100);
  await e2.page.touchscreen.tap(spot.x, spot.y);
  await e2.page.waitForTimeout(400);
  const kept = await where(e2.page);
  check('a double tap on "Keep going" closes the sheet and answers nothing', !kept.sheet && kept.answered === 0 && kept.count === '1/8', JSON.stringify(kept));
  // Nor does a tap anywhere else on an answer in the moment the sheet goes.
  await e2.page.evaluate(() => window.scrollTo(0, 0));
  await e2.page.getByRole('button', { name: 'Quit this round' }).click();
  await settle(e2.page);
  const answerA = (await e2.page.locator('.answer').first().boundingBox())!;
  await e2.page.touchscreen.tap(spot.x, spot.y);
  await e2.page.touchscreen.tap(answerA.x + answerA.width / 2, answerA.y + answerA.height / 2);
  await e2.page.waitForTimeout(120);
  check('a tap on an answer as the sheet closes is ignored', !(await where(e2.page)).sheet && (await where(e2.page)).answered === 0, JSON.stringify(await where(e2.page)));
  await settle(e2.page);
  await e2.page.touchscreen.tap(answerA.x + answerA.width / 2, answerA.y + answerA.height / 2);
  await e2.page.locator('.why').waitFor({ timeout: 2000 }).catch(() => {});
  check('a moment later the same tap answers', (await where(e2.page)).answered === 4);
  await e2.ctx.close();

  section('10. Every pack opens and plays a first question');
  const f = await phone(browser, 'all-packs');
  for (const pack of packs) {
    await f.page.goto(`${BASE}#/p/${pack.id}`);
    await f.page.locator('.intro').waitFor();
    await f.page.waitForTimeout(280);
    await f.page.getByRole('button', { name: /^Start/ }).click();
    await f.page.locator('.ask').waitFor();
    await f.page.waitForTimeout(280);
    const over = await f.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${pack.id}: first question fits`, over <= 0, `${over}px`);
    await answer(f.page, 'bait');
    await f.page.goto(BASE);
    await f.page.locator('.wordmark').waitFor();
  }
  // Every one of those rounds was started with the name left blank.
  check('skipping the name stores no stand-in name', (await f.page.evaluate(() => localStorage.getItem('gatekeep:name'))) === null, String(await f.page.evaluate(() => localStorage.getItem('gatekeep:name'))));
  await f.ctx.close();

  section('11. The same challenge twice on one phone, and what a reply link remembers');
  const allRight: Pick[] = ['right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'];
  // Sam's link as it reads once the pack has been edited: its fingerprint no longer matches.
  const editedSince = (url: string) => withWire(url, (w) => (w.f = 'old111'));
  const g = await phone(browser, 'again');
  await g.page.goto(editedSince(challengeUrl));
  await g.page.locator('.intro').waitFor();
  await settle(g.page);
  check('a challenge on an edited pack says the questions will differ', (await g.page.locator('.intro__note').innerText()).includes('updated after Sam played'), await g.page.locator('.intro__note').innerText());
  // A second Sam takes it. The name arrives with a right-to-left override in
  // front, which would print the rest of every line it appears in backwards.
  await g.page.locator('.field__input').fill('\u202esam');
  await g.page.getByRole('button', { name: /Take the challenge/ }).click();
  await g.page.locator('.ask').waitFor();
  // Reloading before anything has been answered has shown nobody anything.
  await g.page.reload();
  await g.page.locator('.intro').waitFor();
  await settle(g.page);
  check('the name is remembered as typed, less the invisible override', (await g.page.locator('.field__input').inputValue()) === 'sam', JSON.stringify(await g.page.locator('.field__input').inputValue()));
  await g.page.getByRole('button', { name: /Take the challenge/ }).click();
  // One question is left open for 25 hours with the app in front the whole time.
  const day: Idle = { ms: 25 * 3600 * 1000, done: false };
  await playRound(g.page, allRight, { idle: day });
  check('a question was left open for a day', day.done);
  await g.page.locator('.versus').waitFor();
  await g.page.waitForTimeout(1300);
  const first = await sidesOf(g.page);
  check('two players with the same name can be told apart', first.map((p) => p.name).join() === 'Sam,sam 2', first.map((p) => p.name).join());
  check('the winner is named without doubt', (await g.page.locator('.versus__headline').innerText()).replace(/\s+/g, ' ') === `sam 2 wins by ${100 - samScore}`, await g.page.locator('.versus__headline').innerText());
  check('reloading before any answer is shown leaves a clean round', first[1]?.flag === 'Clean round.' && !first[1].verdict.includes('*'), `${first[1]?.verdict} / ${first[1]?.flag}`);
  check('the head-to-head says the questions differed', (await g.page.locator('.versus__note').innerText()).includes('The pack changed between their rounds') && (await g.page.locator('.versus__split').count()) === 0);
  await g.page.getByRole('button', { name: /Send it back to Sam/ }).click();
  await settle(g.page);
  const mixedReply = (await g.page.evaluate(() => navigator.clipboard.readText())).match(/https?:\/\/\S+#\/c\/[A-Za-z0-9_-]+/)?.[0] ?? '';
  check('the reply link says for itself that the questions differed', mixedReply !== '' && wireOf(mixedReply).x === 1 && wireOf(mixedReply).f !== 'old111', mixedReply && JSON.stringify(wireOf(mixedReply)));
  check('a first go carries no second look', wireOf(mixedReply).r?.g?.length === 5);
  check('the day-long round is written within what a link may carry', wireOf(mixedReply).r?.t === 86_400, String(wireOf(mixedReply).r?.t));

  // Now the cheapest cheat there is: all eight answers have been shown, so
  // open the link again and play them back.
  await g.page.waitForTimeout(400);
  await g.page.reload();
  await g.page.locator('.intro').waitFor();
  await settle(g.page);
  await g.page.getByRole('button', { name: /Take the challenge/ }).click();
  await playRound(g.page, allRight);
  await g.page.locator('.versus').waitFor();
  await g.page.waitForTimeout(1300);
  const second = await sidesOf(g.page);
  check('a second go at the same challenge carries an asterisk', second[1]?.verdict.endsWith('*') === true, second[1]?.verdict);
  check('and the head-to-head says why', second[1]?.flag === 'Second look at these questions.', second[1]?.flag);
  await snap(g.page, 'versus-second-look');
  await layout(g.page, 'head to head, second look');
  await g.page.getByRole('button', { name: /Send it back to Sam/ }).click();
  await settle(g.page);
  const secondLook = (await g.page.evaluate(() => navigator.clipboard.readText())).match(/https?:\/\/\S+#\/c\/[A-Za-z0-9_-]+/)?.[0] ?? '';
  check('the second look travels in the link', secondLook !== '' && JSON.stringify(wireOf(secondLook).r?.g) === '[0,0,0,0,0,1]', secondLook && JSON.stringify(wireOf(secondLook).r?.g));
  check('the best score remembers the clean round, not the second look', (await g.page.evaluate(() => localStorage.getItem('gatekeep:bests'))) === '{"bartending":{"score":100,"flagged":false}}', String(await g.page.evaluate(() => localStorage.getItem('gatekeep:bests'))));
  await g.ctx.close();

  // Whoever opens a reply is told what the replier was told.
  const h = await phone(browser, 'viewer-2');
  await h.page.goto(mixedReply);
  await h.page.waitForTimeout(600);
  check('a reply from a round that sat open for a day still opens', await h.page.locator('.versus').isVisible(), await h.page.locator('.app').getAttribute('data-stage') ?? '');
  check(
    'opened by anyone, a reply on an edited pack still says the questions differed',
    (await h.page.locator('.versus').isVisible()) &&
      (await h.page.locator('.versus__note').innerText()).includes('The pack changed between their rounds') &&
      (await h.page.locator('.versus__split').count()) === 0 &&
      (await h.page.locator('.tiles__cell--ring').count()) === 0,
  );
  await h.page.goto(`${BASE}#/`);
  await h.page.locator('.packs').waitFor();
  await h.page.goto(secondLook);
  await h.page.locator('.versus').waitFor();
  await h.page.waitForTimeout(600);
  const opened = await sidesOf(h.page);
  check('opened by anyone, the second look is still on it', opened[1]?.verdict.endsWith('*') === true && opened[1]?.flag === 'Second look at these questions.', `${opened[1]?.verdict} / ${opened[1]?.flag}`);
  // And the other way round: Sam and Ana played the same eight, and the pack was edited afterwards.
  await h.page.goto(`${BASE}#/`);
  await h.page.locator('.packs').waitFor();
  await h.page.goto(editedSince(replyUrl));
  await h.page.locator('.versus').waitFor();
  await h.page.waitForTimeout(600);
  check(
    'a finished head-to-head still says the questions matched after the pack is edited',
    (await h.page.locator('.versus__note').innerText()) === 'Same eight questions. Same order.' &&
      (await h.page.locator('.versus__split').count()) === 1 &&
      (await h.page.locator('.tiles__cell--ring').count()) > 0,
    await h.page.locator('.versus__note').innerText(),
  );
  await h.ctx.close();

  section('12. The back button, and the app\'s own ways back');
  const k = await phone(browser, 'back');
  await k.page.goto(BASE);
  await k.page.locator('.packs').waitFor();
  await settle(k.page);
  const atStart = (await where(k.page)).entries;
  for (const pack of packs.slice(0, 3)) {
    await openPack(k.page, pack.title);
    await k.page.getByRole('button', { name: 'Back to all packs' }).click();
    await k.page.locator('.packs').waitFor();
    await settle(k.page);
  }
  // Each "back to all packs" pops the pack it leaves. It used to push another
  // Home on top, so the system back button replayed every screen just closed.
  let now = await where(k.page);
  check('opening and closing three packs leaves history where it was', now.entries === atStart + 1 && ['', '#/'].includes(now.hash), JSON.stringify(now));

  // Home keeps its search, its filter and its place in the list while a pack is looked at.
  const homeIs = async () => `${await k.page.locator('#q').inputValue()} / ${await k.page.locator('.chip[aria-pressed="true"]').innerText()} / ${await k.page.locator('.pack').count()}`;
  await k.page.locator('#q').fill('tile');
  await k.page.locator('.chip', { hasText: 'Trades' }).click();
  const narrowed = await k.page.locator('.pack').count();
  check('a search and a category narrow the list', narrowed > 0 && narrowed < packs.length, String(narrowed));
  await k.page.locator('.pack').first().click();
  await k.page.locator('.intro').waitFor();
  await settle(k.page);
  await k.page.getByRole('button', { name: 'Back to all packs' }).click();
  await k.page.locator('.packs').waitFor();
  await settle(k.page);
  check('the search and the category survive a look at a pack', (await homeIs()) === `tile / Trades / ${narrowed}`, await homeIs());
  await k.page.locator('.pack').first().click();
  await k.page.locator('.intro').waitFor();
  await settle(k.page);
  await press(k.page, 'back');
  await k.page.locator('.packs').waitFor();
  check('and they survive the system back button', (await homeIs()) === `tile / Trades / ${narrowed}`, await homeIs());
  await k.page.getByRole('button', { name: 'Clear search' }).click();
  await k.page.locator('.chip', { hasText: /^All$/ }).click();
  const far = k.page.locator('.pack').nth(packs.length - 5);
  await far.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await settle(k.page, 150);
  const leftAt = (await where(k.page)).scrollY;
  check('the list is long enough to lose your place in', leftAt > 400, `${leftAt}px`);
  await far.click();
  await k.page.locator('.intro').waitFor();
  await settle(k.page);
  check('a pack opens at the top of the page', (await where(k.page)).scrollY === 0, `${(await where(k.page)).scrollY}px`);
  await k.page.getByRole('button', { name: 'Back to all packs' }).click();
  await k.page.locator('.packs').waitFor();
  await settle(k.page);
  check('the list is where it was left', Math.abs((await where(k.page)).scrollY - leftAt) <= 2, `${(await where(k.page)).scrollY}px, left at ${leftAt}px`);
  await far.click();
  await k.page.locator('.intro').waitFor();
  await settle(k.page);
  await press(k.page, 'back');
  await k.page.locator('.packs').waitFor();
  await settle(k.page);
  check('and after the system back button too', Math.abs((await where(k.page)).scrollY - leftAt) <= 2, `${(await where(k.page)).scrollY}px, left at ${leftAt}px`);

  // A round started from Home. Back in the middle of it must not throw it away.
  await openPack(k.page, 'Bartending');
  await k.page.locator('.field__input').fill('Bo');
  await k.page.getByRole('button', { name: /^Start/ }).click();
  const bo = await playRound(k.page, ['right', 'bait']);
  await settle(k.page);
  await press(k.page, 'back');
  now = await where(k.page);
  check('the back button mid-round keeps the round and asks, as the X does', now.stage === 'play' && now.sheet && now.count === '3/8', JSON.stringify(now));
  await press(k.page, 'back');
  now = await where(k.page);
  check('back again closes the sheet, still on the question', now.stage === 'play' && !now.sheet && now.count === '3/8' && now.answered === 0, JSON.stringify(now));
  await press(k.page, 'back');
  await k.page.getByRole('button', { name: 'Keep going' }).click();
  await settle(k.page);
  bo.push(...(await playRound(k.page, ['right', 'right', 'right', 'right', 'right', 'right'])));
  await k.page.locator('.result').waitFor();
  check('the interrupted round finishes as it was played', (await tilesOf(k.page, '.card')).join() === bo.join(), (await tilesOf(k.page, '.card')).join());
  check('being asked, and carrying on, is not held against anyone', !(await k.page.locator('.verdict').innerText()).includes('*'), await k.page.locator('.verdict').innerText());

  // A result is finished business: Back leaves it for Home in one press.
  await settle(k.page);
  await press(k.page, 'back');
  now = await where(k.page);
  check('the back button on a result goes home in one press', now.stage === 'home' && ['', '#/'].includes(now.hash), JSON.stringify(now));
  // It is not gone for good: forward is the pack, and forward again the result.
  await press(k.page, 'forward');
  check('forward from there is the pack', (await where(k.page)).stage === 'intro', JSON.stringify(await where(k.page)));
  await press(k.page, 'forward');
  check('and forward again is the result that was left', (await where(k.page)).stage === 'result' && (await tilesOf(k.page, '.card')).join() === bo.join(), JSON.stringify(await where(k.page)));
  await k.page.waitForTimeout(400);
  await k.page.getByRole('button', { name: 'Pass the phone' }).click();
  await k.page.locator('.intro').waitFor();
  await settle(k.page);
  await press(k.page, 'back');
  check('the back button on the handoff goes back to the result', (await where(k.page)).stage === 'result', JSON.stringify(await where(k.page)));
  await k.page.waitForTimeout(400);
  await k.page.getByRole('button', { name: 'Pass the phone' }).click();
  await k.page.locator('.intro').waitFor();
  await settle(k.page);
  await k.page.locator('.field__input').fill('Cy');
  await k.page.getByRole('button', { name: /^Start/ }).click();
  await playRound(k.page, ['right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']);
  await k.page.locator('.versus').waitFor();
  await settle(k.page);
  await press(k.page, 'back');
  now = await where(k.page);
  check('the back button on a head-to-head goes home in one press', now.stage === 'home' && ['', '#/'].includes(now.hash), JSON.stringify(now));
  // Home, the pack and the round: two rounds and a handoff added nothing else.
  check('all of that left two entries above home', now.entries === atStart + 2, `${now.entries} entries, ${atStart} at the start`);
  await settle(k.page);
  await k.page.goBack();
  check('back on home leaves the app: nothing that was closed comes back', k.page.url() === 'about:blank', k.page.url());
  await k.ctx.close();

  section('13. Short and narrow phones');
  // The search hint is a whole question, and has to fit the narrowest phone.
  for (const width of [320, 344, 360]) {
    const n = await phone(browser, `narrow-${width}`, { width, height: 640 });
    await n.page.goto(BASE);
    await n.page.locator('.packs').waitFor();
    await n.page.evaluate(() => document.fonts.ready.then(() => undefined));
    const hint = await n.page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#q')!;
      const box = getComputedStyle(input);
      const shown = getComputedStyle(input, '::placeholder');
      const probe = document.createElement('span');
      probe.textContent = input.placeholder;
      Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', fontFamily: shown.fontFamily, fontWeight: shown.fontWeight, fontSize: shown.fontSize, letterSpacing: shown.letterSpacing });
      document.body.appendChild(probe);
      const text = probe.getBoundingClientRect().width;
      probe.remove();
      return { says: input.placeholder, text: Math.ceil(text), room: Math.floor(input.getBoundingClientRect().width - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight)), typed: box.fontSize };
    });
    check(`${width} wide: the search hint is the whole question`, hint.says === 'What do they claim to be good at?', hint.says);
    check(`${width} wide: and it fits the box`, hint.text <= hint.room, `${hint.text}px of text, ${hint.room}px of room`);
    // Anything under 16px in the field itself makes iOS zoom the page on focus.
    // Under 16px, iOS zooms the page when the box takes focus.
    check(`${width} wide: what is typed stays at least 16px`, parseFloat(hint.typed) >= 16, hint.typed);
    await n.ctx.close();
  }

  // A browser with its bars showing is much shorter than the phone. The
  // explanation used to land behind the Next dock, or below the fold.
  for (const [width, height] of [
    [390, 664],
    [375, 548],
  ] as const) {
    const m = await phone(browser, `short-${height}`, { width, height });
    await m.page.goto(`${BASE}#/p/software-engineering`);
    await m.page.locator('.intro').waitFor();
    await m.page.waitForTimeout(300);
    await m.page.getByRole('button', { name: /^Start/ }).click();
    const hidden: string[] = [];
    const drifted: string[] = [];
    for (let i = 0; i < 5; i++) {
      await settle(m.page);
      const top = (await where(m.page)).scrollY;
      if (top !== 0) drifted.push(`question ${i + 1} started ${top}px down`);
      if (i === 4) break;
      await answer(m.page, 'right');
      // Every other question, move on at once: the scroll that shows the
      // explanation is still under way, and must not carry on into the next.
      if (i % 2 === 0) {
        await m.page.waitForTimeout(650);
        const seen = await m.page.evaluate(() => {
          const text = document.querySelector('.why__text')!.getBoundingClientRect();
          const dock = document.querySelector('.dock--play')!.getBoundingClientRect();
          return { top: Math.round(text.top), bottom: Math.round(text.bottom), dock: Math.round(dock.top) };
        });
        if (seen.top < 0 || seen.bottom > seen.dock) hidden.push(`question ${i + 1}: text from ${seen.top} to ${seen.bottom}, dock at ${seen.dock}`);
      }
      // At the button's left end: on a screen this short Next can come up right where the answer
      // was tapped, and a second tap on the same spot this soon is rightly dropped as a double tap.
      await m.page.locator('.dock--play .btn--primary').click({ position: { x: 24, y: 28 } });
    }
    check(`${width}x${height}: the explanation is in view once the question is answered`, hidden.length === 0, hidden.join('; '));
    check(`${width}x${height}: every question starts at the top of the page`, drifted.length === 0, drifted.join('; '));
    await m.ctx.close();
  }

  // On a short phone the answers fill the screen, so most scrolls start with
  // a finger on one. A scroll must not look like a press: a pressed answer
  // looks like a pick that cannot be taken back. The screen here is short
  // enough that every question, even the briefest, runs past it: a question
  // that fits leaves the page nothing to scroll.
  const t = await phone(browser, 'touch', { width: 375, height: 440 });
  await t.page.goto(`${BASE}#/p/plumbing`);
  await t.page.locator('.intro').waitFor();
  await t.page.waitForTimeout(300);
  await t.page.getByRole('button', { name: /^Start/ }).click();
  await t.page.locator('.ask').waitFor();
  await settle(t.page, 450);
  // Count every time anything is given the pressed look.
  await t.page.evaluate(() => {
    const w = window as unknown as { __pressed: number };
    w.__pressed = 0;
    new MutationObserver((changes) => {
      for (const c of changes) if ((c.target as Element).classList.contains('is-down') && !(c.oldValue ?? '').includes('is-down')) w.__pressed++;
    }).observe(document.body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
  });
  const pressed = () => t.page.evaluate(() => (window as unknown as { __pressed: number }).__pressed);
  const finger = await t.ctx.newCDPSession(t.page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    finger.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const answerB = (await t.page.locator('.answer').nth(1).boundingBox())!;
  const bx = answerB.x + answerB.width / 2;
  const by = answerB.y + answerB.height / 2;
  // A finger lands on answer B and drags the page up.
  await touch('touchStart', bx, by);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', bx, by - i * 10);
    await t.page.waitForTimeout(8);
  }
  await touch('touchEnd');
  await settle(t.page, 300);
  now = await where(t.page);
  check('a scroll that starts on an answer scrolls the page', now.scrollY > 20 && now.answered === 0, JSON.stringify(now));
  check('and the answer never takes the pressed look', (await pressed()) === 0, `${await pressed()} press(es)`);
  // A finger that rests on it is a press, and shows as one before it lifts.
  await t.page.evaluate(() => window.scrollTo(0, 0));
  await settle(t.page, 150);
  await touch('touchStart', bx, by);
  await t.page.waitForTimeout(260);
  check('a finger resting on an answer presses it', (await t.page.locator('.answer.is-down').count()) === 1 && (await pressed()) === 1, `${await pressed()} press(es)`);
  await touch('touchEnd');
  await t.page.locator('.why').waitFor({ timeout: 2000 }).catch(() => {});
  check('and lifting it answers', (await where(t.page)).answered === 4);
  // A tap too quick to have shown its press shows it on the way up, even
  // while the page is still gliding to the explanation.
  const nextBox = (await t.page.locator('.dock--play .btn--primary').boundingBox())!;
  await touch('touchStart', nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2);
  await t.page.waitForTimeout(30);
  await touch('touchEnd');
  await settle(t.page);
  check('a quick tap still gets its press, and still counts', (await pressed()) === 2 && (await where(t.page)).count === '2/8', `${await pressed()} press(es), ${(await where(t.page)).count}`);
  // A mouse cannot be starting a scroll: its press shows at once.
  const firstBox = (await t.page.locator('.answer').first().boundingBox())!;
  await t.page.mouse.move(firstBox.x + 30, firstBox.y + 20);
  await t.page.mouse.down();
  check('a mouse press shows at once', (await t.page.locator('.answer.is-down').count()) === 1);
  await t.page.mouse.up();
  await t.ctx.close();
} finally {
  await browser.close();
  server.kill();
}

section('Console, page errors, failed requests');
const unique = [...new Set(noise)];
check('nothing was logged as an error or warning', unique.length === 0, `${unique.length} message(s)`);
for (const line of unique.slice(0, 12)) console.log(`  ${line}`);

console.log(`\n${checks - failures.length}/${checks} checks passed. Screenshots in .e2e/`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
