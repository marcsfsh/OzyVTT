import { useEffect, useRef, useSyncExternalStore } from "react";
import type { CombatLogEntry } from "@vtt/domain";
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

export function CombatLogPanel() {
  const log = useCombatLog();
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => { const element = listRef.current; if (element) element.scrollTop = element.scrollHeight; }, [log.length]);
  return <section className="combat-log" aria-labelledby="combat-log-heading">
    <div className="combat-log-heading"><span className="eyebrow">LOG</span><h2 id="combat-log-heading">Combat log</h2></div>
    {log.length === 0
      ? <p className="combat-log-empty">No combat events yet.</p>
      : <ol className="combat-log-list" ref={listRef} aria-live="polite">
          {log.map((entry) => <li key={entry.id} className={`combat-log-entry log-${entry.kind}`}><span className="combat-log-text">{entry.text}</span></li>)}
        </ol>}
  </section>;
}
