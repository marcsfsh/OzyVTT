import { useEffect, useState, type ReactNode } from "react";

/**
 * THE DOCK, AS AN ACCORDION (B1).
 *
 * The side dock holds three things that each want to be tall — the turn order, the dice, the log —
 * and the column has one height to give. Before this they simply stacked: in combat the tracker took
 * whatever it wanted and the other two hid behind `<details>` summaries; out of combat all three sat
 * end to end and the surface grew past the pane. The blueprint calls for that idiom "made deliberate":
 * every header stays visible, exactly ONE section holds the flex, and clicking a collapsed header
 * hands the flex over.
 *
 * WHY THE COLLAPSED BODIES UNMOUNT. The combat log pins itself to the newest line by setting
 * `scrollTop = scrollHeight` whenever the log grows (CombatLog.tsx). An element that is merely hidden
 * still receives those updates, and a hidden element measures 0, so the write lands on nothing and the
 * log reopens scrolled to the TOP — the wrong end of the thing you reopen it to read. Unmounting means
 * the effect re-runs on mount and the log is where it should be, and it keeps a long fight's DOM small.
 * The cost is real and worth naming: a half-typed custom dice formula does not survive a trip to the
 * log and back. The log being at the wrong end every time is the worse of the two.
 */

export type DockKey = "turn" | "dice" | "log";

const MEMORY_KEY = "vtt.dock-open";

/** In combat the fight leads. Out of combat the GM is staging one and the player is rolling. */
function defaultFor(role: "gm" | "player", inCombat: boolean): DockKey {
  if (inCombat) return "turn";
  return role === "gm" ? "turn" : "dice";
}

export function DockAccordion({ role, inCombat, turnLabel, turn, dice, log }: Readonly<{
  role: "gm" | "player";
  inCombat: boolean;
  /** The first section is the fight in combat and the staging of one out of it, so it is named twice. */
  turnLabel: string;
  turn: ReactNode;
  dice: ReactNode;
  log: ReactNode;
}>) {
  const [open, setOpen] = useState<DockKey>(() => {
    const stored = localStorage.getItem(MEMORY_KEY);
    return stored === "turn" || stored === "dice" || stored === "log" ? stored : defaultFor(role, inCombat);
  });
  /**
   * A fight starting or ending changes which panel the table is ABOUT, so the default is recomputed
   * at that moment and a stale choice does not strand you on the dice while initiative is rolling.
   * Between those moments the last thing you picked stands — including across a reload, which is what
   * the memory is for. It is deliberately localStorage and nothing else: a dock preference is this
   * device's, and the scope rules forbid this lane persisting UI state on the server.
   */
  useEffect(() => { setOpen(defaultFor(role, inCombat)); }, [role, inCombat]);

  const choose = (key: DockKey) => {
    setOpen(key);
    try { localStorage.setItem(MEMORY_KEY, key); } catch { /* private mode: the session still works, it just will not remember */ }
  };

  const sections: ReadonlyArray<{ key: DockKey; label: string; body: ReactNode }> = [
    { key: "turn", label: turnLabel, body: turn },
    { key: "dice", label: "Dice", body: dice },
    { key: "log", label: "Combat log", body: log },
  ];

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
            <span className="dock-section-label">{section.label}</span>
          </button>
        </h2>
        {isOpen && <div id={`dock-body-${section.key}`} className="dock-section-body scroll-y">{section.body}</div>}
      </section>;
    })}
  </div>;
}
