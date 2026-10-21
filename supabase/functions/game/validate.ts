// Shape checks for untrusted request bodies, before anything reaches the engine.
import type { Color, Command, GameSettings, Phase } from '@wc/engine';
import { HttpError } from './http.ts';

const COLORS: readonly string[] = ['red', 'blue', 'green', 'yellow', 'purple', 'black', 'gray'];
const PHASES: readonly string[] = ['lobby', 'draft', 'setup', 'turn', 'game_over', 'canceled'];
const SETTING_KEYS = ['mapId', 'winCondition', 'pace', 'territoryAssignment', 'maxSeats'] as const;

type Obj = Record<string, unknown>;

function bad(message: string): never {
  throw new HttpError(400, 'BAD_REQUEST', message);
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);

function color(v: unknown): Color {
  if (typeof v !== 'string' || !COLORS.includes(v)) bad('bad color');
  return v as Color;
}

function placements(v: unknown): Record<string, number> {
  if (!isObj(v)) bad('placements must be an object');
  for (const [k, n] of Object.entries(v)) if (!isStr(k) || !isInt(n)) bad('placements must map territory → integer');
  return v as Record<string, number>;
}

function territory(v: unknown): string {
  if (!isStr(v)) bad('bad territory');
  return v;
}

/** Only known setting keys with primitive values; the engine validates the values themselves. */
export function settingsPatch(v: unknown): Partial<GameSettings> {
  if (v === undefined) return {};
  if (!isObj(v)) bad('settings must be an object');
  const out: Obj = {};
  for (const key of SETTING_KEYS) {
    if (v[key] === undefined) continue;
    if (typeof v[key] !== 'string' && typeof v[key] !== 'number') bad(`bad setting ${key}`);
    out[key] = v[key];
  }
  return out as Partial<GameSettings>;
}

export function optionalColor(v: unknown): Color | undefined {
  return v === undefined ? undefined : color(v);
}

export function command(v: unknown): Command {
  if (!isObj(v) || typeof v.type !== 'string') bad('command must be an object with a type');
  switch (v.type) {
    case 'JoinGame':
      // displayName / userId are filled in by the caller from profile + auth
      return { type: 'JoinGame', displayName: '', ...(v.color === undefined ? {} : { color: color(v.color) }) };
    case 'LeaveGame':
    case 'CancelGame':
    case 'StartGame':
    case 'EndAttack':
    case 'EndTurn':
    case 'SkipTurn':
      return { type: v.type };
    case 'ChangeColor':
      return { type: 'ChangeColor', color: color(v.color) };
    case 'UpdateSettings':
      return { type: 'UpdateSettings', settings: settingsPatch(v.settings) };
    case 'RemoveFromLobby':
      if (!isInt(v.seat)) bad('seat must be an integer');
      return { type: 'RemoveFromLobby', seat: v.seat };
    case 'DraftPick':
      return { type: 'DraftPick', territory: territory(v.territory) };
    case 'SubmitSetup':
      return {
        type: 'SubmitSetup',
        placements: placements(v.placements),
        ...(v.capital === undefined ? {} : { capital: territory(v.capital) }),
      };
    case 'TradeCards': {
      const ids = v.cardIds;
      if (!Array.isArray(ids) || ids.length !== 3 || !ids.every(isStr)) bad('cardIds must be 3 card ids');
      return { type: 'TradeCards', cardIds: [ids[0], ids[1], ids[2]] };
    }
    case 'PlaceReinforcements':
      return { type: 'PlaceReinforcements', placements: placements(v.placements) };
    case 'Attack': {
      if (v.attackerDice !== 1 && v.attackerDice !== 2 && v.attackerDice !== 3) bad('attackerDice must be 1–3');
      if (v.untilConquered !== undefined && typeof v.untilConquered !== 'boolean') bad('untilConquered must be boolean');
      return {
        type: 'Attack',
        from: territory(v.from),
        to: territory(v.to),
        attackerDice: v.attackerDice,
        ...(v.untilConquered === undefined ? {} : { untilConquered: v.untilConquered }),
      };
    }
    case 'Occupy':
      if (!isInt(v.armies)) bad('armies must be an integer');
      return { type: 'Occupy', armies: v.armies };
    case 'Fortify':
      if (!isInt(v.armies)) bad('armies must be an integer');
      return { type: 'Fortify', from: territory(v.from), to: territory(v.to), armies: v.armies };
    case 'ClaimTimeout':
      if (typeof v.phase !== 'string' || !PHASES.includes(v.phase)) bad('bad phase');
      if (!isStr(v.deadlineAt)) bad('bad deadlineAt');
      return { type: 'ClaimTimeout', phase: v.phase as Phase['kind'], deadlineAt: v.deadlineAt };
    default:
      bad(`unknown command ${String(v.type)}`);
  }
}
