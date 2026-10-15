import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { Tabs } from "@vtt/ui";
import { useMediaQuery } from "../lib/useMediaQuery";
import { socket } from "../socket";
import "./dock.css";

/**
 * The dock: an accordion on a laptop, a tabbed sheet on a phone. It holds the turn order and the
 * dice. At 980px and up it is a column where exactly one section takes the flex; below that the map
 * is a fixed band and the dock is the sheet beneath it, so the sections become one tab bar and body.
 * Both trees share one `open` state, remembered in `localStorage["vtt.dock-open"]`, so crossing the
 * breakpoint or rotating a phone keeps your panel.
 *
 * The combat log is a drawer; its door stays where its section would be, as a plain button.
 *
 * Inactive bodies unmount in both trees. This keeps a long fight's DOM small and matches the log's
 * pin-to-newest requirement (see CombatLog.tsx). Cost: a half-typed custom dice formula does not
 * survive switching tabs.
 */

export type DockKey = "turn" | "dice";

const MEMORY_KEY = "vtt.dock-open";
/** Where the sidebar stops being a column. Paired with the `max-width: 979px` block in shell/table-view.css. */
const SHEET_QUERY = "(max-width: 979px)";

/** In combat the fight leads. Out of combat the GM is staging one and the player is rolling. */
function defaultFor(role: "gm" | "player", inCombat: boolean): DockKey {
  if (inCombat) return "turn";
  return role === "gm" ? "turn" : "dice";
}

/**
 * The count of rules-assistant questions waiting on the GM, read here from `state:updated` rather
 * than passed down: everything that has the count lives in a body that may be unmounted, and the
 * header is the only thing still on screen. A module store subscribed once at import, like
 * `CombatLog.tsx`.
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
  return () => {
    waitingListeners.delete(listener);
  };
}
function useWaitingAsks(): number {
  return useSyncExternalStore(
    subscribeWaiting,
    () => waiting,
    () => waiting
  );
}

/** The count rides the section/tab label, with a word so a screen reader hears what it counts. */
function WaitingBadge({ count }: Readonly<{ count: number }>) {
  if (count <= 0) return null;
  return (
    <span className="dock-waiting-count">
      {count}
      <span className="nh-sr-only"> {count === 1 ? "question waiting on the GM" : "questions waiting on the GM"}</span>
    </span>
  );
}

export function DockAccordion({
  role,
  inCombat,
  turnLabel,
  turn,
  dice,
  onOpenLog
}: Readonly<{
  role: "gm" | "player";
  inCombat: boolean;
  /** Named per combat state: the fight in combat, staging one out of it. */
  turnLabel: string;
  turn: ReactNode;
  dice: ReactNode;
  /** The log is a drawer; the dock keeps only its door. */
  onOpenLog: () => void;
}>) {
  const [open, setOpen] = useState<DockKey>(() => {
    const stored = localStorage.getItem(MEMORY_KEY);
    // A remembered "log" (from before the log became a drawer) falls through to the default.
    return stored === "turn" || stored === "dice" ? stored : defaultFor(role, inCombat);
  });
  /**
   * A fight starting or ending changes what the table is about, so the default is recomputed then.
   * Otherwise the last choice stands, across reloads too. Stored in localStorage only: a dock
   * preference belongs to this device.
   */
  useEffect(() => {
    setOpen(defaultFor(role, inCombat));
  }, [role, inCombat]);

  const sheet = useMediaQuery(SHEET_QUERY);
  const waitingAsks = useWaitingAsks();

  const choose = (key: DockKey) => {
    setOpen(key);
    try {
      localStorage.setItem(MEMORY_KEY, key);
    } catch {
      /* private mode: the session still works, it just will not remember */
    }
  };

  const sections: ReadonlyArray<{ key: DockKey; label: string; body: ReactNode }> = [
    { key: "turn", label: turnLabel, body: turn },
    { key: "dice", label: "Dice", body: dice }
  ];

  if (sheet) {
    const active = sections.find((section) => section.key === open) ?? sections[0];
    return (
      <div className="dock-tabs">
        <div className="dock-tabs-head">
          {/* `Tabs`, not `SegmentedControl`: these switch whole panels, and `Tabs` meets the 44px floor
          with real paint. A segmented control reaches it through `.tap-target`'s `::after`, which would
          extend ~4px up into the map band's `touch-action: none` drag surface and eat map drags. */}
          <Tabs
            className="dock-tabs-bar"
            ariaLabel="The table"
            activeId={active.key}
            onChange={(id) => choose(id as DockKey)}
            tabs={sections.map((section) => ({
              id: section.key,
              label: (
                <>
                  {section.label}
                  {section.key === "turn" && <WaitingBadge count={waitingAsks} />}
                </>
              )
            }))}
          />
          {/* The log's door sits beside the tabs, not as a third tab: it opens a drawer rather than
          switching the body. */}
          <button type="button" className="dock-log-door tap-target interactive" onClick={onOpenLog}>
            Log
          </button>
        </div>
        {/* One body, mounted for the active tab only. The scroll is declared in the markup (`.scroll-y`). */}
        <div key={active.key} role="tabpanel" aria-label={active.label} className="dock-tabs-body scroll-y">
          {active.body}
        </div>
      </div>
    );
  }

  return (
    <div className="dock-accordion">
      {sections.map((section) => {
        const isOpen = open === section.key;
        return (
          <section key={section.key} className={`dock-section${isOpen ? " is-open" : ""}`}>
            {/* The whole header is a button, so the full row is the hit area and it carries `aria-expanded`. */}
            <h2 className="dock-section-head">
              <button
                type="button"
                className="dock-section-toggle tap-target"
                aria-expanded={isOpen}
                aria-controls={`dock-body-${section.key}`}
                onClick={() => choose(section.key)}
              >
                <span className="dock-section-label">
                  {section.label}
                  {section.key === "turn" && <WaitingBadge count={waitingAsks} />}
                </span>
              </button>
            </h2>
            {isOpen && (
              <div id={`dock-body-${section.key}`} className="dock-section-body scroll-y">
                {section.body}
              </div>
            )}
          </section>
        );
      })}
      {/* The log's door, styled like a section header; no `aria-expanded`, since nothing expands. */}
      <section className="dock-section dock-section--door">
        <h2 className="dock-section-head">
          <button type="button" className="dock-section-toggle tap-target" onClick={onOpenLog}>
            <span className="dock-section-label">Combat log</span>
          </button>
        </h2>
      </section>
    </div>
  );
}
