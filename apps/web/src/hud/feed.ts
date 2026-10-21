// Plain-language activity feed (SPEC 7.6). Pure: events (already redacted for the viewer) -> lines.
import type { GameEvent, MapDefinition, SeatId } from '@wc/engine';

export interface FeedLine {
  key: number;
  text: string;
  /** Seat the line is about, for coloring. */
  seat: SeatId | null;
}

export interface FeedNames {
  seat(seat: SeatId): string;
  map: MapDefinition;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Builds feed lines; consecutive rolls on one border are merged into a single "attacked" line. */
export function buildFeed(events: readonly GameEvent[], names: FeedNames): FeedLine[] {
  const t = (id: string) => names.map.territories[id]?.name ?? id;
  const out: FeedLine[] = [];
  const push = (text: string, seat: SeatId | null, key: number) => out.push({ key, text, seat });
  // Attacker seat is not in AttackRolled; remember who is playing.
  let current: SeatId | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case 'GameStarted':
        push('Game started', null, i);
        break;
      case 'TerritoriesDealt':
        push('Territories dealt at random', null, i);
        break;
      case 'SetupRevealed':
        push('Setup complete: placements revealed', null, i);
        break;
      case 'TurnStarted': {
        current = e.seat;
        const bonuses = Object.entries(e.reinforcements.continents)
          .filter(([, v]) => v > 0)
          .map(([c, v]) => `${names.map.continents[c]?.name ?? c} +${v}`);
        const detail = [plural(e.reinforcements.territories, 'territory', 'territories'), ...bonuses].join(', ');
        push(
          `${names.seat(e.seat)}'s turn: ${plural(e.reinforcements.total, 'army', 'armies')} (${detail})`,
          e.seat,
          i,
        );
        break;
      }
      case 'CardsTraded':
        push(
          `${names.seat(e.seat)} traded cards for ${plural(e.armies, 'army', 'armies')}${e.forced ? ' (forced)' : ''}`,
          e.seat,
          i,
        );
        break;
      case 'ArmiesPlaced': {
        const n = Object.values(e.placements).reduce((a, b) => a + b, 0);
        push(`${names.seat(e.seat)} placed ${plural(n, 'army', 'armies')}`, e.seat, i);
        break;
      }
      case 'AttackRolled': {
        let attackerLosses = e.attackerLosses;
        let defenderLosses = e.defenderLosses;
        while (i + 1 < events.length) {
          const n = events[i + 1];
          if (n.type !== 'AttackRolled' || n.from !== e.from || n.to !== e.to) break;
          attackerLosses += n.attackerLosses;
          defenderLosses += n.defenderLosses;
          i++;
        }
        const who = current === null ? 'Attack' : names.seat(current);
        push(
          `${who} attacked ${t(e.to)} from ${t(e.from)}: lost ${attackerLosses}, destroyed ${defenderLosses}`,
          current,
          i,
        );
        break;
      }
      case 'TerritoryConquered':
        push(`${names.seat(e.newOwner)} took ${t(e.to)} from ${names.seat(e.previousOwner)}`, e.newOwner, i);
        break;
      case 'ArmiesOccupied':
        push(`Moved ${plural(e.armies, 'army', 'armies')} into ${t(e.to)}`, current, i);
        break;
      case 'Fortified':
        push(
          `${current === null ? 'Fortified' : `${names.seat(current)} fortified`}: ${plural(e.armies, 'army', 'armies')} from ${t(e.from)} to ${t(e.to)}`,
          current,
          i,
        );
        break;
      case 'CardDrawn':
        push(`${names.seat(e.seat)} drew a card`, e.seat, i);
        break;
      case 'SeatEliminated':
        push(`${names.seat(e.by)} eliminated ${names.seat(e.seat)}`, e.by, i);
        break;
      case 'SeatKicked':
        push(`${names.seat(e.seat)} ${e.reason === 'resigned' ? 'resigned' : 'was removed'}`, e.seat, i);
        break;
      case 'GameEnded':
        push(`${names.seat(e.winner)} wins!`, e.winner, i);
        break;
      default:
        break;
    }
  }
  return out;
}
