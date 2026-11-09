import { challengeFor, formatTime } from '../app/game.ts';
import type { Finished } from '../app/game.ts';
import { useCountUp } from '../app/hooks.ts';
import { flagLines, flagSummary } from '../lib/integrity.ts';
import { ROUND_LENGTH, highlights } from '../lib/round.ts';
import type { Round } from '../lib/round.ts';
import { challengeUrl, resultShareText } from '../lib/share.ts';
import { KIND_LABEL, TIER_LABEL } from '../lib/types.ts';
import type { Kind, Pack, Tier } from '../lib/types.ts';
import { Close, Ring } from '../ui/Icons.tsx';
import { Quoted } from '../ui/Quoted.tsx';
import { TileRow } from '../ui/Tiles.tsx';

interface ResultProps {
  pack: Pack;
  round: Round;
  me: Finished;
  onPass(): void;
  onRematch(): void;
  onHome(): void;
  /** Share text (already ending in the link); the app decides share sheet or clipboard. */
  onShare(text: string, copiedMessage: string): void;
}

/** A short aside for the breakdown, only when there is something worth saying. */
function kindNote(kind: Kind, got: number, of: number, baited: number): string {
  if (baited > 0) return baited === 1 ? 'took the bait once' : `took the bait ${baited} times`;
  if (kind === 'trap' && got === of) return of === 1 ? 'dodged it' : of === 2 ? 'dodged both' : 'dodged them all';
  return '';
}

