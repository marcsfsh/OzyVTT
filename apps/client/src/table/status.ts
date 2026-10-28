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
  if (combat.mapAssetId) return view.role === "gm" ? "Encounter is live · not started" : "Exploring · no encounter";
  return "No encounter running yet";
}

/**
 * Before a fight, the strip's two halves: "No fight running." and who is on the map, counted from the tokens this
 * audience's projection holds.
 */
export function idleStatus(view: View): Readonly<{ lead: string; detail: string }> {
  const { combat } = view.state;
  const lead = "No encounter running.";
  if (!combat.mapAssetId)
    return {
      lead,
      detail: view.role === "gm" ? "No encounter is live." : "The map appears when the GM makes an encounter live."
    };
  const onMap = new Set(combat.tokens.filter((token) => token.position !== null).map((token) => token.actorId));
  const here = view.state.actors.filter((actor) => onMap.has(actor.id));
  const party = here.filter((actor) => actor.kind === "player-character").length;
  const monsters = here.filter((actor) => actor.kind === "monster").length;
  if (party === 0 && monsters === 0) return { lead, detail: "Nobody is on the map yet." };
  const monsterWords = `${monsters} ${monsters === 1 ? "monster" : "monsters"}`;
  const detail =
    party > 0 && monsters > 0
      ? `${party} of the party and ${monsterWords} are on the map.`
      : party > 0
        ? `${party} of the party ${party === 1 ? "is" : "are"} on the map.`
        : `${monsterWords} ${monsters === 1 ? "is" : "are"} on the map.`;
  return { lead, detail };
}
