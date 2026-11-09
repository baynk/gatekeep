import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Finished } from '../app/game.ts';
import { MAX_NAME } from '../lib/share.ts';
import { loadName } from '../lib/storage.ts';
import { TIER_LABEL } from '../lib/types.ts';
import type { Pack } from '../lib/types.ts';
import { ArrowLeft } from '../ui/Icons.tsx';
import { Quoted } from '../ui/Quoted.tsx';

interface IntroProps {
  pack: Pack;
  /**
   * solo      = a fresh round
   * challenge = someone sent a link; they went first
   * handoff   = the phone was passed; the first player just finished
   */
  mode: 'solo' | 'challenge' | 'handoff';
  /** Whoever went first, for challenge and handoff. */
  rival?: Finished;
  /** The pack changed after the challenge link was made. */
  stale?: boolean;
  onStart(name: string): void;
  onBack(): void;
}

function RoundSteps() {
  return (
    <ol className="rounds" aria-label="3 rounds. Each harder.">
      {([1, 2, 3] as const).map((tier) => (
        // Each harder: each heavier.
        <li key={tier} className={`rounds__step rounds__step--${tier}`}>
          {TIER_LABEL[tier]}
        </li>
      ))}
    </ol>
  );
}

export function Intro({ pack, mode, rival, stale, onStart, onBack }: IntroProps) {
  // The phone has just changed hands: never prefill the last player's name.
  const [name, setName] = useState(() => (mode === 'handoff' ? '' : loadName()));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onStart(name);
  };

  const rivalName = rival?.attempt.name ?? '';
  const label = mode === 'solo' ? 'Who’s being tested?' : mode === 'handoff' ? 'Who’s up?' : 'Who’s taking the challenge?';

  return (
    <form className="intro" onSubmit={submit}>
      <div className="bar">
        <button type="button" className="icon-btn key" aria-label={mode === 'handoff' ? 'Back to the result' : 'Back to all packs'} onClick={onBack}>
          <ArrowLeft />
        </button>
      </div>

      <div className="intro__body">
        {mode === 'solo' && (
          <>
            <p className="eyebrow">{pack.title}</p>
            <h1 className="claim" tabIndex={-1}>
              <Quoted text={pack.claim} />
            </h1>
          </>
        )}
        {mode === 'challenge' && rival && (
          <>
            <p className="eyebrow">{pack.title}</p>
            <h1 className="claim" tabIndex={-1}>
              {rivalName} scored {rival.score}
              {rival.flagged ? '*' : ''}. Your turn.
            </h1>
            <p className="intro__note">
              {stale
                ? `This pack was updated after ${rivalName} played, so some questions will differ. The scores still compare.`
                : 'Same eight questions. Same order.'}
            </p>
          </>
        )}
        {mode === 'handoff' && rival && (
          <>
            <p className="eyebrow">{pack.title}</p>
            <h1 className="claim" tabIndex={-1}>Hand it over.</h1>
            <p className="intro__note">
              Same eight questions {rivalName} just took. Same order. Their answers stay hidden.
            </p>
          </>
        )}

        <div className="intro__rules">
          <p className="intro__rounds">3 rounds. Each harder.</p>
          <RoundSteps />
          <p className="intro__fine">8 questions. No googling. We’ll know.</p>
        </div>
      </div>

      <div className="dock">
        <label className="field">
          <span className="field__label">{label}</span>
          <input
            className="field__input"
            type="text"
            name="player"
            value={name}
            maxLength={MAX_NAME}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="go"
            placeholder={mode === 'solo' ? 'Their name' : 'Your name'}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn--primary key">
          {mode === 'challenge' ? 'Take the challenge' : 'Start'}
        </button>
        {mode === 'solo' && <p className="dock__note">Same eight questions for whoever goes next.</p>}
      </div>
    </form>
  );
}
