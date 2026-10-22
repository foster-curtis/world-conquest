import { describe, expect, it } from 'vitest';
import { classicMap } from './maps/classic.ts';
import { emittedTypes, finishSetup, type Game, lobbyGame, playingGame, SYSTEM, seat } from './testing/harness.ts';
import { type GameEvent, type GameState, type SeatId, type TerritoryId, TIMERS } from './types.ts';

const ids = Object.keys(classicMap.territories);
const types = (events: GameEvent[]) => events.map((e) => e.type);
const of = <T extends GameEvent['type']>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** Give every territory to `owner(id)` with `armies(id)` armies. */
function setBoard(g: Game, owner: (id: TerritoryId) => SeatId, armies: (id: TerritoryId) => number = () => 1) {
  g.patch((s) => {
    for (const id of ids) s.territories[id] = { owner: owner(id), armies: armies(id) };
  });
}

/** Move cards from the deck into a seat's hand (keeps cards conserved). */
function giveCards(g: Game, n: SeatId, cardIds: string[]) {
  g.patch((s) => {
    s.deck = s.deck.filter((c) => !cardIds.includes(c));
    for (const x of s.seats) x.hand = x.hand.filter((c) => !cardIds.includes(c));
    (s.seats.find((x) => x.seat === n) as GameState['seats'][number]).hand.push(...cardIds);
  });
}

function turnPhase(g: Game) {
  const p = g.state.phase;
  if (p.kind !== 'turn') throw new Error('not in a turn');
  return p;
}

describe('lobby', () => {
  it('seats, colors and host', () => {
    const g = lobbyGame(3, {}, 1, false);
    expect(g.state.seats.map((s) => [s.seat, s.color])).toEqual([
      [0, 'crimson'],
      [1, 'cobalt'],
      [2, 'jade'],
    ]);
    expect(g.state.hostSeat).toBe(0);
    expect(g.reject(SYSTEM, { type: 'JoinGame', displayName: 'X', userId: 'user-1' })).toBe('ALREADY_JOINED');
    expect(g.reject(seat(1), { type: 'JoinGame', displayName: 'X' })).toBe('ALREADY_JOINED');
    expect(g.reject(SYSTEM, { type: 'JoinGame', displayName: 'X', color: 'cobalt' })).toBe('COLOR_TAKEN');
    expect(g.reject(SYSTEM, { type: 'JoinGame', displayName: 'X', color: 'gray' })).toBe('COLOR_TAKEN');
    g.do(SYSTEM, { type: 'JoinGame', displayName: 'Dee', color: 'sky' });
    expect(g.state.seats[3]).toMatchObject({ seat: 3, color: 'sky', userId: null, displayName: 'Dee' });
  });

  it('change color only to a free, non-neutral color', () => {
    const g = lobbyGame(2, {}, 1, false);
    expect(g.reject(seat(1), { type: 'ChangeColor', color: 'crimson' })).toBe('COLOR_TAKEN');
    expect(g.reject(seat(1), { type: 'ChangeColor', color: 'gray' })).toBe('COLOR_TAKEN');
    expect(g.reject(seat(4), { type: 'ChangeColor', color: 'sky' })).toBe('NOT_A_SEAT');
    expect(g.do(seat(1), { type: 'ChangeColor', color: 'bone' })).toEqual([
      { type: 'SeatColorChanged', seat: 1, color: 'bone' },
    ]);
  });

  it('settings: host only, validated, broadcast in full', () => {
    const g = lobbyGame(3, { mode: 'online' }, 1, false);
    expect(g.reject(seat(1), { type: 'UpdateSettings', settings: { pace: 'sync' } })).toBe('NOT_HOST');
    expect(g.reject(seat(0), { type: 'UpdateSettings', settings: { maxSeats: 2 } })).toBe('INVALID_SETTINGS');
    expect(g.reject(seat(0), { type: 'UpdateSettings', settings: { territoryAssignment: 'draft' } })).toBe(
      'INVALID_SETTINGS',
    );
    expect(g.reject(seat(0), { type: 'UpdateSettings', settings: { mapId: 'mars' } })).toBe('INVALID_SETTINGS');
    const [e] = g.do(seat(0), { type: 'UpdateSettings', settings: { pace: 'sync', territoryAssignment: 'draft' } });
    expect(e).toEqual({
      type: 'SettingsUpdated',
      settings: { ...g.initial.settings, pace: 'sync', territoryAssignment: 'draft' },
    });
    g.do(seat(0), { type: 'UpdateSettings', settings: { maxSeats: 3 } });
    expect(g.reject(SYSTEM, { type: 'JoinGame', displayName: 'late' })).toBe('GAME_FULL');
  });

  it('host leaving passes host to the earliest-joined remaining seat; last one out cancels', () => {
    const g = lobbyGame(3, {}, 1, false);
    g.do(seat(1), { type: 'LeaveGame' });
    g.do(SYSTEM, { type: 'JoinGame', displayName: 'late' }); // reuses seat 1 but joined last
    expect(types(g.do(seat(0), { type: 'LeaveGame' }))).toEqual(['SeatLeft', 'HostChanged']);
    expect(g.state.hostSeat).toBe(2);
    expect(g.reject(seat(1), { type: 'RemoveFromLobby', seat: 2 })).toBe('NOT_HOST');
    expect(g.reject(seat(2), { type: 'RemoveFromLobby', seat: 5 })).toBe('NOT_A_SEAT');
    expect(g.do(seat(2), { type: 'RemoveFromLobby', seat: 1 })).toEqual([
      { type: 'SeatLeft', seat: 1, removedByHost: true },
    ]);
    expect(g.do(seat(2), { type: 'LeaveGame' })).toEqual([
      { type: 'SeatLeft', seat: 2, removedByHost: false },
      { type: 'GameCanceled', reason: 'empty' },
    ]);
    expect(g.state.phase).toEqual({ kind: 'canceled', reason: 'empty' });
    expect(g.reject(SYSTEM, { type: 'JoinGame', displayName: 'x' })).toBe('WRONG_PHASE');
  });

  it('cancel: host or system only', () => {
    const g = lobbyGame(2, {}, 1, false);
    expect(g.reject(seat(1), { type: 'CancelGame' })).toBe('NOT_HOST');
    expect(g.do(SYSTEM, { type: 'CancelGame' })).toEqual([{ type: 'GameCanceled', reason: 'expired' }]);
    const h = lobbyGame(2, {}, 1, false);
    expect(h.do(seat(0), { type: 'CancelGame' })).toEqual([{ type: 'GameCanceled', reason: 'host' }]);
  });

  it('start needs the host and 2+ players', () => {
    const g = lobbyGame(1, {}, 1, false);
    expect(g.reject(seat(0), { type: 'StartGame' })).toBe('NOT_ENOUGH_PLAYERS');
    g.do(SYSTEM, { type: 'JoinGame', displayName: 'b' });
    expect(g.reject(seat(1), { type: 'StartGame' })).toBe('NOT_HOST');
    expect(g.reject(SYSTEM, { type: 'StartGame' })).toBe('NOT_A_SEAT');
  });
});

