import { useState } from "react";
import type { PlayerActor, PlayerView } from "@vtt/domain";
import { Button, useToast } from "@vtt/ui";
import { HitDiceSpender } from "../encounter/SheetRest";
import { command } from "../lib/command";
import "./rest.css";

/**
 * The party's Short Rest on a player's own device: each of their resting characters' Hit Dice to spend, and Done when
 * they have finished. The GM ends the rest, and its benefits land then. The projection carries only the player's own
 * characters, so nothing here names anyone else.
 */
export function ShortRestPrompt({ state }: Readonly<{ state: PlayerView }>) {
  const rest = state.rest?.shortRest ?? null;
  if (!rest) return null;
  return (
    <>
      {rest.actorIds.map((actorId) => {
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        return actor ? <ShortRestCard key={actorId} actor={actor} done={rest.done.includes(actorId)} /> : null;
      })}
    </>
  );
}

function ShortRestCard({ actor, done }: Readonly<{ actor: PlayerActor; done: boolean }>) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const hp = actor.hp.kind === "exact" ? `${actor.hp.current}/${actor.hp.maximum} HP` : null;
  const mark = (next: boolean) => {
    setBusy(true);
    void command("rest:mark-done", { actorId: actor.id, done: next }).then((result) => {
      setBusy(false);
      if (!result.ok) toast(result.message ?? "That could not be saved.", { tone: "error" });
    });
  };
  return (
    <section className="short-rest-prompt" aria-label={`Short rest for ${actor.name}`}>
      <p className="short-rest-prompt-label">
        <strong>Short rest</strong> · {actor.name}
        {hp && ` · ${hp}`}
      </p>
      <p className="short-rest-prompt-hint">
        {done ? "Done. The GM ends the rest." : "Spend Hit Dice if you want, then tap Done. The GM ends the rest."}
      </p>
      <div className="short-rest-prompt-row">
        {actor.hitDice && (
          <HitDiceSpender actorId={actor.id} hitDice={actor.hitDice} onFeedback={(text) => toast(text)} />
        )}
        <Button variant={done ? "ghost" : "secondary"} disabled={busy} onClick={() => mark(!done)}>
          {done ? "Not done yet" : "Done"}
        </Button>
      </div>
    </section>
  );
}
