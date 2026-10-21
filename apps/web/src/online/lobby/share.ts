// Copy link + Web Share (SPEC 2 Join code & link).
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export async function shareLink(url: string): Promise<void> {
  try {
    await navigator.share({ title: 'World Conquest', text: 'Join my World Conquest game', url });
  } catch {
    // dismissed the share sheet
  }
}
