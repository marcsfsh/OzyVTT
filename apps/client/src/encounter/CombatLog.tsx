import { useEffect, useRef, useSyncExternalStore } from "react";
import type { CombatLogEntry } from "@vtt/domain";
import { Drawer } from "@vtt/ui";
import { socket } from "../socket";
import "./combat-log.css";

/**
 * The persistent combat log (#12): a durable, scrollable record of what happened this fight - damage,
 * saves, actions, conditions, turn transitions, encounter/scene changes, and GM history rewinds. Fed
 * by the server's role-filtered `log:entry` broadcast (a player never receives a GM-only line) plus a
 * `log:read` backfill on every (re)connect, so a late joiner or a GM who just logged in sees the story
 * so far. A module store - like the map toasts - so a single subscription survives component remounts.
 */
let entries: readonly CombatLogEntry[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const CAP = 250;

function replace(next: readonly CombatLogEntry[]) { entries = next.slice(-CAP); emit(); }
function push(entry: CombatLogEntry) {
  if (entries.some((existing) => existing.id === entry.id)) return; // ignore a live event already in the backfill
  entries = [...entries, entry].slice(-CAP);
  emit();
}
function load() {
  socket.emit("log:read", {}, (result: { ok: boolean; entries?: readonly CombatLogEntry[] }) => {
    if (result.ok && result.entries) replace(result.entries);
  });
}

socket.on("log:entry", push); // registered once at module load
socket.on("connect", load);   // re-read after a reconnect or a role change (GM login reconnects the socket)
if (socket.connected) load();

function useCombatLog() { return useSyncExternalStore(subscribe, () => entries, () => entries); }

/**
 * THE LIST, AND THE PIN-TO-NEWEST TRAP IT CARRIES.
 *
 * `scrollTop = scrollHeight` is how this log stays on its newest line, and **a hidden element
 * measures 0**, so that write lands on nothing and the log reopens scrolled to the TOP — the wrong
 * end of the thing you opened it to read. `DockAccordion.tsx` documents the same trap and solves it
 * the same way: the list is UNMOUNTED while it is not being read, so the effect re-runs on mount and
 * the pin is computed against a box that has a height. Ruling 6 named this cost when it chose the
 * drawer, because a `Drawer` stays mounted while closed (translated off-screen, `visibility: hidden`,
 * `inert`) — mounting the LIST on open is what pays it.
 */
function CombatLogList() {
  const log = useCombatLog();
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => { const element = listRef.current; if (element) element.scrollTop = element.scrollHeight; }, [log.length]);
  if (log.length === 0) return <p className="combat-log-empty">No combat events yet.</p>;
  return <ol className="combat-log-list scroll-y" ref={listRef} aria-live="polite">
    {log.map((entry) => <li key={entry.id} className={`combat-log-entry log-${entry.kind}`}><span className="combat-log-text">{entry.text}</span></li>)}
  </ol>;
}

/** The panel presentation — its own heading over the list. Used where the log has a column to stand in. */
export function CombatLogPanel() {
  return <section className="combat-log" aria-labelledby="combat-log-heading">
    <div className="combat-log-heading"><span className="eyebrow">LOG</span><h2 id="combat-log-heading">Combat log</h2></div>
    <CombatLogList />
  </section>;
}

/**
 * RULING 6 — the log as a DRAWER FROM THE RIGHT.
 *
 * `Drawer` is non-modal by design (no scrim, no focus trap, no scroll lock), so the table stays live
 * behind it, which is the whole requirement: you read the log while the fight goes on. It takes an
 * edge rather than floating, so it covers the dock instead of the map.
 *
 * **The list is mounted only while open** — see `CombatLogList` above. That is not an optimisation;
 * it is the fix for the named cost this ruling accepted.
 */
export function CombatLogDrawer({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  return <Drawer open={open} onClose={onClose} side="right" title="Combat log" className="combat-log-drawer">
    {open && <CombatLogList />}
  </Drawer>;
}