describe('start and random deal', () => {
  it('2 players: neutral gray seat, 14 territories each, 40 starting armies', () => {
    const g = lobbyGame(2);
    expect(types(g.log.slice(2))).toEqual(['GameStarted', 'TerritoriesDealt', 'SetupStarted', 'NeutralPlaced']);
    const started = of(g.log, 'GameStarted')[0];
    expect([...started.turnOrder].sort()).toEqual([0, 1]);
    expect(started.neutralSeat).toBe(2);
    expect(new Set(started.deck).size).toBe(44);
    const neutral = g.state.seats.find((s) => s.kind === 'neutral');
    expect(neutral).toMatchObject({ seat: 2, color: 'gray', turnOrder: null });
    for (const s of [0, 1, 2]) expect(g.owned(s)).toHaveLength(14);
    const setup = g.state.phase;
    expect(setup.kind === 'setup' && setup.armiesToPlace).toEqual({ 0: 26, 1: 26, 2: 26 });
    const neutralArmies = g.owned(2).reduce((n, t) => n + g.state.territories[t].armies, 0);
    expect(neutralArmies).toBe(40);
    expect(g.state.phase.kind === 'setup' && g.state.phase.submitted).toEqual([2]);
  });

  it('4 players: first seats in assignment order get the extra territories', () => {
    const g = lobbyGame(4);
    const order = of(g.log, 'GameStarted')[0].turnOrder;
    expect(order.map((s) => g.owned(s).length)).toEqual([11, 11, 10, 10]);
    const p = g.state.phase;
    expect(p.kind === 'setup' && order.map((s) => p.armiesToPlace[s])).toEqual([19, 19, 20, 20]);
    expect(of(g.log, 'GameStarted')[0].neutralSeat).toBeNull();
  });
});

