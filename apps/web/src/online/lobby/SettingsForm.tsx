// Game settings (SPEC 2 Settings), used when creating a game and by the host in the lobby.
import type { GameSettings, PlayerCount } from '@wc/engine';

export type EditableSettings = Pick<GameSettings, 'winCondition' | 'pace' | 'territoryAssignment' | 'maxSeats'>;

/** Draft is only allowed with sync pace; switching to async falls back to random. */
export function patchSettings(cur: EditableSettings, patch: Partial<EditableSettings>): EditableSettings {
  const next = { ...cur, ...patch };
  if (next.pace !== 'sync' && next.territoryAssignment === 'draft') next.territoryAssignment = 'random';
  return next;
}

export function SettingsForm(props: {
  value: EditableSettings;
  onChange: (patch: Partial<EditableSettings>) => void;
  disabled?: boolean;
  /** Seats already taken: maxSeats can't go below this. */
  minSeats?: number;
}) {
  const { value, disabled } = props;
  const seatOptions = ([2, 3, 4, 5, 6] as PlayerCount[]).filter((n) => n >= (props.minSeats ?? 2));
  return (
    <div className="stack settings">
      <label>
        Win condition
        <select
          disabled={disabled}
          value={value.winCondition}
          onChange={(e) => props.onChange({ winCondition: e.target.value as EditableSettings['winCondition'] })}
        >
          <option value="classic">Classic: control every territory</option>
          <option value="capitals">Capitals: capture every capital</option>
        </select>
      </label>
      <label>
        Pace
        <select
          disabled={disabled}
          value={value.pace}
          onChange={(e) => props.onChange({ pace: e.target.value as EditableSettings['pace'] })}
        >
          <option value="async">Async: 24 hours per turn</option>
          <option value="sync">Sync: everyone online, 5 minute idle limit</option>
        </select>
      </label>
      <label>
        Territories
        <select
          disabled={disabled}
          value={value.territoryAssignment}
          onChange={(e) =>
            props.onChange({ territoryAssignment: e.target.value as EditableSettings['territoryAssignment'] })
          }
        >
          <option value="random">Random deal</option>
          <option value="draft" disabled={value.pace !== 'sync'}>
            Draft (sync pace only)
          </option>
        </select>
      </label>
      <label>
        Maximum players
        <select
          disabled={disabled}
          value={value.maxSeats}
          onChange={(e) => props.onChange({ maxSeats: Number(e.target.value) as PlayerCount })}
        >
          {seatOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
