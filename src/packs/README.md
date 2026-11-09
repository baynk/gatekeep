# Writing a pack

A pack is one file in this folder. Drop in `my-skill.ts`, export a pack with
`definePack`, and it shows up in the catalog and in search. Nothing else to
register.

```ts
import { definePack } from '../lib/define.ts';

export default definePack({
  id: 'my-skill',            // kebab-case, same as the file name
  title: 'My Skill',         // what the skill is called
  noun: 'practitioner',      // what you call someone who really does it
  category: 'trades',        // see CATEGORIES in ../lib/types.ts
  claim: 'I basically do this for a living',   // the brag, in the bluffer's words
  aliases: ['search', 'terms', 'slang', 'tools', 'adjacent', 'jobs'],
  questions: [ /* exactly 12: four per tier */ ],
});
```

Check it with `node scripts/check-pack.ts src/packs/my-skill.ts`. Play-test it
blind with `node scripts/blind.ts my-skill`. `bathroom-tile.ts` is the reference
pack: match its voice, length and difficulty curve.

## The bar

**A working practitioner answers in three seconds. A smart outsider reasons
carefully and picks the bait.** If a question does not do both, cut it.

This is not trivia. No history, no inventors, no "what does the acronym stand
for", no definitions for their own sake, no brand or product trivia, nothing
you would find on a flashcard. Every question is a situation: something is in
front of you, on the job, and you have to do or say the right thing.

Good sources of questions:

- what apprentices and first-timers get wrong, every time
- callbacks, refunds, injuries, outages: the thing that went wrong later
- words that mean something different inside the trade than in plain English
- numbers that outsiders compute the obvious way and get wrong
- what you check first, and what you never bother checking
- what the instructions say versus what everybody actually does, and why

## The four kinds

| kind       | what it tests                                                                 |
| ---------- | ----------------------------------------------------------------------------- |
| `instinct` | Tacit judgment. What you do without thinking, and could not learn from a video. |
| `trap`     | Plain-English bait. The wording points an outsider at a wrong answer ("mud bed" is not wet; "level" is not "flat"). |
| `math`     | Naive-math bait. The obvious arithmetic gives the wrong number (50 sq ft is not 5 boxes). The right answer needs a real-world factor the outsider does not know to include. |
| `scar`     | Something you only know because it burned you once.                           |

Each pack needs at least 3 `trap`, 2 `math`, 2 `instinct` and 2 `scar`. Every
`trap` and `math` question must set `bait` to the wrong answer the outsider
lands on, and at least 7 of the 12 questions should have one.

`math` questions are timed silently: someone who takes 40 seconds on a number a
practitioner knows cold gets called out on their result. So keep the arithmetic
doable in your head.

## The three tiers

1. **Warm-up.** Anyone who has really done it a handful of times gets these. A
   confident talker does not.
2. **Shop talk.** You do this regularly. You have opinions about the tools.
3. **Deep end.** Years in. The things you learn from the job that went bad, or
   from the old hand who stopped you just in time.

Tier 3 is harder because it needs more experience, never because it is more
obscure. "Which year was the standard revised" is obscure. "Why does this fail
in month three" is experience.

## Answers

- Four options: one `right`, three `wrong`. All four the same shape: similar
  length, same grammar, same level of detail. The checker rejects packs where
  the right answer is usually the longest.
- Wrong answers are things a real person would say. No jokes, no absurd
  options, no "all of the above".
- **One defensible answer.** If two pros would argue about it over a beer, cut
  it, or put the conditions in the question until they would not. Avoid anything
  that depends on a region, a brand, a code edition or a school of thought,
  unless the question names it.
- Where safety is involved, the right answer is always the safe practice.
- No giveaways: no hedged "it depends" option that is always right, no absolute
  words ("always", "never") only on the wrong ones, no option that repeats a
  word from the question when the others do not.

## Voice

- Second person, present tense, on the job: "You pull the tile back up and see..."
- Concrete: real sizes, real numbers, real units. Say which units.
- `ask` under 260 characters. Answers under 80, ideally under 50. `why` under 240.
- `why` teaches the principle in one or two dry sentences, the way an old hand
  would say it. It is the part people screenshot.
- Plain punctuation. No exclamation marks, no emoji, no em dashes.

## Facts

A wrong answer key is the worst failure this product can have: it tells a real
practitioner they are a bluffer. If you are not certain, look it up or cut it.
