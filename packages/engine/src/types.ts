// ============================================================================
// Risk-style game engine: shared contract (engine ⇄ server ⇄ UI)
// Pure types only. No runtime deps. Used by the edge function AND pass-and-play.
// ============================================================================

// ---------- Primitives -------------------------------------------------------

export type SeatId = number; // 0..5; host is the creator's seat
export type MapId = string; // e.g. "classic"; a published map is immutable
export type TerritoryId = string; // snake_case, unique within a map, permanent: e.g. "western_us"
export type ContinentId = string; // snake_case: e.g. "north_america"
export type CardId = string;
export type ISODate = string;

export type Color = 'crimson' | 'cobalt' | 'jade' | 'berry' | 'bone' | 'sky' | 'gray';

// ---------- Settings ---------------------------------------------------------

export type GameMode = 'local' | 'online';
export type WinCondition = 'classic' | 'capitals';
export type Pace = 'sync' | 'async'; // sync = 5-min inactivity skip
export type TerritoryAssignment = 'random' | 'draft'; // draft only when mode = 'online' && pace = 'sync'
export type PlayerCount = 2 | 3 | 4 | 5 | 6; // human players

export interface GameSettings {
  mode: GameMode;
  mapId: MapId; // v1: always 'classic'
  winCondition: WinCondition;
  pace: Pace; // ignored for local
  territoryAssignment: TerritoryAssignment; // local: always 'random'
  maxSeats: PlayerCount;
}

/** Timer lengths are derived from settings, never stored per game. */
export const TIMERS = {
  draftPickMs: 15_000,
  setupMs: { sync: 6 * 60_000, async: 24 * 60 * 60_000 },
  turnInactivityMs: 5 * 60_000, // sync: others may SkipTurn after this
  turnDeadlineMs: 24 * 60 * 60_000, // async: auto-play after this
  graceMs: 1_000, // server-side lag allowance
  maxConsecutiveStrikes: 3,
} as const;

// ---------- Static map definition (not part of state) ------------------------

/** Pure data, no geometry (art lives in the web app). Adjacency is hand-authored and
 *  must be symmetric; validated by engine tests. Never edit a published map: new id instead. */
export interface MapDefinition {
  id: MapId;
  name: string;
  territories: Record<
    TerritoryId,
    {
      name: string; // display only; may change freely
      continent: ContinentId;
      adjacent: TerritoryId[];
      cardSymbol: Exclude<CardSymbol, 'wild'>;
    }
  >;
  continents: Record<ContinentId, { name: string; bonus: number }>;
  /** Armies per seat at setup, keyed by human player count.
   *  In 2-player games the neutral seat gets the same amount. */
  startingArmies: Record<PlayerCount, number>;
}

// ---------- Cards ------------------------------------------------------------

export type CardSymbol = 'infantry' | 'cavalry' | 'artillery' | 'wild';

export interface Card {
  id: CardId;
  symbol: CardSymbol;
  territory: TerritoryId | null; // null for wilds
}

/** Escalating trade-in values: 4, 6, 8, 10, 12, 15, then +5 each. */
export function tradeValue(tradeIndex: number): number {
  const table = [4, 6, 8, 10, 12, 15];
  return tradeIndex < table.length ? table[tradeIndex] : 15 + 5 * (tradeIndex - 5);
}
export const TRADE_TERRITORY_BONUS = 2; // +2 on a matching owned territory
export const MUST_TRADE_AT = 5; // start of turn
export const ELIMINATION_TRADE_AT = 6; // mid-turn after taking a hand; trade down to ≤ 4

export const MIN_SEATS = 2; // 2 humans → neutral seat added at StartGame
// Fortify rule: one move per turn along a connected chain of territories you own.

// ---------- Seats ------------------------------------------------------------

export type SeatKind = 'human' | 'neutral';
export type SeatStatus = 'active' | 'kicked' | 'eliminated';

export interface Seat {
  seat: SeatId;
  kind: SeatKind;
  status: SeatStatus;
  userId: string | null; // null for local players and neutral
  displayName: string; // snapshot of the profile name at join
  color: Color; // chosen in lobby; 'gray' is reserved for the neutral seat
  turnOrder: number | null; // null until GameStarted; neutral never takes turns
  consecutiveStrikes: number;
  hand: CardId[]; // redacted in playerView for other seats
  capital: TerritoryId | null; // capitals mode only
}

