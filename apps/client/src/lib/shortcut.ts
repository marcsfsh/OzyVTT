/** What the device in hand is, as far as a keyboard shortcut cares. */
export type ShortcutDevice = Readonly<{ platform: string; touchOnly: boolean }>;

/**
 * How this device writes a Ctrl or Command shortcut: "⌘K" on a Mac, "Ctrl K" elsewhere, and null on a touch device,
 * which has no keyboard to press it on.
 */
export function shortcutLabel(key: string, device: ShortcutDevice): string | null {
  if (device.touchOnly) return null;
  return /mac/i.test(device.platform) ? `⌘${key}` : `Ctrl ${key}`;
}

/** The browser's answer to `ShortcutDevice`; a touch screen with no fine pointer counts as touch only. */
export function currentDevice(): ShortcutDevice {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const platform =
    (nav as (Navigator & { userAgentData?: { platform?: string } }) | undefined)?.userAgentData?.platform ??
    nav?.platform ??
    "";
  return { platform, touchOnly: touchOnlyScreen() };
}

function touchOnlyScreen(): boolean {
  try {
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  } catch {
    return false;
  }
}
