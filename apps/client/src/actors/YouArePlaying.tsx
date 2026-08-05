import { useState } from "react";
import type { PlayerView } from "@vtt/domain";
import { Avatar, Button, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { CharacterSheet } from "../encounter/CharacterSheet";
import { hpLabel } from "./actor-display";
import { newId } from "../lib/ids";
import { socket } from "../socket";

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
 * **Release stays here, against decision Q2, and the reason is a test.** Q2 moves it to the sheet's
 * page-actions row (design-language §7, the Sheet layer) — but that row is `CharacterSheet`'s
 * `standaloneActions`, which only the STANDALONE presentation renders, and this surface opens the
 * sheet as a modal. Meanwhile `play-vocabulary.test.ts`'s D28 glossary pins the word "Release" to
 * THIS file ("the table's release verb — never 'Leave'"), and `character:release` has exactly one
 * call site in the client: the one below. Dropping the button would have deleted the only route to
 * a verb the vocabulary lock says lives here, in a change that cannot also move the lock's row.
 * So it stays as the quiet half of the pair, and moving it remains a two-file change for the sheet's
 * owner: this file, plus the LEGITIMATE row in `play-vocabulary.test.ts`, in one commit.
 */
export function YouArePlaying({ state }: Readonly<{ state: PlayerView }>) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const ownedActor = state.actors.find((actor) => actor.kind === "player-character" && actor.claimStatus === "mine") ?? null;
  if (!ownedActor) return null;
  const release = async (name: string) => {
    // D28's claim verbs: you RELEASE a character, you do not "leave" one.
    if (!(await confirm({ title: `Release ${name}?`, body: "Someone else will be able to play them.", confirmLabel: "Release" }))) return;
    setReleasing(true);
    socket.emit("character:release", { commandId: newId(), expectedRevision: state.revision }, (result) => {
      setReleasing(false);
      if (result.ok) toast(`You released ${name}. Pick another when you're ready.`, { tone: "success" });
      else toast(result.message ?? "Couldn't release the character.", { tone: "error" });
    });
  };
  return <section className="you-are-playing" aria-label={`Playing ${ownedActor.name}`}>
    <Avatar name={ownedActor.name} size="sm" />
    <span className="you-are-playing-name">{ownedActor.name}</span>
    <span className="own-hp" role="status">HP {hpLabel(ownedActor.hp)}</span>
    <Button size="sm" variant="ghost" disabled={releasing} title={`Release ${ownedActor.name}`} onClick={() => release(ownedActor.name)}>Release</Button>
    <Button size="sm" variant="secondary" disabled={releasing} onClick={() => setSheetOpen(true)}>My sheet</Button>
    {sheetOpen && <CharacterSheet actor={ownedActor} role="player" state={state} onClose={() => setSheetOpen(false)} />}
    {dialog}
  </section>;
}