describe('setup (simultaneous, hidden)', () => {
  it('submissions stay hidden until everyone is done, then reveal and turn 1', () => {
    const g = lobbyGame(3, { winCondition: 'capitals' });
    const p = g.state.phase;
    if (p.kind !== 'setup') throw new Error();
    const mine = g.owned(0);
    const other = g.owned(1)[0];
    expect(g.reject(seat(0), { type: 'SubmitSetup', placements: { [mine[0]]: 1 }, capital: mine[0] })).toBe(
      'MUST_PLACE_ALL',
    );
    expect(g.reject(seat(0), { type: 'SubmitSetup', placements: { [other]: p.armiesToPlace[0] } })).toBe('NOT_OWNED');
    expect(g.reject(seat(0), { type: 'SubmitSetup', placements: { [mine[0]]: p.armiesToPlace[0] } })).toBe(
      'INVALID_PLACEMENT',
    ); // capitals mode needs a capital
    expect(g.reject(seat(0), { type: 'SubmitSetup', placements: { [mine[0]]: -1, [mine[1]]: 1 } })).toBe(
      'INVALID_PLACEMENT',
    );
    const before = g.state.territories;
    g.do(seat(0), { type: 'SubmitSetup', placements: { [mine[0]]: p.armiesToPlace[0] }, capital: mine[1] });
    expect(g.state.territories).toEqual(before);
    expect(g.state.hiddenSetup[0]).toEqual({ placements: { [mine[0]]: p.armiesToPlace[0] }, capital: mine[1] });
    expect(g.reject(seat(0), { type: 'SubmitSetup', placements: {}, capital: mine[0] })).toBe(
      'SETUP_ALREADY_SUBMITTED',
    );
    finishSetup(g);
    const tail = types(g.log.slice(-2));
    expect(tail).toEqual(['SetupRevealed', 'TurnStarted']);
    expect(g.state.territories[mine[0]].armies).toBe(1 + p.armiesToPlace[0]);
    expect(g.state.seats.find((s) => s.seat === 0)?.capital).toBe(mine[1]);
    expect(g.state.hiddenSetup).toEqual({});
    expect(g.turnSeat()).toBe(of(g.log, 'GameStarted')[0].turnOrder[0]);
  });

  it('setup timeout auto-fills evenly; claims are checked against the deadline', () => {
    const g = lobbyGame(3, { mode: 'online', pace: 'sync' });
    const p = g.state.phase;
    if (p.kind !== 'setup') throw new Error();
    const mine = g.owned(1);
    g.do(seat(1), { type: 'SubmitSetup', placements: { [mine[0]]: p.armiesToPlace[1] } });
    const claim = { type: 'ClaimTimeout', phase: 'setup', deadlineAt: p.deadlineAt } as const;
    expect(Date.parse(p.deadlineAt) - g.now.getTime()).toBe(TIMERS.setupMs.sync);
    expect(g.reject(SYSTEM, claim)).toBe('TIMER_NOT_EXPIRED');
    g.advance(TIMERS.setupMs.sync + TIMERS.graceMs);
    expect(g.reject(SYSTEM, claim)).toBe('TIMER_NOT_EXPIRED');
    g.advance(1);
    expect(g.reject(SYSTEM, { ...claim, deadlineAt: '2020-01-01T00:00:00.000Z' })).toBe('STALE_VERSION');
    expect(g.reject(SYSTEM, { ...claim, phase: 'turn' })).toBe('STALE_VERSION');
    const events = g.do(seat(1), claim);
    const auto = of(events, 'SetupSubmitted');
    expect(auto.map((e) => [e.seat, e.auto]).sort()).toEqual([
      [0, true],
      [2, true],
    ]);
    for (const e of auto) {
      const values = Object.values(e.placements);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
      expect(values.reduce((a, b) => a + b, 0)).toBe(p.armiesToPlace[e.seat]);
    }
    expect(types(events).slice(-2)).toEqual(['SetupRevealed', 'TurnStarted']);
    expect(g.reject(SYSTEM, claim)).toBe('STALE_VERSION');
  });
});

