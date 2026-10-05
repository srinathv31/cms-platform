// Apple platforms show ⌘ ⌥ ⇧ and use ⌘ as the shortcut modifier; everything else Ctrl, Alt, Shift.

export const isApple = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/** True when the platform's shortcut modifier (⌘ or Ctrl) is down, and only that one of the two. */
export function modKey(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isApple() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
