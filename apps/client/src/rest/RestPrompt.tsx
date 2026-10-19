import { useState } from "react";
import type { PlayerActor, PlayerView } from "@vtt/domain";
import { Button, useToast } from "@vtt/ui";
import { HitPointDice } from "../sheet/HitPointDice";
import { command } from "../lib/command";
import "./rest.css";

/**
 * The party's rest on a player's own device. In a Short Rest: each of their resting characters' Hit Point Dice to spend,
 * and Done when they have finished. In a Long Rest: who rests, and for a character an interruption stopped, Resume and
 * the Hit Point Dice a Short Rest's benefits allow. The GM ends either rest, and its benefits land then. The projection
 * carries only the player's own characters, so nothing here names anyone else.
 */
export function RestPrompt({ state }: Readonly<{ state: PlayerView }>) {
  const short = state.rest?.shortRest ?? null;
  const long = state.rest?.longRest ?? null;
  const actorOf = (actorId: string) => state.actors.find((candidate) => candidate.id === actorId);
  return (
    <>
      {short?.actorIds.map((actorId) => {
        const actor = actorOf(actorId);
        return actor ? <ShortRestCard key={actorId} actor={actor} done={short.done.includes(actorId)} /> : null;
      })}
      {long?.actorIds.map((actorId) => {
        const actor = actorOf(actorId);
        return actor ? (
          <LongRestCard
            key={actorId}
            actor={actor}
            interrupted={long.interrupted.includes(actorId)}
            earned={long.shortRestEarned.includes(actorId)}
          />
        ) : null;
      })}
    </>
  );
}

const hpOf = (actor: PlayerActor) => (actor.hp.kind === "exact" ? `${actor.hp.current}/${actor.hp.maximum} HP` : null);

function ShortRestCard({ actor, done }: Readonly<{ actor: PlayerActor; done: boolean }>) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const hp = hpOf(actor);
  const mark = (next: boolean) => {
    setBusy(true);
    void command("rest:mark-done", { actorId: actor.id, done: next }).then((result) => {
      setBusy(false);
      if (!result.ok) toast(result.message ?? "That could not be saved.", { tone: "error" });
    });
  };
  return (
    <section className="short-rest-prompt" aria-label={`Short Rest for ${actor.name}`}>
      <p className="short-rest-prompt-label">
        <strong>Short Rest</strong> · {actor.name}
        {hp && ` · ${hp}`}
      </p>
      <p className="short-rest-prompt-hint">
        {done
          ? "Done. The GM ends the rest."
          : "Spend Hit Point Dice if you want, then tap Done. The GM ends the rest."}
      </p>
      <div className="short-rest-prompt-row">
        {actor.hitDice && (
          <HitPointDice actorId={actor.id} hitDice={actor.hitDice} onFeedback={(text) => toast(text)} />
        )}
        <Button variant={done ? "ghost" : "secondary"} disabled={busy} onClick={() => mark(!done)}>
          {done ? "Not done yet" : "Done"}
        </Button>
      </div>
    </section>
  );
}

function LongRestCard({
  actor,
  interrupted,
  earned
}: Readonly<{ actor: PlayerActor; interrupted: boolean; earned: boolean }>) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const hp = hpOf(actor);
  const resume = () => {
    setBusy(true);
    void command("rest:resume", { actorId: actor.id }).then((result) => {
      setBusy(false);
      toast(result.ok ? `${actor.name} rests again.` : (result.message ?? "That could not be saved."), {
        tone: result.ok ? "success" : "error"
      });
    });
  };
  const hint = !interrupted
    ? "Resting. The GM ends the rest after 8 hours."
    : earned
      ? "Interrupted after an hour of rest, so you have a Short Rest's benefits. Spend Hit Point Dice now if you want, then resume. Each interruption adds an hour."
      : "Interrupted. Resume to keep resting: each interruption adds an hour.";
  return (
    <section className="short-rest-prompt" aria-label={`Long Rest for ${actor.name}`}>
      <p className="short-rest-prompt-label">
        <strong>Long Rest</strong> · {actor.name}
        {hp && ` · ${hp}`}
      </p>
      <p className="short-rest-prompt-hint">{hint}</p>
      {interrupted && (
        <div className="short-rest-prompt-row">
          {earned && actor.hitDice && (
            <HitPointDice actorId={actor.id} hitDice={actor.hitDice} onFeedback={(text) => toast(text)} />
          )}
          <Button variant="secondary" disabled={busy} onClick={resume}>
            Resume
          </Button>
        </div>
      )}
    </section>
  );
}
