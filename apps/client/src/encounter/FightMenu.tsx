import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rosterActors, type GmActor, type GmView, type MutationResult } from "@vtt/domain";
import { Select, Switch } from "@vtt/ui";
import { command } from "../lib/command";
import { HealthAudienceOptions, HealthStyleOptions, healthStylePhrase, type HealthStyle } from "./health-display";
import "./fight-menu.css";
import {
  BADGE_AUDIENCE_REASON,
  DIAL_COPY,
  dialLabel,
  dialLine,
  HEALTH_AUDIENCE_LABEL,
  HEALTH_DISPLAY_LABEL,
  optionLabel,
  PLAYER_HITS,
  PLAYER_INITIATIVE
} from "../settings/table-words";

/* The ⋯ fight menu's geometry: margin from viewport edges, gap from the trigger, and box width. */
const MENU_MARGIN = 8;
const MENU_GAP = 6;
const MENU_WIDTH = 24 * 16;
/**
 * The minimum room for the menu to open on a side: one rules-mode control (68px), the End button
 * (39px) and the box's padding (22px), plus the top of the next row.
 */
const MENU_FLOOR = 160;

export const menuWidthFor = (viewportWidth: number) => Math.min(MENU_WIDTH, viewportWidth - MENU_MARGIN * 2);

export type FightMenuPlacement = Readonly<{
  top: number | "auto";
  bottom: number | "auto";
  left: number;
  width: number;
  maxHeight: number;
}>;

/**
 * Where the ⋯ fight menu goes; pure so `fight-menu-placement.test.tsx` can test it.
 *
 * Flips like `packages/ui/src/primitives/Menu.tsx` (`height > roomBelow && roomAbove > roomBelow`),
 * so it only flips when needed and otherwise takes the roomier side. When neither side is useful
 * it is pinned to the margin with the viewport column to scroll in, as in
 * `scene/TokenContextMenu.tsx`. The cap is always real room, never `max(0, …)`, which once left a
 * landscape phone with a 0px menu and no way to end the fight. No ancestor walk: the menu is
 * `position: fixed` in a portal, so only the viewport bounds it.
 *
 * Opening upward anchors by `bottom`, so content changes grow the box away from the trigger.
 */
export function placeFightMenu(
  trigger: Readonly<{ top: number; bottom: number; right: number }>,
  naturalHeight: number,
  viewport: Readonly<{ width: number; height: number }>
): FightMenuPlacement {
  const width = menuWidthFor(viewport.width);
  const left = Math.max(MENU_MARGIN, Math.min(trigger.right - width, viewport.width - width - MENU_MARGIN));
  const roomBelow = viewport.height - trigger.bottom - MENU_GAP - MENU_MARGIN;
  const roomAbove = trigger.top - MENU_GAP - MENU_MARGIN;
  const up = naturalHeight > roomBelow && roomAbove > roomBelow;
  const room = up ? roomAbove : roomBelow;
  if (room < MENU_FLOOR)
    return { top: MENU_MARGIN, bottom: "auto", left, width, maxHeight: Math.max(0, viewport.height - MENU_MARGIN * 2) };
  return up
    ? { top: "auto", bottom: viewport.height - trigger.top + MENU_GAP, left, width, maxHeight: room }
    : { top: trigger.bottom + MENU_GAP, bottom: "auto", left, width, maxHeight: room };
}

/** How many monsters the menu's `Recent` disclosure offers; matches scene prep (`ScenePrepPanel.tsx`). */
const RECENT_COUNT = 10;

/**
 * The ⋯ fight menu: the table's rules settings, the health display, the environment, adding
 * someone to the fight and ending it. Rich content keeps it a bespoke popover rather than a Menu.
 */
