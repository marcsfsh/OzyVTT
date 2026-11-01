import type { GmView, PlayerView } from "@vtt/domain";
import { AttentionBell, StatusLamp, cx } from "@vtt/ui";
import { owedItems } from "../table/needs";
import { navigate } from "../router";
import "./live-chip.css";

/** The round as the chip reads it: "R03". */
export const roundWord = (round: number) => `R${String(round).padStart(2, "0")}`;

/** Whether one of this player's characters acts now: the acting combatant the turn order reads, unless it is hidden. */
export function myTurnNow(state: PlayerView): boolean {
  if (!state.combat.active || state.combat.hiddenTurn || state.combat.turnActorId === null) return false;
  return state.actors.some(
    (actor) => actor.id === state.combat.turnActorId && "claimStatus" in actor && actor.claimStatus === "mine"
  );
}

/** What the live chip shows for this viewer, or null when nothing is live. */
export function liveOf(view: Readonly<{ role: "gm"; state: GmView } | { role: "player"; state: PlayerView }>) {
  if (view.role === "gm") {
    const combat = view.state.combat;
    const live = (combat.encounters ?? []).find((scene) => scene.id === combat.activeEncounterId) ?? null;
    if (!live) return null;
    return { name: live.name, fighting: combat.active, round: combat.active ? combat.round : null, mine: false };
  }
  // A player's projection names no encounter, so the chip names what is happening.
  const combat = view.state.combat;
  if (!combat.active) return null;
  return { name: "Encounter", fighting: true, round: combat.round, mine: myTurnNow(view.state) };
}

/** The chip's face: a lamp, the encounter's name, the round in VT323 and, on a player's turn, "Your turn" in amber. */
export function LiveFace({
  name,
  fighting,
  round,
  mine
}: Readonly<{ name: string; fighting: boolean; round: number | null; mine: boolean }>) {
  return (
    <>
      <StatusLamp lit={fighting} className={cx("live-chip-lamp", mine && "is-mine")} />
      <span className="live-chip-name">{name}</span>
      {round !== null && <span className="live-chip-round">{roundWord(round)}</span>}
      {mine && <span className="live-chip-mine">Your turn</span>}
    </>
  );
}

/**
 * The laptop bar's live chip (frame spec 2.1): while an encounter runs, its lamp, name and round, and for a player
 * whose character acts now "Your turn" in amber. A control on a Base line that takes you to the table. The GM's Play
 * page draws the encounter picker in its place.
 */
export function LiveChip(view: Readonly<{ role: "gm"; state: GmView } | { role: "player"; state: PlayerView }>) {
  const live = liveOf(view);
  // While the GM is on another section, the bell says what waits on them at the table (ADR-0058).
  const owed = view.role === "gm" ? owedItems(view.state).length : 0;
  if (!live) return null;
  const words = `${live.name}${live.round !== null ? `, round ${live.round}` : ", not started"}${live.mine ? ", your turn" : ""}${owed > 0 ? `, ${owed} waiting` : ""}`;
  return (
    <button
      type="button"
      className={cx("live-chip tap-target interactive", live.mine && "is-mine")}
      aria-label={`Live: ${words}. Go to the table`}
      onClick={() => void navigate("/table")}
    >
      <LiveFace {...live} />
      <AttentionBell count={owed} className="live-chip-bell" />
    </button>
  );
}