describe('draft (online, sync)', () => {
  it('picks in assignment order with neutral auto-picks; timeouts pick at random', () => {
    const g = lobbyGame(2, { mode: 'online', pace: 'sync', territoryAssignment: 'draft' });
    const started = of(g.log, 'GameStarted')[0];
    expect(started.draftDeadlineAt).not.toBeNull();
    const [first, second] = started.turnOrder;
    const p = g.state.phase;
    expect(p).toEqual({ kind: 'draft', pickingSeat: first, deadlineAt: started.draftDeadlineAt });
    expect(g.reject(seat(second), { type: 'DraftPick', territory: 'alaska' })).toBe('NOT_YOUR_TURN');
    expect(g.reject(seat(first), { type: 'DraftPick', territory: 'atlantis' })).toBe('INVALID_PLACEMENT');
    g.do(seat(first), { type: 'DraftPick', territory: 'alaska' });
    expect(g.reject(seat(second), { type: 'DraftPick', territory: 'alaska' })).toBe('TERRITORY_TAKEN');
    const events = g.do(seat(second), { type: 'DraftPick', territory: 'peru' });
    // second pick hands over to the neutral seat, which picks instantly
    expect(events.map((e) => e.type === 'DraftPicked' && [e.seat, e.auto])).toEqual([
      [second, false],
      [2, true],
    ]);
    if (g.state.phase.kind !== 'draft') throw new Error();
    const { deadlineAt } = g.state.phase;
    g.advance(TIMERS.draftPickMs + TIMERS.graceMs + 1);
    const timeout = g.do(SYSTEM, { type: 'ClaimTimeout', phase: 'draft', deadlineAt });
    expect(timeout[0]).toMatchObject({ type: 'DraftPicked', seat: first, auto: true });
    while (g.state.phase.kind === 'draft') {
      const picker = g.state.phase.pickingSeat;
      const free = ids.find((t) => !g.state.territories[t]) as string;
      g.do(seat(picker), { type: 'DraftPick', territory: free });
    }
    expect(g.state.phase).toMatchObject({ kind: 'setup' });
    expect([0, 1, 2].map((s) => g.owned(s).length)).toEqual([14, 14, 14]);
    expect(of(g.log, 'DraftPicked').at(-1)?.nextDeadlineAt).toBeNull();
  });
});

