import { classicMap, type GameEvent } from '@wc/engine';
import { describe, expect, it } from 'vitest';
import { buildFeed } from './feed.ts';

const names = { seat: (s: number) => ['Ana', 'Ben'][s] ?? `Seat ${s}`, map: classicMap };

describe('activity feed', () => {
  it('writes plain-language lines and merges blitz rolls', () => {
    const ev: GameEvent[] = [
      {
        type: 'TurnStarted',
        seat: 0,
        reinforcements: { territories: 12, continents: { south_america: 2 }, total: 6 },
        deadlineAt: null,
        startedAt: '',
      },
      {
        type: 'AttackRolled',
        from: 'peru',
        to: 'brazil',
        attackerRolls: [4],
        defenderRolls: [2],
        attackerLosses: 0,
        defenderLosses: 1,
        at: '',
      },
      {
        type: 'AttackRolled',
        from: 'peru',
        to: 'brazil',
        attackerRolls: [1],
        defenderRolls: [2],
        attackerLosses: 1,
        defenderLosses: 0,
        at: '',
      },
      { type: 'TerritoryConquered', from: 'peru', to: 'brazil', newOwner: 0, previousOwner: 1 },
      { type: 'GameEnded', winner: 0, reason: 'world_domination' },
    ];
    const lines = buildFeed(ev, names).map((l) => l.text);
    expect(lines[0]).toBe("Ana's turn: 6 armies (12 territories, South America +2)");
    expect(lines[1]).toBe('Ana attacked Brazil from Peru: lost 1, destroyed 1');
    expect(lines[2]).toBe('Ana took Brazil from Ben');
    expect(lines[3]).toBe('Ana wins!');
  });

  it('never prints card ids', () => {
    const ev: GameEvent[] = [{ type: 'CardDrawn', seat: 1, cardId: '' }];
    expect(buildFeed(ev, names)[0].text).toBe('Ben drew a card');
  });
});
