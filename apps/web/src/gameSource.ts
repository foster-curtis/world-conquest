// What the game screen needs from a game: implemented by the pass-and-play controller (sync, local RNG)
// and by the online game (async, server views). The board/HUD only ever consume a PlayerView.
import type { Color, Command, GameEvent, MapDefinition, PlayerView, Result, SeatId } from '@wc/engine';

export interface GameSource {
  readonly id: string;
  readonly map: MapDefinition;
  readonly players: { seat: SeatId; name: string; color: Color }[];
  readonly phaseKind: string;
  getView(): PlayerView;
  /** Events as the viewer may see them (feed). */
  visibleEvents(): GameEvent[];
  actingSeat(): SeatId | null;
  needsPass(): boolean;
  confirmPass(): void;
  /** Events to animate, as they arrive. */
  subscribe(fn: (events: GameEvent[]) => void): () => void;
  /** The view changed without events (snap, catch-up). Optional: local games only change inside dispatch. */
  onChange?(fn: () => void): () => void;
  dispatch(cmd: Command): Result<unknown> | Promise<Result<unknown>>;
}