describe('turns', () => {
  it('reinforce → attack → occupy → fortify → end, with the guards in between', () => {
    const g = playingGame(3, {}, 4);
    const me = g.turnSeat();
    const foe = (me + 1) % 3;
    setBoard(
      g,
      (id) =>
        ['alaska', 'alberta', 'northwest_territory', 'greenland'].includes(id)
          ? me
          : id === 'kamchatka' || id === 'japan'
            ? foe
            : (me + 2) % 3,
      (id) => (id === 'alaska' ? 10 : 1),
    );
    g.patch((s) => {
      if (s.phase.kind === 'turn') s.phase.reinforcementsRemaining = 3;
    });
    const attack = { type: 'Attack', from: 'alaska', to: 'kamchatka', attackerDice: 3 } as const;
    expect(g.reject(seat(foe), attack)).toBe('NOT_YOUR_TURN');
    expect(g.reject(seat(me), attack)).toBe('MUST_PLACE_ALL');
    expect(g.reject(seat(me), { type: 'PlaceReinforcements', placements: { alaska: 4 } })).toBe('INSUFFICIENT_ARMIES');
    expect(g.reject(seat(me), { type: 'PlaceReinforcements', placements: { peru: 1 } })).toBe('NOT_OWNED');
    expect(g.reject(seat(me), { type: 'PlaceReinforcements', placements: { alaska: 0 } })).toBe('INVALID_PLACEMENT');
    g.do(seat(me), { type: 'PlaceReinforcements', placements: { alaska: 1 } });
    expect(turnPhase(g).step).toBe('reinforce');
    g.do(seat(me), { type: 'PlaceReinforcements', placements: { alaska: 1, alberta: 1 } });
    expect(turnPhase(g).step).toBe('attack');
    expect(g.reject(seat(me), { type: 'TradeCards', cardIds: ['a', 'b', 'c'] })).toBe('WRONG_STEP');
    expect(g.reject(seat(me), { ...attack, to: 'japan' })).toBe('NOT_ADJACENT');
    expect(g.reject(seat(me), { ...attack, to: 'alberta' })).toBe('NOT_OWNED');
    expect(g.reject(seat(me), { ...attack, from: 'alberta', to: 'western_us' })).toBe('INSUFFICIENT_ARMIES');
    const events = g.do(seat(me), { ...attack, untilConquered: true });
    const rolls = of(events, 'AttackRolled');
    for (const r of rolls)
      expect(r.attackerLosses + r.defenderLosses).toBe(Math.min(r.attackerRolls.length, r.defenderRolls.length));
    expect(types(events).at(-1)).toBe('TerritoryConquered');
    const occ = turnPhase(g).pendingOccupy;
    expect(occ).toEqual({
      from: 'alaska',
      to: 'kamchatka',
      minArmies: rolls.at(-1)?.attackerRolls.length,
      maxArmies: g.state.territories.alaska.armies - 1,
    });
    expect(g.reject(seat(me), { type: 'EndTurn' })).toBe('OCCUPY_PENDING');
    expect(g.reject(seat(me), { type: 'Occupy', armies: 99 })).toBe('INVALID_OCCUPY_COUNT');
    g.do(seat(me), { type: 'Occupy', armies: occ?.minArmies ?? 0 });
    expect(g.reject(seat(me), { type: 'Fortify', from: 'greenland', to: 'kamchatka', armies: 1 })).toBe(
      'INSUFFICIENT_ARMIES',
    );
    expect(g.reject(seat(me), { type: 'Fortify', from: 'alaska', to: 'peru', armies: 1 })).toBe('NOT_OWNED');
    g.patch((s) => {
      s.territories.western_us = { owner: me, armies: 1 };
      s.territories.alberta.owner = foe;
    });
    expect(g.reject(seat(me), { type: 'Fortify', from: 'alaska', to: 'western_us', armies: 1 })).toBe('NOT_CONNECTED');
    const fort = g.do(seat(me), { type: 'Fortify', from: 'alaska', to: 'greenland', armies: 1 });
    expect(types(fort)).toEqual(['AttackEnded', 'Fortified']);
    expect(g.reject(seat(me), { type: 'Fortify', from: 'alaska', to: 'greenland', armies: 1 })).toBe(
      'ALREADY_FORTIFIED',
    );
    expect(g.reject(seat(me), attack)).toBe('WRONG_STEP');
    const end = g.do(seat(me), { type: 'EndTurn' });
    expect(types(end)).toEqual(['CardDrawn', 'TurnEnded', 'TurnStarted']);
    expect(g.state.seats.find((s) => s.seat === me)?.hand).toHaveLength(1);
  });

  it('card trades: must trade at 5+, escalating value, +2 territory bonus', () => {
    const g = playingGame(3, {}, 5);
    const me = g.turnSeat();
    const mine = g.owned(me);
    const theirs = ids.filter((t) => !mine.includes(t));
    // three infantry: one I own, plus 2 others → valid set; plus two extra cards → hand of 5
    const infantry = (list: string[]) => list.filter((t) => classicMap.territories[t].cardSymbol === 'infantry');
    const set = [infantry(theirs)[0], infantry(mine)[0], infantry(theirs)[1]];
    giveCards(g, me, [...set, 'wild:1', infantry(theirs)[2]]);
    const remaining = turnPhase(g).reinforcementsRemaining;
    expect(g.reject(seat(me), { type: 'PlaceReinforcements', placements: { [mine[0]]: 1 } })).toBe('MUST_TRADE');
    expect(g.reject(seat(me), { type: 'TradeCards', cardIds: [set[0], set[1], 'peru'] })).toBe('CARDS_NOT_IN_HAND');
    expect(g.reject(seat(me), { type: 'TradeCards', cardIds: [set[0], set[0], set[1]] })).toBe('CARDS_NOT_IN_HAND');
    const before = g.state.territories[set[1]].armies;
    const [e] = g.do(seat(me), { type: 'TradeCards', cardIds: [set[0], set[1], set[2]] });
    expect(e).toMatchObject({ type: 'CardsTraded', armies: 4, bonusTerritory: set[1], forced: false });
    expect(g.state.territories[set[1]].armies).toBe(before + 2);
    expect(turnPhase(g).reinforcementsRemaining).toBe(remaining + 4);
    expect(g.state.tradeCount).toBe(1);
    expect(g.state.discard).toEqual(set);
  });

  it('an invalid set is rejected', () => {
    const g = playingGame(3, {}, 6);
    const me = g.turnSeat();
    const inf = ids.filter((t) => classicMap.territories[t].cardSymbol === 'infantry');
    const cav = ids.filter((t) => classicMap.territories[t].cardSymbol === 'cavalry');
    giveCards(g, me, [inf[0], inf[1], cav[0]]);
    expect(g.reject(seat(me), { type: 'TradeCards', cardIds: [inf[0], inf[1], cav[0]] })).toBe('INVALID_SET');
  });

  it('deck reshuffles from the discard pile when empty', () => {
    const g = playingGame(3, {}, 7);
    const me = g.turnSeat();
    g.patch((s) => {
      s.discard = [...s.deck];
      s.deck = [];
      if (s.phase.kind === 'turn') {
        s.phase.step = 'attack';
        s.phase.reinforcementsRemaining = 0;
        s.phase.conqueredThisTurn = true;
      }
    });
    const events = g.do(seat(me), { type: 'EndTurn' });
    expect(types(events).slice(0, 2)).toEqual(['DeckReshuffled', 'CardDrawn']);
    expect(g.state.deck).toHaveLength(43);
    expect(g.state.discard).toEqual([]);
  });

  it('elimination takes the cards; 6+ forces trades before attacking again', () => {
    const g = playingGame(3, {}, 8);
    const me = g.turnSeat();
    const victim = (me + 1) % 3;
    const other = (me + 2) % 3;
    setBoard(
      g,
      (id) =>
        id === 'kamchatka' ? victim : classicMap.territories[id].continent === 'asia' || id === 'alaska' ? me : other,
      (id) => (id === 'alaska' ? 40 : 1),
    );
    const inf = ids.filter((t) => classicMap.territories[t].cardSymbol === 'infantry');
    giveCards(g, me, inf.slice(0, 3));
    giveCards(g, victim, inf.slice(3, 6));
    g.patch((s) => {
      if (s.phase.kind === 'turn') {
        s.phase.step = 'attack';
        s.phase.reinforcementsRemaining = 0;
      }
    });
    const events = g.do(seat(me), {
      type: 'Attack',
      from: 'alaska',
      to: 'kamchatka',
      attackerDice: 3,
      untilConquered: true,
    });
    expect(of(events, 'SeatEliminated')[0]).toEqual({
      type: 'SeatEliminated',
      seat: victim,
      by: me,
      cardsTransferred: inf.slice(3, 6),
    });
    expect(g.state.seats.find((s) => s.seat === victim)?.status).toBe('eliminated');
    g.do(seat(me), { type: 'Occupy', armies: 3 });
    expect(turnPhase(g).forcedTrade).toEqual({ armiesToPlace: 0 });
    const attack = { type: 'Attack', from: 'kamchatka', to: 'alaska', attackerDice: 1 } as const;
    expect(g.reject(seat(me), attack)).toBe('MUST_TRADE');
    expect(g.reject(seat(me), { type: 'PlaceReinforcements', placements: { kamchatka: 1 } })).toBe('MUST_TRADE');
    g.do(seat(me), { type: 'TradeCards', cardIds: inf.slice(0, 3) as [string, string, string] });
    expect(g.reject(seat(me), { type: 'TradeCards', cardIds: inf.slice(3, 6) as [string, string, string] })).toBe(
      'WRONG_STEP',
    );
    expect(g.reject(seat(me), attack)).toBe('MUST_PLACE_ALL');
    expect(turnPhase(g).forcedTrade).toEqual({ armiesToPlace: 4 });
    g.do(seat(me), { type: 'PlaceReinforcements', placements: { kamchatka: 4 } });
    expect(turnPhase(g).forcedTrade).toBeNull();
    expect(turnPhase(g).step).toBe('attack');
  });
});

