import type { CSSProperties } from 'react';
import type { Outcome } from '../lib/round.ts';
import { Ring } from './Icons.tsx';

const WORD: Record<Outcome, string> = { hit: 'right', trap: 'rookie trap', miss: 'wrong' };

/**
 * One question's mark: its number, and what the pen did to it. Right is
 * underlined, wrong is struck through, a rookie trap is circled.
 */
export function Tile({ outcome, index, delay }: { outcome: Outcome; index: number; delay?: number }) {
  const style = delay === undefined ? undefined : ({ '--delay': `${delay}ms` } as CSSProperties);
  return (
    <span
      className={`tile tile--${outcome}${delay === undefined ? '' : ' tile--in'}`}
      role="img"
      aria-label={`Question ${index + 1}: ${WORD[outcome]}`}
      style={style}
    >
      <span aria-hidden="true">{index + 1}</span>
      {outcome === 'trap' && <Ring />}
    </span>
  );
}

interface TileRowProps {
  outcomes: readonly Outcome[];
  /** Mark one after another, starting after `startMs`. */
  animate?: boolean;
  startMs?: number;
  /** 0-based question indexes where two players differed. */
  ring?: readonly number[];
  className?: string;
}

/**
 * The eight marks. This row is the thing people share: it shows how the round
 * went without giving away a single answer.
 */
export function TileRow({ outcomes, animate, startMs = 0, ring, className }: TileRowProps) {
  return (
    <div className={`tiles${className ? ` ${className}` : ''}`}>
      {outcomes.map((outcome, i) => (
        <span key={i} className={`tiles__cell${ring?.includes(i) ? ' tiles__cell--ring' : ''}`}>
          <Tile outcome={outcome} index={i} delay={animate ? startMs + i * 60 : undefined} />
        </span>
      ))}
    </div>
  );
}
