import { useState } from "react";
import type { PlayerView } from "@vtt/domain";
import { Avatar, Button } from "@vtt/ui";
import { CharacterSheet } from "../encounter/CharacterSheet";
import { hpLabel } from "./actor-display";

/**
 * The player's own-character row. It used to ride the app shell above every tab, below a full-size
 * roster; it now leads the player's **table**, which is the only place it means anything (D15/D32).
 *
 * **ONE ROW SINCE C1 (decision Q2).** It was a 349px card — an eyebrow over the name, a labelled
 * Conditions editor, a damage/heal/temp tracker, two buttons — which is 40% of a 390x844 pane spent
 * on controls that all exist somewhere else: conditions are already legible on the Turn tab's own
 * initiative row for your character, and damage/heal/temp are on the sheet
 * (`CharacterSheet.tsx` — Damage · Heal · Temp), one tap from here and from the party strip. What is
 * left is the thing nothing else on the table says: WHO you are playing, how they are doing, and the
 * door to their sheet. Avatar, name, HP, one button, at the 44px floor by paint.
 *
 * **Release is not here, and that is a gap, not a decision to hide it.** Q2 puts it in the sheet's
 * page-actions row (design-language §7, the Sheet layer) — a bottom row inside `CharacterSheet` that
 * only the standalone presentation renders today. Until that lands there is no route to
 * `character:release` in the client at all.
 */
export function YouArePlaying({ state }: Readonly<{ state: PlayerView }>) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const ownedActor = state.actors.find((actor) => actor.kind === "player-character" && actor.claimStatus === "mine") ?? null;
  if (!ownedActor) return null;
  return <section className="you-are-playing" aria-label={`Playing ${ownedActor.name}`}>
    <Avatar name={ownedActor.name} size="sm" />
    <span className="you-are-playing-name">{ownedActor.name}</span>
    <span className="own-hp" role="status">HP {hpLabel(ownedActor.hp)}</span>
    <Button size="sm" variant="secondary" onClick={() => setSheetOpen(true)}>My sheet</Button>
    {sheetOpen && <CharacterSheet actor={ownedActor} role="player" state={state} onClose={() => setSheetOpen(false)} />}
  </section>;
}