describe('win conditions', () => {
  function finalBlow(winCondition: 'classic' | 'capitals', players: number) {
    const g = playingGame(players, { winCondition }, 9);
    const me = g.turnSeat();
    const victim = (me + 1) % players;
    setBoard(
      g,
      (id) => (id === 'kamchatka' ? victim : me),
      (id) => (id === 'alaska' ? 40 : 1),
    );
    g.patch((s) => {
      if (s.phase.kind === 'turn') {
        s.phase.step = 'attack';
        s.phase.reinforcementsRemaining = 0;
      }
      for (const x of s.seats) x.capital = x.kind === 'human' ? (x.seat === victim ? 'kamchatka' : 'peru') : null;
    });
    return {
      g,
      me,
      events: g.do(seat(me), {
        type: 'Attack',
        from: 'alaska',
        to: 'kamchatka',
        attackerDice: 3,
        untilConquered: true,
      }),
    };
  }

  it('classic: world domination (with the minimum moved in)', () => {
    const { g, me, events } = finalBlow('classic', 3);
    expect(types(events).slice(-3)).toEqual(['SeatEliminated', 'ArmiesOccupied', 'GameEnded']);
    expect(g.state.phase).toEqual({ kind: 'game_over', winner: me, reason: 'world_domination' });
    expect(g.state.territories.kamchatka.armies).toBeGreaterThan(0);
  });

  it('capitals: holding every capital wins', () => {
    const { g, me } = finalBlow('capitals', 4);
    expect(g.state.phase).toEqual({ kind: 'game_over', winner: me, reason: 'capitals' });
  });

  it('2 players: eliminating the other human wins by last standing while neutral remains', () => {
    const g = playingGame(2, {}, 10);
    const me = g.turnSeat();
    const foe = 1 - me;
    setBoard(
      g,
      (id) => (id === 'kamchatka' ? foe : classicMap.territories[id].continent === 'africa' ? 2 : me),
      (id) => (id === 'alaska' ? 40 : 1),
    );
    g.patch((s) => {
      if (s.phase.kind === 'turn') s.phase.step = 'attack';
    });
    g.do(seat(me), { type: 'Attack', from: 'alaska', to: 'kamchatka', attackerDice: 3, untilConquered: true });
    expect(g.state.phase).toEqual({ kind: 'game_over', winner: me, reason: 'last_standing' });
  });
});

