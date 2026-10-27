import { useEffect, useRef, useSyncExternalStore } from "react";
import type { CombatLogEntry } from "@vtt/domain";
import { IconButton, IconX, useToast } from "@vtt/ui";
import { command, read } from "../lib/command";
import { socket } from "../socket";
import "./combat-log.css";

/**
 * The persistent combat log: damage, saves, actions, conditions, turns, encounter/scene changes,
 * GM rewinds and the table's chat. Fed by the server's role-filtered `log:entry` broadcast (players never receive GM-only
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

/** A line the server removed (a deleted chat line), by the id this reader holds it under. */
function drop({ id }: Readonly<{ id: number }>) {
  if (!entries.some((existing) => existing.id === id)) return;
  entries = entries.filter((existing) => existing.id !== id);
  emit();
}

socket.on("log:entry", push); // registered once at module load
socket.on("log:removed", drop);
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
 * measures 0, so the list is mounted only while its tab is shown and is re-pinned on mount.
 */
function CombatLogList({ canRemove }: Readonly<{ canRemove?: (entry: CombatLogEntry) => boolean }>) {
  const log = useCombatLog();
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [log.length]);
  if (log.length === 0) return <p className="combat-log-empty">No combat events yet.</p>;
  return (
    <ol className="combat-log-list scroll-y" ref={listRef} aria-live="polite">
      {log.map((entry) =>
        entry.kind === "roll" && entry.roll ? (
          <li key={entry.id} className="combat-log-entry log-roll is-card">
            <RollCard text={entry.text} roll={entry.roll} />
          </li>
        ) : entry.kind === "chat" ? (
          <li key={entry.id} className={`combat-log-entry log-chat${entry.whisper ? " is-whisper" : ""}`}>
            <ChatLine entry={entry} removable={canRemove?.(entry) === true} />
          </li>
        ) : (
          <li key={entry.id} className={`combat-log-entry log-${entry.kind}`}>
            <span className="combat-log-text">{entry.text}</span>
          </li>
        )
      )}
    </ol>
  );
}

/**
 * A roll in the log: who rolled what, the total large in VT323, and the dice with the formula beside it. The line's
 * text stays for screen readers; the card shows the same roll.
 */
function RollCard({ text, roll }: Readonly<{ text: string; roll: NonNullable<CombatLogEntry["roll"]> }>) {
  return (
    <article className="log-roll-card" aria-label={text}>
      <p className="log-roll-who" aria-hidden="true">
        <b>{roll.initiatorLabel ?? "Someone"}</b> {roll.label ?? "rolled"}
      </p>
      <p className="log-roll-readout" aria-hidden="true">
        <span className="log-roll-total">{roll.total}</span>
        <span className="log-roll-dice">
          {roll.dice.map((die, index) => (
            <span key={index} className={die.kept ? undefined : "is-dropped"}>
              {die.face}
            </span>
          ))}
          <span className="log-roll-formula">{roll.formula}</span>
        </span>
      </p>
    </article>
  );
}

/**
 * A chat line (ADR-0038): who said it and what, as text. A whisper says who it is between, in the GM's violet. The
 * author's own line, or any for the GM, has Remove.
 */
function ChatLine({ entry, removable }: Readonly<{ entry: CombatLogEntry; removable: boolean }>) {
  const { toast } = useToast();
  const whisper = entry.whisper
    ? entry.author?.role === "gm"
      ? `Whisper to ${entry.whisper.name}`
      : "Whisper to the GM"
    : null;
  const remove = async () => {
    const result = await command("chat:delete", { entryId: entry.id });
    if (!result.ok) toast(result.message ?? "That line wasn't removed.", { tone: "error" });
  };
  return (
    <p className="log-chat-line">
      {whisper && <span className="log-chat-whisper">{whisper}</span>}
      <b className="log-chat-who">{entry.author?.name ?? "Someone"}</b>
      <span className="log-chat-text">{entry.text}</span>
      {removable && (
        <IconButton label="Remove this line" size="sm" className="log-chat-remove" onClick={() => void remove()}>
          <IconX />
        </IconButton>
      )}
    </p>
  );
}

/** The Log tab: the feed, under a heading the tab's name already shows. `canRemove` says which chat lines this
 *  reader may remove. */
export function CombatLogPanel({ canRemove }: Readonly<{ canRemove?: (entry: CombatLogEntry) => boolean }>) {
  return (
    <section className="combat-log" aria-labelledby="combat-log-heading">
      <h2 id="combat-log-heading" className="nh-sr-only">
        Combat log
      </h2>
      <CombatLogList canRemove={canRemove} />
    </section>
  );
}
