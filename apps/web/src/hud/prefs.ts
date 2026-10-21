// Per-device HUD preferences (localStorage; every access is guarded, private mode just forgets).
const FEED_KEY = 'wc-feed-collapsed';

export function loadFeedCollapsed(): boolean {
  try {
    return localStorage.getItem(FEED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveFeedCollapsed(v: boolean): void {
  try {
    localStorage.setItem(FEED_KEY, v ? '1' : '0');
  } catch {
    // ignore
  }
}