describe('timers and auto-play', () => {
  it('async: turn timeout auto-trades at 5+, spreads evenly, strikes, and kicks after 3', () => {
    const g = playingGame(3, { mode: 'online', pace: 'async' }, 11);
    const victim = g.turnSeat();
    const inf = ids.filter((t) => classicMap.territories[t].cardSymbol === 'infantry');
    giveCards(g, victim, inf.slice(0, 5));
    const claimTurn = () => {
      const p = turnPhase(g);
      if (p.deadlineAt === null) throw new Error('async turns have deadlines');
      g.now = new Date(Date.parse(p.deadlineAt) + TIMERS.graceMs + 1);
      return g.do(SYSTEM, { type: 'ClaimTimeout', phase: 'turn', deadlineAt: p.deadlineAt });
    };
    const p = turnPhase(g);
    expect(Date.parse(p.deadlineAt as string) - Date.parse(p.startedAt)).toBe(TIMERS.turnDeadlineMs);
    expect(g.reject(SYSTEM, { type: 'ClaimTimeout', phase: 'turn', deadlineAt: p.deadlineAt as string })).toBe(
      'TIMER_NOT_EXPIRED',
    );
    const first = claimTurn();
    expect(types(first)).toEqual(['CardsTraded', 'ArmiesPlaced', 'TurnSkipped', 'TurnEnded', 'TurnStarted']);
    expect(of(first, 'CardsTraded')[0].forced).toBe(true);
    const placed = Object.values(of(first, 'ArmiesPlaced')[0].placements);
    expect(Math.max(...placed) - Math.min(...placed)).toBeLessThanOrEqual(1);
    expect(of(first, 'TurnSkipped')[0]).toEqual({ type: 'TurnSkipped', seat: victim, reason: 'timeout', strikes: 1 });
    // others play normally; the victim times out twice more → kicked
    for (let strike = 2; strike <= 3; strike++) {
      while (g.turnSeat() !== victim) {
        if (turnPhase(g).step === 'reinforce') {
          g.do(seat(g.turnSeat()), {
            type: 'PlaceReinforcements',
            placements: { [g.owned(g.turnSeat())[0]]: turnPhase(g).reinforcementsRemaining },
          });
        }
        g.do(seat(g.turnSeat()), { type: 'EndTurn' });
      }
      const events = claimTurn();
      expect(of(events, 'TurnSkipped')[0].strikes).toBe(strike);
      if (strike === 3) {
        expect(of(events, 'SeatKicked')[0]).toMatchObject({ seat: victim, reason: 'strikes' });
        expect(g.state.seats.find((s) => s.seat === victim)?.status).toBe('kicked');
      }
    }
  });

  it('a real action resets strikes', () => {
    const g = playingGame(3, { mode: 'online', pace: 'async' }, 12);
    const me = g.turnSeat();
    g.patch((s) => {
      const x = s.seats.find((y) => y.seat === me);
      if (x) x.consecutiveStrikes = 2;
    });
    const events = g.do(seat(me), {
      type: 'PlaceReinforcements',
      placements: { [g.owned(me)[0]]: 1 },
    });
    expect(types(events)).toEqual(['StrikesReset', 'ArmiesPlaced']);
    expect(turnPhase(g).lastActionAt).toBe(g.now.toISOString());
  });

  it('sync: others may skip after 5 minutes of inactivity', () => {
    const g = playingGame(3, { mode: 'online', pace: 'sync' }, 13);
    const me = g.turnSeat();
    const other = (me + 1) % 3;
    expect(turnPhase(g).deadlineAt).toBeNull();
    g.advance(TIMERS.turnInactivityMs);
    expect(g.reject(seat(other), { type: 'SkipTurn' })).toBe('TIMER_NOT_EXPIRED');
    g.advance(1);
    expect(g.reject(seat(me), { type: 'SkipTurn' })).toBe('SKIP_NOT_ALLOWED');
    expect(g.reject(SYSTEM, { type: 'ClaimTimeout', phase: 'turn', deadlineAt: '' })).toBe('STALE_VERSION');
    const events = g.do(seat(other), { type: 'SkipTurn' });
    expect(of(events, 'TurnSkipped')[0]).toMatchObject({ seat: me, reason: 'inactive', strikes: 1 });
    expect(g.turnSeat()).not.toBe(me);
  });

  it('local games have no turn timers', () => {
    const g = playingGame(2, {}, 14);
    expect(turnPhase(g).deadlineAt).toBeNull();
    expect(g.reject(seat(1 - g.turnSeat()), { type: 'SkipTurn' })).toBe('SKIP_NOT_ALLOWED');
  });
});

