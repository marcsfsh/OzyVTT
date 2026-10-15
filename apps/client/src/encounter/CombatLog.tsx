import { useEffect, useRef, useSyncExternalStore } from "react";
import type { CombatLogEntry } from "@vtt/domain";
import { Drawer } from "@vtt/ui";
import { read } from "../lib/command";
import { socket } from "../socket";
import "./combat-log.css";

/**
 * The persistent combat log: damage, saves, actions, conditions, turns, encounter/scene changes and
 * GM rewinds. Fed by the server's role-filtered `log:entry` broadcast (players never receive GM-only
 * lines) plus a `log:read` backfill on every (re)connect. A module store, so one subscription
 * survives remounts.
 */
let entries: readonly CombatLogEntry[] = [];
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const CAP = 250;

function replace(next: readonly CombatLogEntry[]) {
  entries = next.slice(-CAP);
  emit();
}
function push(entry: CombatLogEntry) {
  if (entries.some((existing) => existing.id === entry.id)) return; // ignore a live event already in the backfill
  entries = [...entries, entry].slice(-CAP);
  emit();
}
function load() {
  void read("log:read", {}).then((result) => {
    if (result.ok && result.entries) replace(result.entries);
  });
}

socket.on("log:entry", push); // registered once at module load
socket.on("connect", load); // re-read after a reconnect or a role change (GM login reconnects the socket)
if (socket.connected) load();

function useCombatLog() {
  return useSyncExternalStore(
    subscribe,
    () => entries,
    () => entries
  );
}

/**
 * The list pins itself to the newest line with `scrollTop = scrollHeight`, and a hidden element
 * measures 0, so the list must be unmounted while closed and re-pinned on mount (a `Drawer` stays
 * mounted while closed). `DockAccordion.tsx` handles the same trap the same way.
 */
function CombatLogList() {
  const log = useCombatLog();
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [log.length]);
  if (log.length === 0) return <p className="combat-log-empty">No combat events yet.</p>;
  return (
    <ol className="combat-log-list scroll-y" ref={listRef} aria-live="polite">
      {log.map((entry) => (
        <li key={entry.id} className={`combat-log-entry log-${entry.kind}`}>
          <span className="combat-log-text">{entry.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** The panel presentation: its own heading over the list, where the log has a column. */
export function CombatLogPanel() {
  return (
    <section className="combat-log" aria-labelledby="combat-log-heading">
      <div className="combat-log-heading">
        <span className="eyebrow">LOG</span>
        <h2 id="combat-log-heading">Combat log</h2>
      </div>
      <CombatLogList />
    </section>
  );
}

/**
 * The log as a non-modal drawer from the right (no scrim, focus trap or scroll lock), so the table
 * stays live behind it. The list mounts only while open; see `CombatLogList`.
 */
export function CombatLogDrawer({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  return (
    <Drawer open={open} onClose={onClose} side="right" title="Combat log" className="combat-log-drawer">
      {open && <CombatLogList />}
    </Drawer>
  );
}
