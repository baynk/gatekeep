import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ACTIVE_CATEGORIES, PACKS, QUESTION_COUNT, searchPacks } from '../lib/catalog.ts';
import { loadBest } from '../lib/storage.ts';
import { CATEGORIES } from '../lib/types.ts';
import type { CategoryId } from '../lib/types.ts';
import { Close, Search } from '../ui/Icons.tsx';
import { Quoted } from '../ui/Quoted.tsx';

/**
 * Home unmounts whenever a pack opens. This is what it comes back to, for the
 * life of the page: the search, the filter and how far down the list was.
 */
const kept: { query: string; category: CategoryId | 'all'; scrollY: number } = { query: '', category: 'all', scrollY: 0 };

export function Home({ onOpen }: { onOpen(id: string): void }) {
  const [query, setQuery] = useState(kept.query);
  const [category, setCategory] = useState<CategoryId | 'all'>(kept.category);
  const results = useMemo(() => searchPacks(query, { category }), [query, category]);
  const filtered = query.trim() !== '' || category !== 'all';
  const input = useRef<HTMLInputElement>(null);
  const count = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    kept.query = query;
    kept.category = category;
  }, [query, category]);

  // Every way of arriving scrolls to the top first. Put the list back where it was left.
  useLayoutEffect(() => {
    if (kept.scrollY > 0) window.scrollTo(0, kept.scrollY);
  }, []);

  // Both of these remove the button that was just pressed, so each says where
  // focus goes instead of dropping it on the page.
  const clear = () => {
    setQuery('');
    input.current?.focus();
  };
  const reset = () => {
    setQuery('');
    setCategory('all');
    // The line above the list, one Tab from the first pack. Not the search
    // box: on a phone that would raise the keyboard over the list just asked for.
    count.current?.focus({ preventScroll: true });
  };

  return (
    <div className="home">
      <header className="home__head">
        <h1 className="wordmark" tabIndex={-1}>
          gatekeep
        </h1>
        <p className="tagline">
          They say they’re good at it. Find out.
        </p>
      </header>

      <div className="search">
        <label htmlFor="q" className="sr-only">
          Search skills, jobs and hobbies
        </label>
        <Search className="search__icon" />
        <input
          id="q"
          className="search__input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="What do they claim to be good at?"
          value={query}
          ref={input}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query !== '' && (
          <button type="button" className="search__clear" aria-label="Clear search" onClick={clear}>
            <Close />
          </button>
        )}
      </div>

      <div className="chips" role="group" aria-label="Category">
        <button type="button" className="chip" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
          All
        </button>
        {ACTIVE_CATEGORIES.map((id) => (
          <button
            key={id}
            type="button"
            className="chip"
            aria-pressed={category === id}
            onClick={() => setCategory(category === id ? 'all' : id)}
          >
            {CATEGORIES[id].label}
          </button>
        ))}
      </div>

      <p className="count" aria-live="polite" tabIndex={-1} ref={count}>
        {filtered
          ? `${results.length} of ${PACKS.length} packs`
          : `${PACKS.length} packs. ${QUESTION_COUNT} questions.`}
      </p>

      {results.length > 0 ? (
        <ul className="packs">
          {results.map((pack) => {
            const best = loadBest(pack.id);
            return (
              <li key={pack.id}>
                <button
                  type="button"
                  className="pack key"
                  onClick={() => {
                    // Read here, not on unmount: by then the page is already back at the top.
                    kept.scrollY = window.scrollY;
                    onOpen(pack.id);
                  }}
                >
                  {/* The brag is the big type. The skill is its small label. */}
                  <span className="pack__head">
                    <span className="pack__title">{pack.title}</span>
                    {best && (
                      <span className="pack__best" aria-label={`Your best: ${best.score}${best.flagged ? ', with an asterisk' : ''}`}>
                        {best.score}
                        {best.flagged ? '*' : ''}
                      </span>
                    )}
                  </span>
                  <span className="pack__claim">
                    <Quoted text={pack.claim} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty">
          <p>No pack for that yet. Try a trade, a kitchen, a game.</p>
          <button type="button" className="btn btn--quiet key" onClick={reset}>
            Show everything
          </button>
        </div>
      )}
    </div>
  );
}