describe('resigning', () => {
  it('on your own turn: pending occupy resolves with the minimum, no card, next player goes', () => {
    const g = playingGame(3, {}, 15);
    const me = g.turnSeat();
    setBoard(
      g,
      (id) =>
        id === 'alaska'
          ? me
          : id === 'kamchatka' || id === 'japan'
            ? (me + 1) % 3
            : ids.indexOf(id) % 2 === 0
              ? me
              : (me + 2) % 3,
      (id) => (id === 'alaska' ? 40 : 1),
    );
    g.patch((s) => {
      if (s.phase.kind === 'turn') s.phase.step = 'attack';
    });
    g.do(seat(me), { type: 'Attack', from: 'alaska', to: 'kamchatka', attackerDice: 3, untilConquered: true });
    const occ = turnPhase(g).pendingOccupy;
    const events = g.do(seat(me), { type: 'LeaveGame' });
    expect(types(events)).toEqual(['ArmiesOccupied', 'TurnEnded', 'SeatKicked', 'TurnStarted']);
    expect(of(events, 'ArmiesOccupied')[0].armies).toBe(occ?.minArmies);
    expect(of(events, 'SeatKicked')[0]).toMatchObject({ seat: me, reason: 'resigned' });
    expect(g.reject(seat(me), { type: 'LeaveGame' })).toBe('WRONG_PHASE');
  });

  it('in a 2-player game the other human wins at once', () => {
    const g = playingGame(2, {}, 16);
    const quitter = 1 - g.turnSeat();
    const events = g.do(seat(quitter), { type: 'LeaveGame' });
    expect(types(events)).toEqual(['SeatKicked', 'GameEnded']);
    expect(g.state.phase).toEqual({ kind: 'game_over', winner: 1 - quitter, reason: 'last_standing' });
    expect(g.reject(seat(1 - quitter), { type: 'LeaveGame' })).toBe('WRONG_PHASE');
  });

  it('during setup the placements are auto-filled first', () => {
    const g = lobbyGame(3);
    const events = g.do(seat(1), { type: 'LeaveGame' });
    expect(types(events)).toEqual(['SetupSubmitted', 'SeatKicked']);
    expect(of(events, 'SetupSubmitted')[0].auto).toBe(true);
    finishSetup(g);
    expect(g.turnSeat()).not.toBe(1);
  });

  it('during the draft the seat keeps auto-picking', () => {
    const g = lobbyGame(3, { mode: 'online', pace: 'sync', territoryAssignment: 'draft' });
    const order = of(g.log, 'GameStarted')[0].turnOrder;
    const events = g.do(seat(order[0]), { type: 'LeaveGame' });
    expect(types(events)).toEqual(['SeatKicked', 'DraftPicked']);
    expect(of(events, 'DraftPicked')[0]).toMatchObject({ seat: order[0], auto: true });
    while (g.state.phase.kind === 'draft') {
      const free = ids.find((t) => !g.state.territories[t]) as string;
      g.do(seat(g.state.phase.pickingSeat), { type: 'DraftPick', territory: free });
    }
    expect(g.owned(order[0])).toHaveLength(14);
    const setupSubmitted = of(g.log, 'SetupSubmitted');
    expect(setupSubmitted.map((e) => [e.seat, e.auto])).toEqual([[order[0], true]]);
  });
});

// Event shapes freeze when M1 merges (SPEC §9.4), so every type must be exercised by the tests above.
const ALL_EVENT_TYPES = [
  'SeatJoined',
  'SeatLeft',
  'SeatColorChanged',
  'HostChanged',
  'GameCanceled',
  'SettingsUpdated',
  'GameStarted',
  'TerritoriesDealt',
  'DraftPicked',
  'SetupStarted',
  'SetupSubmitted',
  'NeutralPlaced',
  'SetupRevealed',
  'TurnStarted',
  'CardsTraded',
  'ArmiesPlaced',
  'AttackRolled',
  'TerritoryConquered',
  'ArmiesOccupied',
  'AttackEnded',
  'Fortified',
  'CardDrawn',
  'DeckReshuffled',
  'TurnEnded',
  'TurnSkipped',
  'StrikesReset',
  'SeatKicked',
  'SeatEliminated',
  'GameEnded',
] as const satisfies readonly GameEvent['type'][];
// Compile-time: fails to typecheck if a GameEvent type is missing from the list above.
const exhaustive: Exclude<GameEvent['type'], (typeof ALL_EVENT_TYPES)[number]> extends never ? true : false = true;

describe('event coverage', () => {
  it('every GameEvent type was emitted by a test in this file', () => {
    expect(exhaustive).toBe(true);
    expect(ALL_EVENT_TYPES.filter((t) => !emittedTypes.has(t))).toEqual([]);
  });
});
