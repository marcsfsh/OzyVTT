import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { Tabs } from "@vtt/ui";
import { socket } from "../socket";

/**
 * THE DOCK — AN ACCORDION ON A LAPTOP (B1), A TABBED SHEET ON A PHONE (C1/B2).
 *
 * The dock holds three things that each want to be tall — the turn order, the dice, the log — and one
 * height to give. Above the 980 rung that is a column, so the answer is an accordion: every header
 * stays visible, exactly ONE section holds the flex, and clicking a collapsed header hands the flex
 * over. Below the rung the column is gone: the map is a fixed band and the dock is the sheet beneath
 * it (design-language.md:401 — "three stacked panels cannot share 844px with a map"). Three stacked
 * headers would spend three rows of a sheet that has about 445px in total, so the same three choices
 * become one tab bar and one body.
 *
 * ONE STATE, TWO TREES. The open section and the tab are the same `open`, the same
 * `localStorage["vtt.dock-open"]`, and the same `defaultFor` recompute — resizing across the rung
 * lands you on the panel you were already reading, and a phone that rotates does not reset the dock.
 *
 * **TWO SECTIONS SINCE RULING 6, NOT THREE — IN BOTH TREES.** The combat log left the dock and became
 * a drawer from the right, so what stays here is the fight and the dice. The log's DOOR stays where
 * its section was, because that is where a GM's hand already goes looking for it; it opens the drawer
 * rather than expanding, which is why it is a plain button and not a third `aria-expanded` header.
 *
 * WHY THE INACTIVE BODIES UNMOUNT — in BOTH trees. The combat log pins itself to the newest line by
 * setting `scrollTop = scrollHeight` whenever the log grows (CombatLog.tsx). An element that is merely
 * hidden still receives those updates, and a hidden element measures 0, so the write lands on nothing
 * and the log reopens scrolled to the TOP — the wrong end of the thing you reopen it to read.
 * Unmounting means the effect re-runs on mount and the log is where it should be, and it keeps a long
 * fight's DOM small. The replay viewer's phone tabs (replay/replay.css) use `display: none` for the
 * same shape; that half is deliberately NOT copied here. The cost is real and worth naming: a
 * half-typed custom dice formula does not survive a trip to the dice tab and back. Being at the wrong
 * end every time is the worse of the two — and the drawer inherits exactly this reasoning, which is
 * the named cost ruling 6 accepted when it took the drawer.
 */

export type DockKey = "turn" | "dice";

const MEMORY_KEY = "vtt.dock-open";
/** The rung at which the sidebar stops being a column. Paired with the `max-width: 979px` block in styles.css. */
const SHEET_QUERY = "(max-width: 979px)";

/** In combat the fight leads. Out of combat the GM is staging one and the player is rolling. */
function defaultFor(role: "gm" | "player", inCombat: boolean): DockKey {
  if (inCombat) return "turn";
  return role === "gm" ? "turn" : "dice";
}