export const NEUTRAL_COLOR: Color = 'gray';

/** Inert seats (neutral, kicked incl. resigned) never take turns; computer rolls their defense. */
export const isInert = (s: Seat) => s.kind === 'neutral' || s.status === 'kicked';

// ---------- Phases (state machine) -------------------------------------------

export type TurnStep = 'reinforce' | 'attack' | 'occupy' | 'fortify';

export type Phase =
  | { kind: 'lobby' }
  | { kind: 'draft'; pickingSeat: SeatId; deadlineAt: ISODate }
  | {
      kind: 'setup';
      deadlineAt: ISODate;
      armiesToPlace: Record<SeatId, number>;
      submitted: SeatId[]; // who is done (public)
    }
  | {
      kind: 'turn';
      seat: SeatId;
      step: TurnStep;
      reinforcementsRemaining: number;
      conqueredThisTurn: boolean; // earns a card at EndTurn
      pendingOccupy: { from: TerritoryId; to: TerritoryId; minArmies: number; maxArmies: number } | null;
      /** Set when eliminating a player pushes your hand to 6+. You must TradeCards
       *  (and place those armies) until hand ≤ 4 before attacking again. */
      forcedTrade: { armiesToPlace: number } | null;
      fortified: boolean;
      startedAt: ISODate;
      lastActionAt: ISODate; // sync inactivity check
      deadlineAt: ISODate | null; // async only
    }
  /** last_standing: only one human seat still 'active' (others kicked or eliminated); any mode/win condition. */
  | { kind: 'game_over'; winner: SeatId; reason: 'world_domination' | 'capitals' | 'last_standing' }
  /** Lobby only. Hidden from game lists. */
  | { kind: 'canceled'; reason: CancelReason };

export type CancelReason = 'host' | 'empty' | 'expired';

// ---------- Game state (server-authoritative, full) --------------------------

export interface TerritoryState {
  owner: SeatId;
  armies: number;
}

export interface GameState {
  gameId: string;
  version: number; // = last applied event seq
  settings: GameSettings;
  hostSeat: SeatId;
  seats: Seat[];
  phase: Phase;
  territories: Record<TerritoryId, TerritoryState>;
  deck: CardId[]; // draw order; NEVER sent to clients
  discard: CardId[];
  cards: Record<CardId, Card>;
  tradeCount: number; // drives escalating value
  hiddenSetup: Record<SeatId, { placements: Record<TerritoryId, number>; capital: TerritoryId | null }>;
}

/** What a given viewer is allowed to see. */
export interface PlayerView extends Omit<GameState, 'deck' | 'hiddenSetup' | 'seats'> {
  viewer: SeatId | null; // null = spectator
  deckSize: number;
  seats: (Omit<Seat, 'hand'> & { hand: CardId[] | null; handSize: number })[];
  mySetup: GameState['hiddenSetup'][SeatId] | null;
}

// ---------- Commands (client → server; intent, may be rejected) --------------

export type Command =
  // Lobby
  /** displayName is filled by the edge function from `profiles`, not trusted from the client.
   *  color omitted → first free; requested but taken → COLOR_TAKEN. */
  /** userId is likewise filled by the edge function from auth (null/omitted in pass-and-play). The actor is
   *  ignored, since a joiner has no seat yet. */
  | { type: 'JoinGame'; displayName: string; color?: Color; userId?: string | null }
  /** Lobby: leave the game (host leaving passes host on, or cancels if empty).
   *  After start: resign = immediate kick (SeatKicked reason 'resigned'). */
  | { type: 'LeaveGame' }
  | { type: 'ChangeColor'; color: Color } // lobby only; must be free and not NEUTRAL_COLOR
  | { type: 'CancelGame' } // lobby only; host (reason 'host') or system actor (reason 'expired')
  | { type: 'UpdateSettings'; settings: Partial<GameSettings> } // host only; INVALID_SETTINGS on unknown mapId, draft without online+sync, or maxSeats < joined players
  | { type: 'RemoveFromLobby'; seat: SeatId } // host only, lobby phase
  | { type: 'StartGame' } // host only, needs ≥ MIN_SEATS
  // Territory assignment
  | { type: 'DraftPick'; territory: TerritoryId }
  // Setup (simultaneous, hidden)
  | { type: 'SubmitSetup'; placements: Record<TerritoryId, number>; capital?: TerritoryId }
  // Turn
  | { type: 'TradeCards'; cardIds: [CardId, CardId, CardId] }
  | { type: 'PlaceReinforcements'; placements: Record<TerritoryId, number> }
  /** untilConquered = blitz: server keeps rolling (max dice each round) until the
   *  territory falls or `from` is down to 1 army. Emits one AttackRolled per round. */
  | { type: 'Attack'; from: TerritoryId; to: TerritoryId; attackerDice: 1 | 2 | 3; untilConquered?: boolean }
  | { type: 'Occupy'; armies: number }
  | { type: 'EndAttack' }
  | { type: 'Fortify'; from: TerritoryId; to: TerritoryId; armies: number }
  | { type: 'EndTurn' }
  // Timers
  | { type: 'SkipTurn' } // sync, non-current player
  | { type: 'ClaimTimeout'; phase: Phase['kind']; deadlineAt: ISODate }; // any client or cron

