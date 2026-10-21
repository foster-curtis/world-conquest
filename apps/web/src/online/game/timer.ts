// Timers (SPEC 3, 7.6): clients render countdowns from server timestamps and send ClaimTimeout when one hits
// zero; in sync pace, other players may Skip after 5 minutes of inactivity. Pure, so it can be unit-tested.
import { type Phase, type PlayerView, TIMERS } from '@wc/engine';

export interface TimerInfo {
  /** What the countdown is for. */
  label: string;
  /** Epoch ms the countdown ends, or null when nothing is counting down. */
  endsAt: number | null;
  /** When true the countdown is a deadline the server enforces (ClaimTimeout at zero). */
  enforced: boolean;
  /** The ClaimTimeout payload for the current deadline. */
  claim: { phase: Phase['kind']; deadlineAt: string } | null;
  /** Sync turns: when other players may Skip. */
  skipAt: number | null;
}

const none: TimerInfo = { label: '', endsAt: null, enforced: false, claim: null, skipAt: null };

export function timerInfo(view: PlayerView): TimerInfo {
  const p = view.phase;
  if (p.kind === 'draft') {
    return {
      label: 'Pick',
      endsAt: Date.parse(p.deadlineAt),
      enforced: true,
      claim: { phase: 'draft', deadlineAt: p.deadlineAt },
      skipAt: null,
    };
  }
  if (p.kind === 'setup') {
    return {
      label: 'Setup',
      endsAt: Date.parse(p.deadlineAt),
      enforced: true,
      claim: { phase: 'setup', deadlineAt: p.deadlineAt },
      skipAt: null,
    };
  }
  if (p.kind === 'turn') {
    if (p.deadlineAt) {
      return {
        label: 'Turn',
        endsAt: Date.parse(p.deadlineAt),
        enforced: true,
        claim: { phase: 'turn', deadlineAt: p.deadlineAt },
        skipAt: null,
      };
    }
    if (view.settings.pace === 'sync') {
      const skipAt = Date.parse(p.lastActionAt) + TIMERS.turnInactivityMs;
      return { label: 'Idle limit', endsAt: skipAt, enforced: false, claim: null, skipAt };
    }
  }
  return none;
}

/** True once the countdown is over by the server's grace period, i.e. ClaimTimeout will be accepted. */
export function claimable(info: TimerInfo, now: number): boolean {
  return info.enforced && info.endsAt !== null && now > info.endsAt + TIMERS.graceMs;
}

/** Sync turn, I'm not the current player, and the idle limit has passed. */
export function canSkip(view: PlayerView, info: TimerInfo, now: number): boolean {
  const p = view.phase;
  return (
    p.kind === 'turn' &&
    info.skipAt !== null &&
    view.viewer !== null &&
    view.viewer !== p.seat &&
    view.seats.find((s) => s.seat === view.viewer)?.status === 'active' &&
    now >= info.skipAt
  );
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
