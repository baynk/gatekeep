import { challengeFor, summarizeVersus } from '../app/game.ts';
import type { Finished } from '../app/game.ts';
import { useCountUp } from '../app/hooks.ts';
import { flagSummary } from '../lib/integrity.ts';
import { challengeUrl, versusShareText } from '../lib/share.ts';
import type { Pack } from '../lib/types.ts';
import { Close } from '../ui/Icons.tsx';
import { TileRow } from '../ui/Tiles.tsx';

interface VersusProps {
  pack: Pack;
  seed: number;
  a: Finished;
  b: Finished;
  mode: 'here' | 'reply' | 'spectate';
  stale?: boolean;
  onRematch(): void;
  onHome(): void;
  onShare(text: string, copiedMessage: string): void;
}

/** One player: who, the ruling on them, the score, their eight marks, and what the app noticed. */
function Side({ who, win, delay, ring }: { who: Finished; win: boolean; delay: number; ring?: readonly number[] }) {
  const score = useCountUp(who.score, 700, delay);
  return (
    <div className={`side${win ? ' side--win' : ''}`}>
      <p className="side__top">
        {/* Name and ruling share a line when they fit, and the ruling drops under a long name. */}
        <span className="side__who">
          <span className="side__name">{who.attempt.name}</span>
          <span className="side__verdict">
            {who.verdict.title}
            {who.flagged ? '*' : ''}
          </span>
        </span>
        <span className="side__score" aria-label={`${who.score} out of 100`}>
          {score}
        </span>
      </p>
      <TileRow outcomes={who.attempt.outcomes} animate startMs={delay + 260} ring={ring} />
      <p className={`side__flag${who.flagged ? ' side__flag--on' : ''}`}>{flagSummary(who.attempt.integrity)}</p>
    </div>
  );
}

export function Versus({ pack, seed, a, b, mode, stale, onRematch, onHome, onShare }: VersusProps) {
  const sum = summarizeVersus(a, b);
  const ring = sum.split.map((n) => n - 1);
  const line = (p: Finished) => ({
    name: p.attempt.name,
    verdict: p.verdict.title,
    score: p.score,
    outcomes: p.attempt.outcomes,
    integrity: p.attempt.integrity,
  });
  // A link that carries both results, so anyone who opens it sees this screen,
  // including whether the two rounds were the same eight questions.
  const url = () => challengeUrl(challengeFor(pack, seed, a, b, stale));
  const share = (copied: string) => onShare(versusShareText(pack.title, line(a), line(b), url()), copied);

  return (
    <div className="versus">
      <div className="bar">
        <span className="wordmark wordmark--small">gatekeep</span>
        <button type="button" className="icon-btn key" aria-label="Back to all packs" onClick={onHome}>
          <Close />
        </button>
      </div>

      <p className="eyebrow">
        <b>Head to head</b> {pack.title}
      </p>
      {/* The ruling between them, and so the one thing the highlighter marks. A long name in one word
          (twelve characters, or nine with no lower-case letter among them: capitals run wide) gets
          smaller type, so it stays whole on its line. */}
      <h1 className={`versus__headline${/\S{12,}|[^\p{Ll}\s]{9,}/u.test(sum.headline) ? ' versus__headline--long' : ''}`} tabIndex={-1}>
        <span className="hl">{sum.headline}</span>
      </h1>
      <p className="versus__note">
        {stale ? 'The pack changed between their rounds, so the questions were not identical.' : 'Same eight questions. Same order.'}
      </p>
      {!stale && <p className="versus__split">{sum.splitLine}</p>}

      <div className="sides matrix" role="group" aria-label="Player by player">
        <Side who={a} win={sum.winner === 'a'} delay={100} ring={stale ? undefined : ring} />
        <Side who={b} win={sum.winner === 'b'} delay={240} ring={stale ? undefined : ring} />
      </div>

      <div className="actions">
        {mode === 'reply' && (
          <>
            <button type="button" className="btn btn--primary key" onClick={() => share(`Copied. Send it back to ${a.attempt.name}.`)}>
              Send it back to {a.attempt.name}
            </button>
            <button type="button" className="btn btn--quiet key" onClick={onRematch}>
              Rematch, new questions
            </button>
          </>
        )}
        {mode === 'here' && (
          <>
            <button type="button" className="btn btn--primary key" onClick={onRematch}>
              Rematch, new questions
            </button>
            <button type="button" className="btn btn--quiet key" onClick={() => share('Copied. Paste it in the group chat.')}>
              Send to the group chat
            </button>
          </>
        )}
        {mode === 'spectate' && (
          <button type="button" className="btn btn--primary key" onClick={onRematch}>
            Take a round yourself
          </button>
        )}
        <button type="button" className="btn btn--text" onClick={onHome}>
          Test someone else
        </button>
      </div>
    </div>
  );
}