export type Actor = { kind: 'seat'; seat: SeatId } | { kind: 'system' }; // cron fallback

// ---------- Events (persisted facts, past tense) -----------------------------
// Append-only forever: add new event types or new OPTIONAL fields only. Never rename,
// remove, or change the meaning of existing ones; old games and replays must still fold.

export type GameEvent =
  // Lobby
  | { type: 'SeatJoined'; seat: SeatId; userId: string | null; displayName: string; color: Color }
  | { type: 'SeatLeft'; seat: SeatId; removedByHost: boolean }
  | { type: 'SeatColorChanged'; seat: SeatId; color: Color }
  | { type: 'HostChanged'; seat: SeatId } // host left; earliest-joined remaining seat
  | { type: 'GameCanceled'; reason: CancelReason }
  | { type: 'SettingsUpdated'; settings: GameSettings }
  /** draftDeadlineAt: the first pick's deadline when territoryAssignment = 'draft', else null. */
  | {
      type: 'GameStarted';
      turnOrder: SeatId[];
      neutralSeat: SeatId | null;
      deck: CardId[];
      draftDeadlineAt: ISODate | null;
    }
  // Territory assignment
  | { type: 'TerritoriesDealt'; assignments: Record<TerritoryId, SeatId> }
  | { type: 'DraftPicked'; seat: SeatId; territory: TerritoryId; auto: boolean; nextDeadlineAt: ISODate | null }
  // Setup
  | { type: 'SetupStarted'; armiesToPlace: Record<SeatId, number>; deadlineAt: ISODate }
  | {
      type: 'SetupSubmitted';
      seat: SeatId;
      placements: Record<TerritoryId, number>;
      capital: TerritoryId | null;
      auto: boolean;
    }
  | { type: 'NeutralPlaced'; seat: SeatId; placements: Record<TerritoryId, number> }
  | { type: 'SetupRevealed' }
  // Turn
  | {
      type: 'TurnStarted';
      seat: SeatId;
      reinforcements: { territories: number; continents: Record<ContinentId, number>; total: number };
      deadlineAt: ISODate | null;
      startedAt: ISODate; // also the turn's first lastActionAt
    }
  /** Turn-action events carry `at` (decide's ctx.now) so apply can track Phase.turn.lastActionAt.
   *  CardsTraded.armies is the set value added to the pool; the +2 bonus goes straight onto bonusTerritory. */
  | {
      type: 'CardsTraded';
      seat: SeatId;
      cardIds: CardId[];
      armies: number;
      bonusTerritory: TerritoryId | null;
      forced: boolean;
      at: ISODate;
    }
  | { type: 'ArmiesPlaced'; seat: SeatId; placements: Record<TerritoryId, number>; at: ISODate }
  | {
      type: 'AttackRolled';
      from: TerritoryId;
      to: TerritoryId;
      attackerRolls: number[];
      defenderRolls: number[];
      attackerLosses: number;
      defenderLosses: number;
      at: ISODate;
    }
  | { type: 'TerritoryConquered'; from: TerritoryId; to: TerritoryId; newOwner: SeatId; previousOwner: SeatId }
  | { type: 'ArmiesOccupied'; from: TerritoryId; to: TerritoryId; armies: number; at: ISODate }
  | { type: 'AttackEnded'; seat: SeatId; at: ISODate }
  | { type: 'Fortified'; from: TerritoryId; to: TerritoryId; armies: number; at: ISODate }
  | { type: 'CardDrawn'; seat: SeatId; cardId: CardId } // redacted for others
  | { type: 'DeckReshuffled'; deck: CardId[] } // server-only payload
  | { type: 'TurnEnded'; seat: SeatId }
  // Timeouts, strikes, removal
  | { type: 'TurnSkipped'; seat: SeatId; reason: 'timeout' | 'inactive'; strikes: number }
  | { type: 'StrikesReset'; seat: SeatId }
  | { type: 'SeatKicked'; seat: SeatId; reason: 'strikes' | 'resigned'; discardedCards: CardId[] }
  | { type: 'SeatEliminated'; seat: SeatId; by: SeatId; cardsTransferred: CardId[] }
  | { type: 'GameEnded'; winner: SeatId; reason: Extract<Phase, { kind: 'game_over' }>['reason'] };