/** The JS/CSS breakpoint pairing, as `scene/MapToolbar.tsx` does it — one query string, both halves. */
function useSheet(): boolean {
  const [sheet, setSheet] = useState(() => typeof window !== "undefined" && (window.matchMedia?.(SHEET_QUERY).matches ?? false));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(SHEET_QUERY);
    const onChange = () => setSheet(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return sheet;
}

/**
 * THE WAITING-QUESTION COUNT, read at the dock rather than handed to it.
 *
 * A rules-assistant question the GM has not answered was invisible from anywhere but the Turn panel —
 * driven with two live sessions and written up in `docs/ai-ledger/known-bugs.md`: with the player on
 * Dice, the pinned `MyPendingAsks` row is not in the DOM at all (0 nodes measured), because the
 * inactive body is unmounted on purpose. The header is the only thing still on screen, so the header
 * is where the count belongs — not a fourth surface, and not a toast that a Deny never sends.
 *
 * It is read from `state:updated` here rather than passed down for one structural reason: everything
 * that HAS the count lives inside a body that may be unmounted. The count has to survive exactly the
 * unmount that hid it. A module store subscribed once at import is the same idiom `CombatLog.tsx`
 * already uses in this directory, and it survives this component's own remounts across the rung.
 */
let waiting = 0;
const waitingListeners = new Set<() => void>();
function setWaiting(next: number) {
  if (next === waiting) return;
  waiting = next;
  for (const listener of waitingListeners) listener();
}
socket.on("state:updated", (next: GmView | PlayerView) => setWaiting(next.combat.pendingRuleAsks?.length ?? 0));
socket.on("disconnect", () => setWaiting(0));
function subscribeWaiting(listener: () => void) {
  waitingListeners.add(listener);
  return () => { waitingListeners.delete(listener); };
}
function useWaitingAsks(): number {
  return useSyncExternalStore(subscribeWaiting, () => waiting, () => waiting);
}

/** The count rides the section/tab label. The word is in the label so a screen reader hears what the number is. */
function WaitingBadge({ count }: Readonly<{ count: number }>) {
  if (count <= 0) return null;
  return <span className="dock-waiting-count">
    {count}<span className="nh-sr-only"> {count === 1 ? "question waiting on the GM" : "questions waiting on the GM"}</span>
  </span>;
}

export function DockAccordion({ role, inCombat, turnLabel, turn, dice, onOpenLog }: Readonly<{
  role: "gm" | "player";
  inCombat: boolean;
  /** The first section is the fight in combat and the staging of one out of it, so it is named twice. */
  turnLabel: string;
  turn: ReactNode;
  dice: ReactNode;
  /** Ruling 6: the log is a drawer now. The dock keeps its door, not its section. */
  onOpenLog: () => void;
}>) {
  const [open, setOpen] = useState<DockKey>(() => {
    const stored = localStorage.getItem(MEMORY_KEY);
    // A dock that remembered "log" is a dock from before ruling 6; it falls through to the default.
    return stored === "turn" || stored === "dice" ? stored : defaultFor(role, inCombat);
  });
  /**
   * A fight starting or ending changes which panel the table is ABOUT, so the default is recomputed
   * at that moment and a stale choice does not strand you on the dice while initiative is rolling.
   * Between those moments the last thing you picked stands — including across a reload, which is what
   * the memory is for. It is deliberately localStorage and nothing else: a dock preference is this
   * device's, and the scope rules forbid this lane persisting UI state on the server.
   */
  useEffect(() => { setOpen(defaultFor(role, inCombat)); }, [role, inCombat]);

  const sheet = useSheet();
  const waitingAsks = useWaitingAsks();

  const choose = (key: DockKey) => {
    setOpen(key);
    try { localStorage.setItem(MEMORY_KEY, key); } catch { /* private mode: the session still works, it just will not remember */ }
  };

  const sections: ReadonlyArray<{ key: DockKey; label: string; body: ReactNode }> = [
    { key: "turn", label: turnLabel, body: turn },
    { key: "dice", label: "Dice", body: dice },
  ];

  if (sheet) {
    const active = sections.find((section) => section.key === open) ?? sections[0];
    return <div className="dock-tabs">
      <div className="dock-tabs-head">
      {/* `Tabs`, not `SegmentedControl`: these switch whole panels (the primitive's own docblocks
          draw that line), and `Tabs` meets the 44px floor with real paint. A segmented control paints
          36px and reaches the floor with `.tap-target`'s centred `::after`, which would extend ~4px UP
          into the bottom edge of the map band — a `touch-action: none` drag surface. An invisible
          strip that eats map drags is a real bug on the one surface where dragging matters most. */}
      <Tabs
        className="dock-tabs-bar"
        ariaLabel="The table"
        activeId={active.key}
        onChange={(id) => choose(id as DockKey)}
        tabs={sections.map((section) => ({
          id: section.key,
          label: <>{section.label}{section.key === "turn" && <WaitingBadge count={waitingAsks} />}</>
        }))}
      />
      {/* The log's door, beside the two tabs rather than as a third one: it opens a drawer, and a
          tab that does not switch the body underneath it would be a lie about what it does. */}
      <button type="button" className="dock-log-door tap-target interactive" onClick={onOpenLog}>Log</button>
      </div>
      {/* One body, mounted for the active tab only (see the unmount contract above). The scroll is
          declared in the MARKUP — check (h) reads `.scroll-y`, and a bare `overflow-y` in the
          stylesheet would be a region no reader of this component can see. */}
      <div key={active.key} role="tabpanel" aria-label={active.label} className="dock-tabs-body scroll-y">{active.body}</div>
    </div>;
  }

  return <div className="dock-accordion">
    {sections.map((section) => {
      const isOpen = open === section.key;
      return <section key={section.key} className={`dock-section${isOpen ? " is-open" : ""}`}>
        {/* The header is the control — a real button filling the row, so the whole header is the hit
            area rather than the words inside it, and it carries the expanded state for a screen reader
            the same way a disclosure does. */}
        <h2 className="dock-section-head">
          <button type="button" className="dock-section-toggle tap-target" aria-expanded={isOpen}
            aria-controls={`dock-body-${section.key}`} onClick={() => choose(section.key)}>
            <span className="dock-section-label">{section.label}{section.key === "turn" && <WaitingBadge count={waitingAsks} />}</span>
          </button>
        </h2>
        {isOpen && <div id={`dock-body-${section.key}`} className="dock-section-body scroll-y">{section.body}</div>}
      </section>;
    })}
    {/* The log's door where its section used to be. It wears the header's paint so the column still
        reads as one instrument, and it carries no `aria-expanded`, because nothing expands. */}
    <section className="dock-section dock-section--door">
      <h2 className="dock-section-head">
        <button type="button" className="dock-section-toggle tap-target" onClick={onOpenLog}>
          <span className="dock-section-label">Combat log</span>
        </button>
      </h2>
    </section>
  </div>;
}
