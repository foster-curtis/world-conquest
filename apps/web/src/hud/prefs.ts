// Per-device HUD preferences (localStorage; every access is guarded, private mode just forgets).
const SIDEBAR_KEY = 'wc-sidebar-closed';

export function loadSidebarClosed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveSidebarClosed(v: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0');
  } catch {
    // ignore
  }
}