// ---------- Rejections -------------------------------------------------------

export type RejectionCode =
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'WRONG_STEP'
  | 'NOT_HOST'
  | 'GAME_FULL'
  | 'ALREADY_JOINED'
  | 'NOT_ENOUGH_PLAYERS'
  | 'NOT_OWNED'
  | 'NOT_ADJACENT'
  | 'NOT_CONNECTED'
  | 'TERRITORY_TAKEN'
  | 'INSUFFICIENT_ARMIES'
  | 'INVALID_PLACEMENT'
  | 'MUST_PLACE_ALL'
  | 'MUST_TRADE'
  | 'INVALID_SET'
  | 'CARDS_NOT_IN_HAND'
  | 'OCCUPY_PENDING'
  | 'INVALID_OCCUPY_COUNT'
  | 'ALREADY_FORTIFIED'
  | 'SETUP_ALREADY_SUBMITTED'
  | 'TIMER_NOT_EXPIRED'
  | 'SKIP_NOT_ALLOWED'
  | 'INVALID_SETTINGS'
  | 'COLOR_TAKEN'
  | 'STALE_VERSION'
  | 'NOT_A_SEAT'; // the actor (or the target seat) is not a seat in this game

export interface Rejection {
  code: RejectionCode;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: Rejection };

// ---------- Engine signatures -------------------------------------------------

export interface DecideContext {
  now: Date;
  rng: () => number; // crypto-backed on server, Math.random locally
  map: MapDefinition; // caller looks it up by state.settings.mapId
}

/** Validate a command and produce events. Only place randomness happens.
 *  ClaimTimeout / SkipTurn expand into the auto-play events here. */
export type Decide = (state: GameState, actor: Actor, cmd: Command, ctx: DecideContext) => Result<GameEvent[]>;

/** Empty lobby state that event replay starts from (the host joins via SeatJoined).
 *  Replays may pass the game's final settings: lobby SettingsUpdated events carry full settings. */
export type CreateInitialState = (gameId: string, settings: GameSettings) => GameState;

/** Pure reducer. Deterministic: replaying events always rebuilds the same state. */
export type Apply = (state: GameState, event: GameEvent) => GameState;

/** Redaction: other hands, deck order, and others' hidden setup. */
export type ToPlayerView = (state: GameState, viewer: SeatId | null) => PlayerView;

/** Events are also redacted before being sent (CardDrawn, DeckReshuffled, SetupSubmitted). */
export type RedactEvent = (event: GameEvent, viewer: SeatId | null) => GameEvent | null;

// ---------- View transport (edge function → client) ---------------------------

/** Sent by the client on every request; the edge function answers a mismatch with HTTP 426
 *  ("new version available, reload"). Bump on any breaking change to commands or responses. */
export const PROTOCOL_VERSION = 1;

/** Beyond this many events behind, the server skips catch-up events and the client snaps without animating. */
export const MAX_CATCHUP_EVENTS = 200;

export interface SequencedEvent {
  seq: number; // = the state version after this event is applied
  event: GameEvent; // already passed through redactEvent for the viewer
}

