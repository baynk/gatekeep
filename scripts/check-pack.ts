/**
 * Validate question packs without a build step.
 *
 *   node scripts/check-pack.ts                      # every pack
 *   node scripts/check-pack.ts src/packs/poker.ts   # just these
 */
import { readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validatePack } from '../src/lib/define.ts';
import type { Pack } from '../src/lib/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packDir = join(root, 'src', 'packs');

const given = process.argv.slice(2);
const files = given.length
  ? given.map((f) => resolve(process.cwd(), f))
  : readdirSync(packDir)
      .filter((f) => f.endsWith('.ts'))
      .sort()
      .map((f) => join(packDir, f));

let failed = 0;
const seen = new Map<string, string>();

for (const file of files) {
  const name = basename(file, '.ts');
  let pack: Pack;
  try {
    const mod = (await import(pathToFileURL(file).href)) as { default?: Pack };
    if (!mod.default) throw new Error('no default export (use `export default definePack({...})`)');
    pack = mod.default;
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n  - could not load: ${(err as Error).message}`);
    continue;
  }
  const problems = validatePack(pack, name);
  const clash = seen.get(pack.id);
  if (clash) problems.push(`id "${pack.id}" is also used by ${clash}`);
  seen.set(pack.id, name);

  if (problems.length) {
    failed++;
    console.log(`FAIL ${name}`);
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    console.log(`OK   ${name} (${pack.questions.length} questions)`);
  }
}

console.log(`\n${files.length - failed}/${files.length} packs OK`);
process.exit(failed ? 1 : 0);
