/**
 * Print a pack the way a player sees it: answers shuffled, key hidden.
 * Use it to play-test a pack on someone (or something) that has not read the
 * source file.
 *
 *   node scripts/blind.ts poker                  # questions and options
 *   node scripts/blind.ts poker --key            # same order, with the key and bait
 *   node scripts/blind.ts poker --options-only   # options without the question
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashString, mulberry32, shuffled } from '../src/lib/rng.ts';
import type { Pack } from '../src/lib/types.ts';

const [id, ...flags] = process.argv.slice(2);
if (!id) {
  console.error('usage: node scripts/blind.ts <pack-id> [--key] [--options-only]');
  process.exit(2);
}
const showKey = flags.includes('--key');
// Hide the question itself: if the right answer can still be picked from the
// four options alone, the options are giving it away.
const optionsOnly = flags.includes('--options-only');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (await import(pathToFileURL(join(root, 'src', 'packs', `${id}.ts`)).href)) as { default: Pack };
const pack = mod.default;

console.log(`${pack.title} (${pack.questions.length} questions)\n`);
pack.questions.forEach((q, i) => {
  const rand = mulberry32(hashString(`${pack.id}:${i}`));
  const options = shuffled(
    [
      { text: q.right, role: 'right' },
      ...q.wrong.map((text, j) => ({ text, role: q.bait === j ? 'bait' : 'wrong' })),
    ],
    rand,
  );
  console.log(optionsOnly ? `Q${i + 1}` : `Q${i + 1} [tier ${q.tier}] ${q.ask}`);
  options.forEach((o, j) => console.log(`   ${'ABCD'[j]}) ${o.text}`));
  if (showKey) {
    const letter = (role: string) => {
      const at = options.findIndex((o) => o.role === role);
      return at < 0 ? '-' : 'ABCD'[at];
    };
    console.log(`   KEY ${letter('right')}  BAIT ${letter('bait')}  KIND ${q.kind}`);
    console.log(`   WHY ${q.why}`);
  }
  console.log('');
});