/** Response to a view request with `?since=<version>`. */
export interface ViewResponse {
  view: PlayerView;
  /** Redacted events with seq > since, in order (events redacted to null are omitted).
   *  null when `since` is missing or more than MAX_CATCHUP_EVENTS behind. */
  events: SequencedEvent[] | null;
}

/** Finished games only (phase game_over), members only. Events are NOT redacted:
 *  replay reveals hands, hidden setup and draws. Fold with createInitialState + apply. */
export interface ReplayResponse {
  gameId: string;
  settings: GameSettings;
  events: { seq: number; event: GameEvent }[];
}

// ---------- HTTP API of the `game` edge function (transport) ------------------
// Base URL: `<SUPABASE_URL>/functions/v1/game`. Every client request sends `Authorization: Bearer <user JWT>`
// and PROTOCOL_HEADER; a missing or different protocol gets HTTP 426 with code PROTOCOL_MISMATCH.
// `/system` is for the cron fallback only: it needs SYSTEM_SECRET_HEADER instead and skips the protocol check.

/** Request header carrying PROTOCOL_VERSION. */
export const PROTOCOL_HEADER = 'x-wc-protocol';
/** Request header carrying the system-actor secret (cron → function). */
export const SYSTEM_SECRET_HEADER = 'x-wc-system-secret';

/** Host creates an online game and joins it as seat 0. `mode` is always 'online'. */
export interface CreateGameRequest {
  settings?: Partial<Omit<GameSettings, 'mode'>>;
  color?: Color;
}
export interface CreateGameResponse {
  gameId: string;
  joinCode: string;
  version: number;
}

/** What anyone signed in may learn from a join code (the join page; non-members can't read `games`). */
export interface JoinLookupResponse {
  gameId: string;
  joinCode: string;
  phase: Phase['kind'];
  isMember: boolean;
  players: number; // human seats taken
  maxSeats: PlayerCount;
  hostName: string | null;
}

/** displayName / userId on JoinGame are always overwritten by the function (profile + auth).
 *  expectedVersion: optional; when given and the game has moved on, the command fails with STALE_VERSION
 *  instead of being re-decided against the newer state. */
export interface CommandRequest {
  command: Command;
  expectedVersion?: number;
}
export interface CommandResponse {
  version: number; // state version after the command; fetch the view with ?since= to see the events
}

/** Cron fallback: 'timeout' sends ClaimTimeout for the current deadline, 'expire' cancels a stale lobby. */
export interface SystemRequest {
  gameId: string;
  action: 'timeout' | 'expire';
}

/** Realtime: after every write the function broadcasts on channel `game:<gameId>`, event 'version'. */
export const GAME_CHANNEL_PREFIX = 'game:';
export const VERSION_BROADCAST_EVENT = 'version';
export interface VersionPing {
  version: number;
}

export type ApiErrorCode =
  | RejectionCode
  | 'BAD_REQUEST' // 400: malformed body, route or query
  | 'NO_PROFILE' // 400: the caller has no `profiles` row (display name) yet
  | 'UNAUTHORIZED' // 401: missing/invalid user JWT or system secret
  | 'NOT_MEMBER' // 403: the caller holds no seat in this game
  | 'NOT_FOUND' // 404: unknown game, join code or route
  | 'NOT_FINISHED' // 409: replay before game_over
  | 'PROTOCOL_MISMATCH' // 426: reload the client
  | 'INTERNAL'; // 500

/** Error body for every non-2xx response. RejectionCodes come back as 422, except STALE_VERSION as 409. */
export interface ApiError {
  error: { code: ApiErrorCode; message: string };
}

/** Route table (paths relative to the function base URL). */
export type ApiRoute =
  | { method: 'POST'; path: '/games'; body: CreateGameRequest; response: CreateGameResponse }
  | { method: 'GET'; path: `/join/${string}`; body: null; response: JoinLookupResponse }
  | { method: 'POST'; path: `/games/${string}/commands`; body: CommandRequest; response: CommandResponse }
  /** `?since=<version>` optional; see ViewResponse.events. */
  | { method: 'GET'; path: `/games/${string}/view`; body: null; response: ViewResponse }
  | { method: 'GET'; path: `/games/${string}/replay`; body: null; response: ReplayResponse }
  | { method: 'POST'; path: '/system'; body: SystemRequest; response: CommandResponse };
