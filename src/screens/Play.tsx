import { useEffect, useLayoutEffect, useRef } from 'react';
import { TAP_GUARD_MS, buzz, glideTo } from '../app/device.ts';
import type { Game } from '../app/game.ts';
import { outcomeOf } from '../lib/round.ts';
import { KIND_LABEL, TIER_LABEL } from '../lib/types.ts';
import { Close, Ring } from '../ui/Icons.tsx';

interface PlayProps {
  game: Game;
  /** True while "Walk away mid-round?" is up. The app owns it: system Back opens the sheet too. */
  confirmQuit: boolean;
  onAskQuit(open: boolean): void;
  onAnswer(choiceId: number): void;
  onNext(): void;
  onQuit(): void;
}

const LETTERS = ['A', 'B', 'C', 'D'];
// A browser from before <dialog> (Safari 15.3 and older) still gets the sheet,
// shown and hidden by its `open` attribute, without the modal manners.
function openSheet(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
    dialog.querySelector('button')?.focus();
  }
}

function closeSheet(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === 'function') {
    if (dialog.open) dialog.close();
  } else {
    dialog.removeAttribute('open');
  }
}

export function Play({ game, confirmQuit, onAskQuit, onAnswer, onNext, onQuit }: PlayProps) {
  const { round, index } = game;
  const question = round.questions[index]!;
  const total = round.questions.length;
  const revealed = game.phase === 'revealed';
  const picked = revealed ? game.choices[index]! : null;
  const outcome = picked === null ? null : outcomeOf(question, picked);
  const last = index === total - 1;

  const heading = useRef<HTMLHeadingElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const why = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  // Taps on answers are ignored until this time (see the sheet, below).
  const quietUntil = useRef(0);

  // The quit sheet is a modal dialog. showModal() is what makes it one: focus
  // moves in and cannot Tab out to the answers, the question behind is inert,
  // Escape closes it, and closing puts focus back where it was.
  useLayoutEffect(() => {
    const dialog = sheet.current;
    if (!confirmQuit || !dialog) return;
    openSheet(dialog);
    return () => {
      // "Keep going" sits over the answers. The second tap of a double tap on
      // it must not land on one: an answer cannot be taken back.
      quietUntil.current = performance.now() + TAP_GUARD_MS;
      closeSheet(dialog);
    };
  }, [confirmQuit]);

  // A new question: start reading from the top.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [index]);

  // Answered: the only thing left to do is continue.
  useEffect(() => {
    if (!revealed) return;
    buzz(outcome === 'hit' ? 12 : [18, 40, 18]);
    nextButton.current?.focus({ preventScroll: true });
  }, [revealed, outcome]);

  // The explanation lands below the answers, behind the dock or under the
  // fold: bring it into view. (The Next button is in the dock, always in view.)
  useLayoutEffect(() => {
    const box = why.current;
    if (!revealed || !box) return;
    // Ask the browser where the page has to be to show it (its scroll margin
    // clears the dock), put the page back, and glide there. The glide stops
    // if the question is left first.
    const from = window.scrollY;
    box.scrollIntoView({ block: 'nearest' });
    const to = window.scrollY;
    window.scrollTo(0, from);
    return glideTo(to);
  }, [revealed]);

  // A, B, C, D or 1-4 on a keyboard.
  useEffect(() => {
    if (revealed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || confirmQuit) return;
      const at = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(e.key.toLowerCase());
      const option = at >= 0 ? question.options[at] : undefined;
      if (option) onAnswer(option.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, confirmQuit, question, onAnswer]);

  const verdictWord = outcome === 'hit' ? 'Correct' : outcome === 'trap' ? 'Rookie trap' : 'Wrong';

  return (
    <div className={`play play--tier${question.tier}`}>
      <div className="bar">
        <button
          type="button"
          className="icon-btn key"
          aria-label="Quit this round"
          onClick={(e) => {
            // Not every browser focuses a button it clicks. Closing the sheet returns focus here.
            e.currentTarget.focus({ preventScroll: true });
            onAskQuit(true);
          }}
        >
          <Close />
        </button>
        <span className="bar__count">
          <span className="sr-only">Question </span>
          {index + 1} of {total}
        </span>
      </div>

      <p className="play__round">
        <span>{TIER_LABEL[question.tier]}</span>
        {/* The kind stays hidden until they answer: "Napkin math" up front would be a hint. */}
        {revealed && <span className="play__kind">{KIND_LABEL[question.kind]}</span>}
      </p>
      <h1 className="ask" tabIndex={-1} ref={heading}>
        {question.ask}
      </h1>

      <ol className="answers" aria-label="Answers">
        {question.options.map((option, i) => {
          const isPick = option.id === picked;
          const state = !revealed
            ? 'idle'
            : option.role === 'right'
              ? 'right'
              : isPick
                ? option.role === 'bait'
                  ? 'trap'
                  : 'wrong'
                : 'out';
          return (
            <li key={option.id}>
              <button
                type="button"
                className={`answer key answer--${state}${isPick ? ' is-pick' : ''}`}
                disabled={revealed}
                onClick={() => {
                  if (performance.now() >= quietUntil.current) onAnswer(option.id);
                }}
              >
                {/* The pen: a right answer is underlined, a wrong pick is struck through, a trap is circled. */}
                <span className="answer__mark" aria-hidden="true">
                  {LETTERS[i]}
                  {state === 'trap' && <Ring />}
                </span>
                <span className="answer__text">
                  <span className="ink">{option.text}</span>
                </span>
                {state === 'right' && <span className="answer__tag sr-only">Correct</span>}
                {state === 'trap' && <span className="answer__tag sr-only">Rookie trap</span>}
                {state === 'wrong' && <span className="answer__tag sr-only">Wrong</span>}
              </button>
            </li>
          );
        })}
      </ol>

      {/* One live region, there before the answer is: the verdict is announced once, and is in the page once. */}
      <div className="why-slot" role="status" aria-live="assertive">
        {revealed && (
          <div className={`why why--${outcome}`} ref={why}>
            <p className="why__head">
              <span className="hl">{verdictWord}</span>
            </p>
            <p className="why__text">{question.why}</p>
          </div>
        )}
      </div>

      <div className="dock dock--play">
        {revealed && (
          <button type="button" className="btn btn--primary key" ref={nextButton} onClick={onNext}>
            {last ? 'See the verdict' : 'Next'}
          </button>
        )}
      </div>

      {/* Always in the page, shown with showModal(). Escape and a phone's Back close it themselves:
          `cancel` says so at once. `close` comes a frame after any closing, by which time the
          sheet may be up again, so it only counts if the sheet is still shut. */}
      <dialog
        className="sheet"
        ref={sheet}
        aria-labelledby="quit-title"
        onCancel={() => onAskQuit(false)}
        onClose={(e) => {
          if (!e.currentTarget.open) onAskQuit(false);
        }}
      >
        <div className="sheet__card">
          <h2 id="quit-title" className="sheet__title">
            Walk away mid-round?
          </h2>
          <p className="sheet__text">Nothing is saved. Draw your own conclusions.</p>
          <button type="button" className="btn btn--primary key" onClick={() => onAskQuit(false)}>
            Keep going
          </button>
          <button type="button" className="btn btn--quiet key" onClick={onQuit}>
            Quit
          </button>
        </div>
      </dialog>
    </div>
  );
}