export function FightMenu({
  state,
  busy,
  run,
  onFeedback,
  onAddMonsters,
  onEnd
}: Readonly<{
  state: GmView;
  busy: boolean;
  /** Runs a command with the panel's busy flag and reports `success` on the panel's feedback line. */
  run: (operation: () => Promise<MutationResult>, success: string) => Promise<void>;
  onFeedback: (text: string) => void;
  onAddMonsters: () => void;
  onEnd: () => void;
}>) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the ⋯ popover on Escape (outside clicks hit the backdrop). Rich content keeps it a bespoke
  // popover rather than a Menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  // Anchor the ⋯ menu to its button (see `placeFightMenu`), portaled out to clear the dock stacking.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /* The scroller is the body, not the menu: every scroll offset read and write goes here. */
  const menuBodyRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<FightMenuPlacement | null>(null);
  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const button = menuButtonRef.current,
        menu = menuRef.current;
      if (!button || !menu) return;
      // Measure the natural height with the cap off, so a menu that gained room gets it back; the width
      // is applied too, since wrapping depends on it. Uncapping zeroes the body's `scrollTop`, so it is
      // restored, or every scroll would snap back to the top.
      const cappedHeight = menu.style.maxHeight,
        cappedWidth = menu.style.width,
        scrolled = menuBodyRef.current?.scrollTop ?? 0;
      menu.style.maxHeight = "none";
      menu.style.width = `${menuWidthFor(window.innerWidth)}px`;
      const natural = menu.offsetHeight;
      menu.style.maxHeight = cappedHeight;
      menu.style.width = cappedWidth;
      if (menuBodyRef.current) menuBodyRef.current.scrollTop = scrolled;
      setMenuPos(
        placeFightMenu(button.getBoundingClientRect(), natural, {
          width: window.innerWidth,
          height: window.innerHeight
        })
      );
    };
    // Capture phase: the scroll that moves the trigger belongs to an ancestor scroller. The menu's own
    // scrolls never move the trigger, so they are ignored.
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) place();
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menuOpen]);
  return (
    <>
      {/* An explicit label, since a screen reader would otherwise read `⋯`. */}
      <button
        type="button"
        ref={menuButtonRef}
        className="encounter-menu-toggle"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Fight options"
        title="Fight options · rules assistant, environment, roster, end"
        onClick={() => setMenuOpen((current) => !current)}
      >
        ⋯
      </button>
      {menuOpen &&
        createPortal(
          <>
            <div className="encounter-menu-backdrop" onPointerDown={() => setMenuOpen(false)} />
            <div
              ref={menuRef}
              className="encounter-menu anim-dialog"
              role="menu"
              aria-label="Fight options"
              style={
                menuPos
                  ? {
                      top: menuPos.top,
                      bottom: menuPos.bottom,
                      left: menuPos.left,
                      width: menuPos.width,
                      maxHeight: menuPos.maxHeight
                    }
                  : { visibility: "hidden" }
              }
            >
              {/* The frame does not scroll; this body does. `.encounter-menu::before` (plate and edge)
              is `inset: -1px`, so if the menu itself scrolled the plate would scroll away with the
              content. `role="none"` keeps the wrapper out of the menu's accessibility tree. */}
              <div ref={menuBodyRef} className="encounter-menu-body scroll-y" role="none">
                <label className="rules-mode-control">
                  Rules assistant
                  <Select
                    value={state.combat.rulesMode}
                    disabled={busy}
                    onChange={(event) => {
                      const mode = event.target.value as "strict" | "assisted" | "freeform";
                      void command("encounter:set-rules-mode", { mode }).then((result) =>
                        onFeedback(
                          result.ok
                            ? `Rules assistant: ${dialLabel(mode)}.`
                            : (result.message ?? "The rules assistant could not be changed.")
                        )
                      );
                    }}
                  >
                    {DIAL_COPY.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {dialLine(entry)}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="rules-mode-control">
                  {PLAYER_HITS.label}
                  <Select
                    value={state.combat.playerDamageMode}
                    disabled={busy}
                    onChange={(event) => {
                      const mode = event.target.value as "proposal" | "direct";
                      void command("encounter:set-player-damage-mode", { mode }).then((result) =>
                        onFeedback(
                          result.ok
                            ? `${PLAYER_HITS.label}: ${optionLabel(PLAYER_HITS, mode)}.`
                            : (result.message ?? "The player damage mode could not be changed.")
                        )
                      );
                    }}
                  >
                    {PLAYER_HITS.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="rules-mode-control">
                  {PLAYER_INITIATIVE.label}
                  <Select
                    value={state.combat.playerInitiativeMode}
                    disabled={busy}
                    onChange={(event) => {
                      const mode = event.target.value as "immediate" | "wait";
                      void command("encounter:set-player-initiative-mode", { mode }).then((result) =>
                        onFeedback(
                          result.ok
                            ? `${PLAYER_INITIATIVE.label}: ${optionLabel(PLAYER_INITIATIVE, mode)}.`
                            : (result.message ?? "The player initiative mode could not be changed.")
                        )
                      );
                    }}
                  >
                    {PLAYER_INITIATIVE.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="rules-mode-control">
                  {HEALTH_DISPLAY_LABEL}
                  <Select
                    value={state.combat.healthDisplay.style}
                    disabled={busy}
                    onChange={(event) => {
                      const style = event.target.value as HealthStyle;
                      void command("encounter:set-health-display", {
                        style,
                        audience: state.combat.healthDisplay.audience
                      }).then((result) =>
                        onFeedback(
                          result.ok
                            ? `Health shows as ${healthStylePhrase(style)}.`
                            : (result.message ?? "The health display could not be changed.")
                        )
                      );
                    }}
                  >
                    <HealthStyleOptions />
                  </Select>
                </label>
                <label className="rules-mode-control">
                  {HEALTH_AUDIENCE_LABEL}
                  <Select
                    value={state.combat.healthDisplay.audience}
                    disabled={busy || state.combat.healthDisplay.style === "band"}
                    onChange={(event) => {
                      const audience = event.target.value as "gm" | "all";
                      void command("encounter:set-health-display", {
                        style: state.combat.healthDisplay.style,
                        audience
                      }).then((result) =>
                        onFeedback(
                          result.ok
                            ? `Health is ${audience === "all" ? "shown to players" : "GM only"}.`
                            : (result.message ?? "The health display could not be changed.")
                        )
                      );
                    }}
                  >
                    <HealthAudienceOptions />
                  </Select>
                </label>
                {state.combat.healthDisplay.style === "band" && <p className="menu-note">{BADGE_AUDIENCE_REASON}</p>}
                <Switch
                  className="environment-control"
                  label="Underwater fight"
                  checked={state.combat.underwater}
                  disabled={busy}
                  onChange={(underwater) =>
                    void command("encounter:set-environment", { underwater }).then((result) =>
                      onFeedback(
                        result.ok
                          ? underwater
                            ? "The fight is now underwater."
                            : "The fight is no longer underwater."
                          : (result.message ?? "The environment could not be changed.")
                      )
                    )
                  }
                />
                <div className="menu-section" role="group" aria-label="Add to the fight">
                  <p className="menu-section-title">Add to the fight</p>
                  {(() => {
                    // Archived characters are out of play and the server refuses them; `rosterActors` also drops a
                    // launched replay's clones.
                    const available = rosterActors(state.actors).filter(
                      (actor) => !actor.archived && !state.combat.initiative.some((entry) => entry.actorId === actor.id)
                    );
                    /* Same shape as scene prep (ScenePrepPanel.tsx): characters and NPCs listed in full; monsters
                   behind a collapsed `Recent`, ten deep, sorted by the server-stamped `lastUsedAt`. A new monster
                   comes from `+ Add monsters`. */
                    const addable = available.filter((actor) => actor.kind !== "monster");
                    const recent = available
                      .filter((actor) => actor.kind !== "player-character" && actor.lastUsedAt !== undefined)
                      .sort((left, right) => (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0))
                      .slice(0, RECENT_COUNT);
                    const row = (actor: GmActor) => (
                      <div key={actor.id} className="menu-add-row">
                        <span>
                          {actor.name}
                          {actor.visibility === "gm-only" ? " · GM only" : ""}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                command("encounter:add-combatant", {
                                  actorId: actor.id,
                                  expectedRevision: state.revision
                                }),
                              `${actor.name} joined the fight. The token is in the staging tray.`
                            )
                          }
                        >
                          Add
                        </button>
                      </div>
                    );
                    return (
                      <>
                        {addable.length > 0 && <div className="menu-add-list">{addable.map(row)}</div>}
                        {/* Only when the roster is truly exhausted; `Recent` may still offer monsters. */}
                        {available.length === 0 && (
                          <p className="menu-empty-note">Everyone on the roster is already in this fight.</p>
                        )}
                        {/* No `.scroll-y` here: `RECENT_COUNT` bounds the list, and a nested scroller inside the
                      body's scroll region is hard to use. */}
                        <details className="menu-add-recent">
                          <summary>Recent{recent.length > 0 ? ` (${recent.length})` : ""}</summary>
                          {recent.length === 0 ? (
                            <p className="menu-empty-note">Monsters you have used before show up here.</p>
                          ) : (
                            <div className="menu-add-list">{recent.map(row)}</div>
                          )}
                        </details>
                      </>
                    );
                  })()}
                  <button
                    type="button"
                    className="encounter-add-monsters"
                    disabled={busy}
                    onClick={() => {
                      onAddMonsters();
                      setMenuOpen(false);
                    }}
                  >
                    + Add monsters
                  </button>
                </div>
                <button
                  type="button"
                  className="encounter-end"
                  disabled={busy}
                  onClick={() => {
                    setMenuOpen(false);
                    onEnd();
                  }}
                >
                  End the fight
                </button>
              </div>
            </div>
          </>,
          document.fullscreenElement ?? document.body
        )}
    </>
  );
}