export function Result({ pack, round, me, onPass, onRematch, onHome, onShare }: ResultProps) {
  const score = useCountUp(me.score, 900, 150);
  const card = me.card;
  const name = me.attempt.name;
  const star = me.flagged ? '*' : '';
  const flags = flagLines(me.attempt.integrity);

  const link = () => challengeUrl(challengeFor(pack, round.seed, me));
  const shareLine = {
    name,
    verdict: me.verdict.title,
    score: me.score,
    outcomes: me.attempt.outcomes,
    integrity: me.attempt.integrity,
  };

  const challenge = () =>
    onShare(
      `${name} just took gatekeep’s ${pack.title} round: ${me.verdict.title}${star}, ${me.score}/100.\nSame 8 questions. Beat that:\n${link()}`,
      'Challenge link copied. Send it to them.',
    );
  const shareResult = () => onShare(resultShareText(pack.title, shareLine, link()), 'Result copied. Paste it in the chat.');

  return (
    <div className={`result result--${me.verdict.band}`}>
      {/* The first screenful: the claim, who said it, the ruling, the evidence, and one button.
          It stops a little short of the screen so the key to the marks shows under it. */}
      <div className="fold">
        <div className="bar">
          <span className="wordmark wordmark--small">gatekeep</span>
          <button type="button" className="icon-btn key" aria-label="Back to all packs" onClick={onHome}>
            <Close />
          </button>
        </div>

        {/* The card: everything a stranger needs from a screenshot. */}
        <section className="card" aria-label={`${name}: ${me.verdict.title}, ${me.score} out of 100`}>
          <p className="eyebrow">{pack.title}</p>
          <p className="claim claim--said">
            <Quoted text={pack.claim} />
          </p>
          <p className="card__by">
            <span aria-hidden="true">— </span>
            {name}
          </p>

          {/* The ruling. The highlighter marks it, and nothing else on the page. */}
          <h1 className="verdict" tabIndex={-1}>
            <span className="hl">
              {me.verdict.title}
              {star && <span className="verdict__star">*</span>}
            </span>
          </h1>
          <p className="verdict__line">{me.verdict.line}</p>

          <div className="evidence">
            <p className="score" aria-hidden="true">
              <span className="score__num">{score}</span>
              <span className="score__of">/100</span>
            </p>
            <TileRow outcomes={me.attempt.outcomes} animate startMs={430} className="tiles--card" />
            {me.flagged ? (
              <p className="card__flag">*{flagSummary(me.attempt.integrity)}</p>
            ) : (
              <p className="card__time">
                {ROUND_LENGTH} questions in {formatTime(me.attempt.seconds)}
              </p>
            )}
          </div>
        </section>

        <div className="actions">
          <button type="button" className="btn btn--primary key" onClick={challenge}>
            Challenge a friend
          </button>
        </div>
      </div>

      {/* What the pen's three marks mean. For the eye: each mark already says it to a screen reader. */}
      <ul className="legend" aria-hidden="true">
        <li>
          <span className="tile tile--hit">1</span>Correct
        </li>
        <li>
          <span className="tile tile--trap">
            4<Ring />
          </span>
          Rookie trap
        </li>
        <li>
          <span className="tile tile--miss">7</span>Wrong
        </li>
      </ul>

      {card && (
        <section className="detail" aria-labelledby="how">
          <h2 id="how" className="detail__title">
            How it went
          </h2>
          {highlights(card).map((line) => (
            <p key={line} className="detail__line">
              {line}
            </p>
          ))}
          <dl className="tally">
            {([1, 2, 3] as Tier[]).map((tier) => (
              <div key={tier}>
                <dt>{TIER_LABEL[tier]}</dt>
                <dd>
                  {card.byTier[tier].got}/{card.byTier[tier].of}
                </dd>
              </div>
            ))}
          </dl>
          <dl className="breakdown">
            {card.byKind.map((k) => (
              <div key={k.kind} className="breakdown__row">
                <dt>
                  {KIND_LABEL[k.kind]}
                  {/* A real space: the note's margin is not one to a screen reader or the clipboard. */}{' '}
                  {kindNote(k.kind, k.got, k.of, k.baited) && <span className="breakdown__note">{kindNote(k.kind, k.got, k.of, k.baited)}</span>}
                </dt>
                <dd>
                  {k.got}/{k.of}
                </dd>
              </div>
            ))}
          </dl>
          <p className="detail__time">
            {ROUND_LENGTH} questions in {formatTime(me.attempt.seconds)}
          </p>
        </section>
      )}

      {flags.length > 0 && (
        <section className="detail detail--noticed" aria-labelledby="noticed">
          <h2 id="noticed" className="detail__title">
            We noticed
          </h2>
          <ul className="noticed">
            {flags.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {me.flagged && <p className="detail__fine">*Result stands. The tape is noted.</p>}
        </section>
      )}

      <div className="actions actions--more">
        <div className="actions__row">
          <button type="button" className="btn btn--quiet key" onClick={onPass}>
            Pass the phone
          </button>
          <button type="button" className="btn btn--quiet key" onClick={shareResult}>
            Share result
          </button>
        </div>
      </div>

      {me.choices && (
        <details className="review">
          <summary>Every question, and what the pros say</summary>
          <ol className="review__list">
            {round.questions.map((q, i) => {
              const outcome = me.attempt.outcomes[i]!;
              const picked = q.options.find((o) => o.id === me.choices![i]);
              const right = q.options.find((o) => o.role === 'right')!;
              return (
                <li key={q.source} className={`review__item review__item--${outcome}`}>
                  <p className="review__ask">{q.ask}</p>
                  {/* The pen again: the right answer underlined, a wrong pick struck through. Each line also says what it is. */}
                  {outcome === 'hit' ? (
                    <p className="review__pick review__pick--hit">
                      <span className="sr-only">Your answer, correct: </span>
                      <span className="ink">{right.text}</span>
                    </p>
                  ) : (
                    <>
                      <p className={`review__pick review__pick--${outcome}`}>
                        {/* One box for the text and its tag, so the tag stays inline: the strike-through skips it and it never wraps on its own. */}
                        <span>
                          <span className="sr-only">Your answer, wrong: </span>
                          <span className="ink">{picked?.text ?? 'No answer'}</span>
                          {outcome === 'trap' && <span className="review__tag"> Rookie trap</span>}
                        </span>
                      </p>
                      <p className="review__pick review__pick--hit">
                        <span className="sr-only">Correct answer: </span>
                        <span className="ink">{right.text}</span>
                      </p>
                    </>
                  )}
                  <p className="review__why">{q.why}</p>
                </li>
              );
            })}
          </ol>
        </details>
      )}

      <div className="actions actions--end">
        <button type="button" className="btn btn--quiet key" onClick={onRematch}>
          Play again, new questions
        </button>
        <button type="button" className="btn btn--text" onClick={onHome}>
          Test someone else
        </button>
      </div>
    </div>
  );
}
