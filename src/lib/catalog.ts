import { validatePack } from './define.ts';
import { buildIndex, searchIndex } from './search.ts';
import type { SearchOptions } from './search.ts';
import { CATEGORIES } from './types.ts';
import type { CategoryId, Pack } from './types.ts';

/**
 * The catalog is every file in src/packs. Adding a pack is adding a file:
 * nothing to register here.
 */
const modules = import.meta.glob<{ default: Pack }>('../packs/*.ts', { eager: true });

const categoryOrder = Object.keys(CATEGORIES) as CategoryId[];

export const PACKS: Pack[] = Object.values(modules)
  .map((m) => m.default)
  .filter((p): p is Pack => Boolean(p && p.id))
  .sort(
    (a, b) =>
      categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || a.title.localeCompare(b.title),
  );

const byId = new Map(PACKS.map((p) => [p.id, p]));

export function getPack(id: string): Pack | undefined {
  return byId.get(id);
}

export const QUESTION_COUNT = PACKS.reduce((n, p) => n + p.questions.length, 0);

/** Categories that actually have packs, in display order. */
export const ACTIVE_CATEGORIES: CategoryId[] = categoryOrder.filter((c) => PACKS.some((p) => p.category === c));

const index = buildIndex(PACKS);

export function searchPacks(query: string, opts: SearchOptions = {}): Pack[] {
  return searchIndex(index, query, opts);
}

// A broken pack should be loud while developing and impossible to miss in CI
// (the test suite runs the same check). It never throws in production.
if (import.meta.env.DEV) {
  for (const [path, mod] of Object.entries(modules)) {
    const file = path.split('/').pop()!.replace(/\.ts$/, '');
    const problems = mod.default ? validatePack(mod.default, file) : ['no default export'];
    if (problems.length) console.warn(`[gatekeep] pack "${file}" has problems:\n- ${problems.join('\n- ')}`);
  }
}
