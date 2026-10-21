// "Pass the device to ___" (SPEC 1): shown before every turn and before each player's setup turn.
// Deliberately renders no game information, so cards and hidden setup placements stay private.
import type { Color } from '@wc/engine';
import { COLOR_HEX, COLOR_INK } from '../board/colors.ts';

export function PassScreen(props: {
  name: string;
  color: Color;
  kind: 'setup' | 'turn';
  onReady: () => void;
  onHome: () => void;
}) {
  return (
    <div className="pass" style={{ ['--seat' as string]: COLOR_HEX[props.color] }}>
      <div className="pass-card">
        <div className="pass-badge" style={{ background: COLOR_HEX[props.color], color: COLOR_INK[props.color] }}>
          {props.name.trim()[0]?.toUpperCase() ?? '?'}
        </div>
        <h1>Pass the device to {props.name}</h1>
        <p>
          {props.kind === 'setup'
            ? 'Starting setup: place your armies in secret. Others will see them when everyone is done.'
            : 'It is your turn. Make sure nobody else is looking at your cards.'}
        </p>
        <button type="button" className="primary big" onClick={props.onReady}>
          I am {props.name}
        </button>
        <button type="button" className="ghost" onClick={props.onHome}>
          Save and go home
        </button>
      </div>
    </div>
  );
}
