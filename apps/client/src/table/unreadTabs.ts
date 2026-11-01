import { useEffect, useState } from "react";

const SEEN_KEY = "vtt.table-tab-seen.gm";

type Seen = Readonly<Record<string, number>>;

const readSeen = (): Seen => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Seen) : {};
  } catch {
    return {};
  }
};

/**
 * How many entries arrived on a tab since this device last had it open (C3 spec 2.3): the newest entry id seen is kept
 * per tab on the device, so the count survives a reload, and opening the tab drops it to nothing. With nothing seen yet
 * the entries already there count as seen, so a first visit starts at zero.
 */
export function useUnreadCount(tab: string, open: boolean, ids: readonly number[]): number {
  const newest = ids.length > 0 ? Math.max(...ids) : null;
  const [seen, setSeen] = useState<number | null>(() => readSeen()[tab] ?? null);
  useEffect(() => {
    if (newest === null) return;
    if (seen !== null && !open) return;
    if (seen === newest) return;
    setSeen(newest);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify({ ...readSeen(), [tab]: newest }));
    } catch {
      /* private mode: the count still drops for this visit */
    }
  }, [tab, open, newest, seen]);
  if (open || seen === null) return 0;
  return ids.filter((id) => id > seen).length;
}
