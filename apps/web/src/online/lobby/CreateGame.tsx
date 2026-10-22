// New online game: settings, then the function creates it and we go to its permanent /g/CODE URL.
import { defaultSettings } from '@wc/engine';
import { useState } from 'react';
import { HomeLink } from '../../home/Brand.tsx';
import { ApiException } from '../api.ts';
import { gameApi } from '../supabase.ts';
import { type EditableSettings, patchSettings, SettingsForm } from './SettingsForm.tsx';

export function CreateGame(props: { onCreated: (code: string) => void; onBack: () => void }) {
  const d = defaultSettings('online');
  const [settings, setSettings] = useState<EditableSettings>({
    winCondition: d.winCondition,
    pace: d.pace,
    territoryAssignment: d.territoryAssignment,
    maxSeats: d.maxSeats,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await gameApi().createGame({ settings });
      props.onCreated(r.joinCode);
    } catch (e) {
      setError(e instanceof ApiException || e instanceof Error ? e.message : 'Could not create the game');
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <HomeLink onClick={props.onBack} />
        <h1>New online game</h1>
      </div>
      {error && (
        <div className="banner err" role="alert">
          {error}
        </div>
      )}
      <section>
        <h2>Settings</h2>
        <SettingsForm value={settings} onChange={(p) => setSettings((s) => patchSettings(s, p))} />
        <p className="hint">You can still change these in the lobby. You get a link to share once it is created.</p>
      </section>
      <button type="button" className="primary big" disabled={busy} onClick={() => void create()}>
        Create game
      </button>
    </div>
  );
}
