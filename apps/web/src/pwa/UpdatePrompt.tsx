// Prompt-to-update (SPEC 9.5): a new service worker waits until the player agrees, so a game is never reloaded mid-turn.
import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="banner warn update-prompt" role="status">
      {needRefresh ? 'New version available.' : 'Ready to work offline (pass-and-play).'}{' '}
      {needRefresh && (
        <button type="button" className="primary" onClick={() => void updateServiceWorker(true)}>
          Reload
        </button>
      )}
      <button
        type="button"
        className="ghost"
        onClick={() => {
          setNeedRefresh(false);
          setOfflineReady(false);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
