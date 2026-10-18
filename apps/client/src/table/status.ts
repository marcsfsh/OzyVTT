import type { GmView, PlayerView } from "@vtt/domain";

type View = Readonly<{ role: "gm"; state: GmView } | { role: "player"; state: PlayerView }>;

/** The table's one-line status, the same words on every device: the round and who is acting, or what the scene is
 *  waiting for. */
export function tableStatus(view: View): string {
  const { combat } = view.state;
  if (combat.active) {
    if (view.role === "player" && view.state.combat.hiddenTurn) return `Round ${combat.round} · a hidden turn`;
    const turnId = combat.turnActorId;
    const mine =
      view.role === "player" && view.state.actors.some((actor) => actor.id === turnId && actor.claimStatus === "mine");
    if (mine) return `Round ${combat.round} · your turn`;
    const acting = view.state.actors.find((actor) => actor.id === turnId);
    if (!acting) return `Round ${combat.round}`;
    // A character at 0 HP making death saves is dying on its turn, which the table should read at a glance.
    const saves = acting.deathSaves;
    const dying = saves !== undefined && saves !== null && !saves.stable && saves.failures < 3;
    const down = "kind" in acting.hp ? acting.hp.kind === "exact" && acting.hp.current === 0 : acting.hp.current === 0;
    return `Round ${combat.round} · ${acting.name} ${dying && down ? "is dying" : "is acting"}`;
  }
  if (combat.mapAssetId) return view.role === "gm" ? "Scene is live · no fight yet" : "Exploring · no fight";
  return "No fight running yet";
}
