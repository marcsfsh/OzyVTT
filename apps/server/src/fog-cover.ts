import type { CombatState, GameState } from "@vtt/domain";
import { revealedRegion } from "./fog.js";
import { intersect, type Rect } from "./rect-region.js";

/**
 * Who the manual fog hides from players and the table screen. A creature whose whole space lies under the fog is left
 * out of their tokens and of what an area spell reports, so its position never reaches them; a creature any part of
 * whose space is revealed is shown. A player's own characters are never lost to them.
 */

type Token = CombatState["tokens"][number];

/** A token's space as a rect: its cells, or the drawn token on a map without a grid. */
function spaceOf(token: Token): Rect | null {
  if (!token.position) return null;
  const side = Math.max(token.sizePx, (token.gridSizePx ?? 0) * token.sizeCells);
  return { x: token.position.x - side / 2, y: token.position.y - side / 2, width: side, height: side };
}

/** The placed creatures whose whole space the scene's fog covers; none while its fog is off. */
export function fogCovered(combat: Readonly<{ fog?: CombatState["fog"]; tokens: readonly Token[] }>): Set<string> {
  const covered = new Set<string>();
  if (combat.fog?.enabled !== true) return covered;
  const revealed = revealedRegion(combat.fog);
  if (revealed === "everything") return covered;
  for (const token of combat.tokens) {
    const space = spaceOf(token);
    if (space && !revealed.some((rect) => intersect(rect, space) !== null)) covered.add(token.actorId);
  }
  return covered;
}

/** The creatures a player may not see on the live map: GM-only or archived ones, and those wholly under the fog
 *  other than the player's own characters. Without a session (a spectator, the table screen) nobody is their own. */
export function unseenByPlayer(state: GameState, playerSessionId: string | undefined): Set<string> {
  const unseen = fogCovered(state.combat);
  for (const actor of state.actors) {
    if (playerSessionId !== undefined && actor.ownerSessionId === playerSessionId) unseen.delete(actor.id);
    if (actor.visibility !== "public" || actor.archived) unseen.add(actor.id);
  }
  return unseen;
}
