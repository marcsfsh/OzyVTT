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
