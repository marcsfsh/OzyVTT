import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CombatLogEntry } from "@vtt/domain";
import {
  Button,
  GmOnlyTag,
  IconButton,
  IconX,
  Tag,
  burst,
  canMove,
  comet,
  fadeIn,
  useOnChange,
  useToast
} from "@vtt/ui";
import { natural } from "../dice/rollLight";
import { command, read } from "../lib/command";
import { socket } from "../socket";
import { announceLogEntry, chatSentRecently } from "./logArrivals";
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
  announceLogEntry(entry);
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

/** The log's lines as this reader holds them, oldest first; the GM's Log tab counts the ones it has not seen. */
export function useCombatLog() {
  return useSyncExternalStore(
    subscribe,
    () => entries,
    () => entries
  );
}

/** How close to the foot still counts as at it: a line's height, so a reader one line up still follows. */
const FOOT_SLACK_PX = 34;

/**
 * The log, one line each (log spec 2.1). It follows new lines only while the reader is at its foot; scrolled up, it
 * holds still and a line at the foot says how many new lines wait (rule 3.5). A hidden element measures 0, so the list
 * is mounted only while its tab is shown and is pinned to the foot on mount. One roll line is open to its card at a
 * time.
 */
function CombatLogList({ canRemove }: Readonly<{ canRemove?: (entry: CombatLogEntry) => boolean }>) {
  const log = useCombatLog();
  const listRef = useRef<HTMLOListElement>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const atFoot = useRef(true);
  const [waiting, setWaiting] = useState(0);
  const seenLength = useRef(log.length);
  const toFoot = () => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    atFoot.current = true;
    setWaiting(0);
  };
  useEffect(() => {
    const added = log.length - seenLength.current;
    seenLength.current = log.length;
    if (atFoot.current) {
      const element = listRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    } else if (added > 0) setWaiting((count) => count + added);
  }, [log.length]);
  const onScroll = () => {
    const element = listRef.current;
    if (!element) return;
    atFoot.current = element.scrollHeight - element.scrollTop - element.clientHeight <= FOOT_SLACK_PX;
    if (atFoot.current) setWaiting(0);
  };
  // A new line fades in with a comet along its lower edge; a chat line this device just sent lights from the right,
  // where the Send button is (ADR-0045).
  const newest = log.at(-1);
  useOnChange(newest?.id ?? null, (_was, id) => {
    const line = listRef.current?.lastElementChild;
    if (id === null || !(line instanceof HTMLElement) || !canMove()) return;
    fadeIn(line, { dur: 180, y: 6 });
    const mine = newest?.kind === "chat" && chatSentRecently();
    const width = line.clientWidth;
    const [from, to] = mine ? [width, 0] : [0, width];
    comet(line, { from, to, line: line.clientHeight - 1, thick: 2, delay: 40, dur: 260 });
    burst(line, { at: to, line: line.clientHeight - 1, delay: 280, w: 60, h: 6 });
  });
  if (log.length === 0) return <p className="combat-log-empty">No combat events yet.</p>;
  // The turn now running is the last turn line; it reads in amber.
  const lastTurn = [...log].reverse().find((entry) => entry.kind === "turn")?.id ?? null;
  return (
    <div className="combat-log-frame">
      <ol className="combat-log-list scroll-y" ref={listRef} aria-live="polite" onScroll={onScroll}>
        {log.map((entry) =>
          entry.kind === "roll" && entry.roll ? (
            <RollLine
              key={entry.id}
              entry={entry}
              roll={entry.roll}
              open={openId === entry.id}
              onToggle={() => setOpenId((current) => (current === entry.id ? null : entry.id))}
            />
          ) : entry.kind === "chat" ? (
            <li key={entry.id} className={`combat-log-entry log-chat${entry.whisper ? " is-whisper" : ""}`}>
              <ChatLine entry={entry} removable={canRemove?.(entry) === true} />
            </li>
          ) : (
            <li
              key={entry.id}
              className={`combat-log-entry log-${entry.kind}${entry.id === lastTurn ? " is-now" : ""}`}
            >
              {entry.gmOnly && <GmOnlyTag />}
              <span className="combat-log-text">
                <MarkedText entry={entry} />
              </span>
            </li>
          )
        )}
      </ol>
      {waiting > 0 && (
        <Button size="sm" className="combat-log-waiting" onClick={toFoot}>
          {waiting} new {waiting === 1 ? "line" : "lines"}
        </Button>
      )}
    </div>
  );
}

/** The number of hit points a damage or healing line names, after its verb ("takes 7", "regains 5"). */
const AMOUNT = /\b(takes|loses|regains|heals|restores)( )(\d+)/;

/** A line of the server's words, as written, with a number of damage in red and healing in gold (rule 3.4). */
function MarkedText({ entry }: Readonly<{ entry: CombatLogEntry }>) {
  const marked = entry.kind === "damage" || entry.kind === "heal" ? AMOUNT.exec(entry.text) : null;
  if (!marked) return <>{entry.text}</>;
  const start = marked.index + marked[1].length + 1;
  const end = start + marked[3].length;
  return (
    <>
      {entry.text.slice(0, start)}
      <span className={entry.kind === "damage" ? "log-amount is-damage" : "log-amount is-heal"}>
        {entry.text.slice(start, end)}
      </span>
      {entry.text.slice(end)}
    </>
  );
}

/** A roll's tags: GM ONLY or hidden from players, a whisper, and a natural 20 or 1 (rules 3.2, 3.3). */
function RollTags({ entry, roll }: Readonly<{ entry: CombatLogEntry; roll: NonNullable<CombatLogEntry["roll"]> }>) {
  const nat = natural(roll.dice);
  return (
    <>
      {entry.gmOnly && !entry.private && <GmOnlyTag />}
      {entry.private && <Tag tone="hidden">Hidden from players</Tag>}
      {nat && (
        <Tag tone={nat === "NAT 20" ? "next" : "error"} className={nat === "NAT 20" ? "log-nat is-20" : "log-nat is-1"}>
          {nat}
        </Tag>
      )}
    </>
  );
}

/**
 * A roll as one line: its tags, who and what, and the total at the right. Pressing it opens its card under it, and
 * pressing it again closes it. Its name stays the server's words.
 */
function RollLine({
  entry,
  roll,
  open,
  onToggle
}: Readonly<{
  entry: CombatLogEntry;
  roll: NonNullable<CombatLogEntry["roll"]>;
  open: boolean;
  onToggle: () => void;
}>) {
  return (
    <li className={`combat-log-entry log-roll${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="log-roll-line interactive"
        aria-expanded={open}
        aria-label={entry.text}
        onClick={onToggle}
      >
        <span className="log-roll-tags" aria-hidden="true">
          <RollTags entry={entry} roll={roll} />
        </span>
        <span className="log-roll-what" aria-hidden="true">
          <b>{roll.initiatorLabel ?? "Someone"}</b> {roll.label ?? "rolled"}
        </span>
        <span className="log-roll-sum" aria-hidden="true">
          {roll.total}
        </span>
      </button>
      {open && <RollCard text={entry.text} roll={roll} />}
    </li>
  );
}

/**
 * A roll opened to its card: who rolled what, the total large in VT323, each die in its box (the kept one edged cyan,
 * a dropped one struck through) and the formula. The line's text stays for screen readers.
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
            <span key={index} className={die.kept ? "is-kept" : "is-dropped"}>
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
      {entry.gmOnly && !entry.whisper && <GmOnlyTag />}
      {whisper && (
        <Tag tone="hidden" className="log-chat-whisper">
          {whisper}
        </Tag>
      )}
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
