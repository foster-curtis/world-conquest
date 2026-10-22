// Countdown in the top bar, lazy ClaimTimeout at zero, and the sync-pace Skip button (SPEC 3, 7.6).
import type { PlayerView } from '@wc/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OnlineGame } from './OnlineGame.ts';
import { canSkip, claimable, formatRemaining, timerInfo } from './timer.ts';

const RETRY_MS = 3000;

export function OnlineTimer({ game, view }: { game: OnlineGame; view: PlayerView }) {
  const info = useMemo(() => timerInfo(view), [view]);
  const [now, setNow] = useState(() => Date.now());
  const lastClaim = useRef(0);

  useEffect(() => {
    if (info.endsAt === null && info.skipAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [info.endsAt, info.skipAt]);

  // First claim wins; a duplicate is rejected by the server. Retry if the clocks disagree and it was too early.
  useEffect(() => {
    if (!info.claim || game.offline || !claimable(info, now) || now - lastClaim.current < RETRY_MS) return;
    lastClaim.current = now;
    void game.dispatch({ type: 'ClaimTimeout', phase: info.claim.phase, deadlineAt: info.claim.deadlineAt });
  }, [info, now, game]);

  if (info.endsAt === null) return null;
  const remaining = info.endsAt - now;
  const skip = canSkip(view, info, now);
  return (
    <span className="timer" role="timer" aria-label={info.label}>
      {info.label}: <b className="num">{remaining > 0 ? formatRemaining(remaining) : '0:00'}</b>
      {skip && (
        <button
          type="button"
          className="skip"
          disabled={game.offline}
          title="The current player has been idle for 5 minutes"
          onClick={() => void game.dispatch({ type: 'SkipTurn' })}
        >
          Skip
        </button>
      )}
    </span>
  );
}
