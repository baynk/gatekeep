# gatekeep

They say they're good at it. Find out.

A mobile-first web app. Pick the skill, job or hobby someone claims, hand them
the phone, and eight questions later they are either vindicated or exposed.
The questions test lived experience, not trivia: most carry a rookie trap, an
answer that sounds right to an outsider and that no practitioner would pick.

There is no server. A round is rebuilt from a pack and a seed, so a friend who
opens a challenge link gets the same eight questions in the same order, and
both results travel in the link itself.

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

```bash
npm run build      # static site in dist/, works from any path
npm run check      # typecheck, unit tests, pack checker, end-to-end
npm run deploy     # build and publish to GitHub Pages (the gh-pages branch)
```

It is live at https://baynk.github.io/gatekeep/.

`npm run e2e` builds the app, serves the build on a free port and plays it at
phone size: whole rounds, leaving the app mid-question, passing the phone,
challenge and reply links in fresh browsers, every pack. It fails on any
console error, failed request or sideways scroll. Screenshots land in `.e2e/`.
It needs Playwright's Chromium once: `npx playwright install chromium`.

## How a round works

- **Three rounds, each harder.** Warm-up (2 questions), Shop talk (3), Deep end
  (3). They are worth 8, 12 and 16 points each, which adds up to 100.
- **Four kinds of question**: instincts, rookie traps (the wording baits you),
  napkin math (the obvious arithmetic is wrong) and scar tissue (you only know
  because it burned you once). The kind is hidden until you answer.
- **The app watches quietly.** Leaving the app mid-question, taking more than
  30 seconds on a math question, or copying text is never mentioned during
  play. It shows up on the result, with an asterisk on the verdict.
- **The result** is a card made to be screenshotted: who, what skill, the
  verdict, the score, and eight tiles (right, rookie trap, wrong) that show how
  it went without giving away an answer. Below it: the breakdown, what the app
  noticed, and every question with what the pros say.
- **Head to head.** Pass the phone for the same eight questions, or send a
  challenge link. A reply link carries both results, so anyone who opens it
  sees the comparison.

## Adding a pack

Drop one file in `src/packs/`. Nothing else to register: it appears in the
catalog and in search. [`src/packs/README.md`](src/packs/README.md) has the
format and, more importantly, the bar a question has to clear.

```bash
node scripts/check-pack.ts src/packs/my-skill.ts   # structure
node scripts/blind.ts my-skill                     # play-test it blind
node scripts/blind.ts my-skill --options-only      # can it be guessed from the options alone?
```

## Where things are

| Path | What |
| --- | --- |
| `src/packs/` | One file per pack: 12 questions, four per tier |
| `src/lib/round.ts` | Builds a round from (pack, seed); scoring; verdicts |
| `src/lib/integrity.ts` | The silent signals and how the result words them |
| `src/lib/share.ts` | Challenge links (a result in ~150 URL characters) and share text |
| `src/lib/search.ts` | Typo-tolerant catalog search |
| `src/app/useGatekeep.ts` | The flow: home, intro, play, result, handoff, head to head |
| `src/screens/` | One component per screen |
| `src/styles/app.css` | The look. Every color, radius and typeface is a token in `:root` |

Routes live in the URL hash so the static build works anywhere: `#/` home,
`#/p/<pack>` a pack's intro, `#/c/<code>` a challenge or a finished
head-to-head.
