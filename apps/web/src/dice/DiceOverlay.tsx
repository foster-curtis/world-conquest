// Dice overlay (SPEC 7.5): dice tumble, pair up highest-to-highest, losers dimmed.
import { useEffect, useState } from 'react';
import { type AnimStep, pairDice, TUMBLE_MS } from './animation.ts';

const FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function Die({ n, kind, dim, rolling }: { n: number; kind: 'att' | 'def'; dim?: boolean; rolling: boolean }) {
  const [face, setFace] = useState(n);
  useEffect(() => {
    if (!rolling) {
      setFace(n);
      return;
    }
    const t = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 70);
    return () => clearInterval(t);
  }, [rolling, n]);
  return (
    <span className={`die ${kind}${dim ? ' dim' : ''}${rolling ? ' rolling' : ''}`} role="img" aria-label={`${n}`}>
      {FACES[face]}
    </span>
  );
}

export function DiceOverlay(props: {
  step: Extract<AnimStep, { kind: 'dice' | 'blitz' }>;
  fromName: string;
  toName: string;
  speed: 'normal' | 'fast';
  /** Tumble the dice (false when animation is off or reduce-motion is on: the result shows at once). */
  animate: boolean;
  /** The board is locked while the animation plays; after that the panel stays until closed. */
  playing: boolean;
  onSkip: () => void;
  onClose: () => void;
}) {
  const { step, speed } = props;
  const [rolling, setRolling] = useState(props.animate);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tumble starts once per result
  useEffect(() => {
    if (!props.animate) {
      setRolling(false);
      return;
    }
    setRolling(true);
    const ms = step.kind === 'dice' ? TUMBLE_MS[speed] : Math.max(200, step.durationMs - 600);
    const t = setTimeout(() => setRolling(false), ms);
    return () => clearTimeout(t);
  }, [step]);

  const rolls = step.kind === 'dice' ? step : step.last;
  const pairs = pairDice(rolls.attackerRolls, rolls.defenderRolls);
  const attDice = pairs.map((p, rank) => ({ id: `a${rank}`, n: p.attacker, lost: p.defenderWins }));
  const defDice = [...rolls.defenderRolls]
    .sort((x, y) => y - x)
    .map((n, rank) => ({ id: `d${rank}`, n, lost: pairs[rank]?.attackerWins === true }));
  return (
    <div className={`dice-overlay${props.playing ? '' : ' settled'}`} aria-live="polite">
      {props.playing && (
        <button type="button" className="backdrop" aria-label="Skip animation" onClick={props.onSkip} />
      )}
      <div className="dice-card">
        <div className="dice-title">
          {props.fromName} <span aria-hidden="true">→</span> {props.toName}
          {step.kind === 'blitz' && <span className="sub"> · blitz, {step.rounds} rounds</span>}
        </div>
        <div className="dice-rows">
          <div className="dice-row">
            {attDice.map((d) => (
              <Die key={d.id} n={d.n} kind="att" dim={!rolling && d.lost} rolling={rolling} />
            ))}
          </div>
          <div className="dice-row">
            {defDice.map((d) => (
              <Die key={d.id} n={d.n} kind="def" dim={!rolling && d.lost} rolling={rolling} />
            ))}
          </div>
        </div>
        {!rolling && (
          <div className="dice-result">
            {step.kind === 'blitz' ? 'Total: ' : ''}
            attacker −{step.attackerLosses} · defender −{step.defenderLosses}
          </div>
        )}
        {!props.playing && (
          <button type="button" className="ghost" onClick={props.onClose}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}
