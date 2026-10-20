// Redaction: other seats' hands, deck order and others' hidden setup never leave the server.
import type { CardId, GameEvent, GameState, PlayerView, SeatId } from './types.ts';

/** Stands in for a card id the viewer may not see (others' draws, cards taken on elimination). */
export const HIDDEN_CARD_ID: CardId = '';

export function toPlayerView(state: GameState, viewer: SeatId | null): PlayerView {
  const { deck, hiddenSetup, seats, ...rest } = JSON.parse(JSON.stringify(state)) as GameState;
  return {
    ...rest,
    viewer,
    deckSize: deck.length,
    seats: seats.map((s) => ({ ...s, hand: s.seat === viewer ? s.hand : null, handSize: s.hand.length })),
    mySetup: viewer !== null && Object.hasOwn(hiddenSetup, viewer) ? hiddenSetup[viewer] : null,
  };
}

export function redactEvent(event: GameEvent, viewer: SeatId | null): GameEvent | null {
  switch (event.type) {
    case 'GameStarted':
      return { ...event, deck: [] };
    case 'DeckReshuffled':
      return { ...event, deck: [] };
    case 'CardDrawn':
      return event.seat === viewer ? event : { ...event, cardId: HIDDEN_CARD_ID };
    case 'SetupSubmitted':
      return event.seat === viewer ? event : { ...event, placements: {}, capital: null };
    case 'SeatEliminated':
      return event.by === viewer || event.seat === viewer
        ? event
        : { ...event, cardsTransferred: event.cardsTransferred.map(() => HIDDEN_CARD_ID) };
    default:
      return event;
  }
}
