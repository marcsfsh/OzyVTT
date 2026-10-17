import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GmActor, GmView } from "@vtt/domain";
import { Button, IconBell, useToast } from "@vtt/ui";
import { useRollPreference } from "../dice/roll-preference";
import { command } from "../lib/command";
import { DyingTracker } from "../encounter/DyingTracker";
import { PendingDamagePrompt } from "../encounter/PendingDamagePrompt";
import { ReactionPrompt } from "../encounter/ReactionPrompt";
import { SavePrompt } from "../encounter/SavePrompt";
import { aidGiverOf, type AidGiver, StabilizeControl } from "../encounter/StabilizeControl";
import { useMapCalibration } from "../scene/gridPreview";
import { damageWords, needsItems, needsTitle, type NeedsItem } from "./needs";
import { creatureDistanceFeet } from "./targetHints";
import "./needs-you.css";

/** Who in the fight could give a dying creature aid, nearest first: conscious characters and NPCs. */
function helpersFor(state: GmView, target: GmActor, distance: (a: string, b: string) => number | null) {
  return state.combat.initiative
    .flatMap((entry) => {
      const candidate = state.actors.find((actor) => actor.id === entry.actorId);
      return candidate && candidate.id !== target.id && candidate.kind !== "monster" && candidate.hp.current > 0
        ? [{ candidate, feet: distance(candidate.id, target.id) }]
        : [];
    })
    .sort((left, right) => (left.feet ?? Infinity) - (right.feet ?? Infinity));
}

/** How a dying creature can be helped, in numbers where the map has them. */
function dyingDetail(target: GmActor, helpers: ReturnType<typeof helpersFor>): string {
  const help = `Healing brings ${target.name} back, and Help with a DC 10 Medicine check stabilizes ${target.name}.`;
  const nearest = helpers[0];
  if (!nearest) return `Nobody in the fight can help yet. ${help}`;
  return nearest.feet === null
    ? `${nearest.candidate.name} can help. ${help}`
    : `${nearest.candidate.name} is ${nearest.feet} ft away. ${help}`;
}

/** A prompt a player answers on their own device, which the GM can open to answer instead. */
function AnswerFor({ name, children }: Readonly<{ name: string; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  return open ? (
    <>{children}</>
  ) : (
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
      Answer for {name}
    </Button>
  );
}

function NeedsCard({
  item,
  state,
  rollMode,
  distance,
  onFeedback
}: Readonly<{
  item: NeedsItem;
  state: GmView;
  rollMode: "auto" | "manual";
  distance: (a: string, b: string) => number | null;
  onFeedback: (text: string) => void;
}>) {
  const [busy, setBusy] = useState(false);
  const send = (run: () => Promise<{ ok: boolean; message?: string }>, done: string) => {
    setBusy(true);
    void run().then((result) => {
      setBusy(false);
      onFeedback(result.ok ? done : (result.message ?? "That did not go through."));
    });
  };
  let tone = "info";
  let detail: string | null = null;
  let body: ReactNode = null;
  switch (item.kind) {
    case "reaction": {
      const { reaction } = item;
      const parked = reaction.parkedAttack;
      const target = state.actors.find((actor) => actor.id === reaction.targetActorId);
      const roll =
        parked?.attackTotal !== null && parked?.attackTotal !== undefined && target?.armorClass !== undefined
          ? ` (${parked.attackTotal} against AC ${target.armorClass})`
          : "";
      tone = item.waiting ? "caution" : "info";
      detail =
        reaction.kind === "attack-would-hit"
          ? `${reaction.sourceName}'s hit${roll} waits until ${item.actor.name} answers.`
          : reaction.kind === "leaves-reach"
            ? `${reaction.sourceName} is leaving ${item.actor.name}'s reach.`
            : reaction.kind === "damaged-by-creature"
              ? `${reaction.sourceName} damaged ${item.actor.name}.`
              : `${reaction.proposedDamage} damage waits on ${item.actor.name}'s answer.`;
      const prompt = (
        <ReactionPrompt
          reaction={reaction}
          actorName={item.actor.name}
          canDismiss
          onFeedback={onFeedback}
          rollMode={rollMode}
          viewer="gm"
        />
      );
      body = item.waiting ? <AnswerFor name={item.actor.name}>{prompt}</AnswerFor> : prompt;
      break;
    }
    case "save": {
      const { save } = item;
      tone = item.waiting ? "caution" : "info";
      const from = `${save.sourceName ? `${save.sourceName}'s ` : ""}${save.actionName}`;
      detail =
        save.proposedDamage > 0
          ? `${from} · ${save.proposedDamage} damage on a failure${save.halfOnSuccess ? ", half on a success" : ""}.`
          : `${from}.`;
      const prompt = (
        <SavePrompt
          save={save}
          targetName={item.actor.name}
          canDismiss
          onFeedback={onFeedback}
          rollMode={rollMode}
          viewer="gm"
          legendaryResistanceLeft={
            item.actor.legendary?.resistancesPerDay !== undefined
              ? Math.max(
                  0,
                  item.actor.legendary.resistancesPerDay - (item.actor.actionUses["legendary-resistance"] ?? 0)
                )
              : undefined
          }
        />
      );
      body = item.waiting ? <AnswerFor name={item.actor.name}>{prompt}</AnswerFor> : prompt;
      break;
    }
    case "damage": {
      const { proposal } = item;
      tone = "caution";
      detail = `${damageWords(proposal.proposedDamageParts, proposal.proposedTotal)}${proposal.critical ? " · critical hit" : ""}.`;
      body = <PendingDamagePrompt proposal={proposal} onFeedback={onFeedback} />;
      break;
    }
    case "dying": {
      const helpers = helpersFor(state, item.actor, distance);
      tone = "danger";
      detail = dyingDetail(item.actor, helpers);
      const aid: AidGiver[] = helpers.map(({ candidate }) =>
        aidGiverOf(candidate, state.definitions?.find((entry) => entry.id === candidate.definitionId)?.definition)
      );
      body = (
        <DyingTracker
          actorId={item.actor.id}
          name={item.actor.name}
          deathSaves={item.actor.deathSaves!}
          canRoll={!(item.ownTurn && state.combat.turn.deathSaveRolled === true)}
          onFeedback={onFeedback}
          rollMode={rollMode}
          isActingTurn={item.ownTurn}
          viewer="gm"
          rollLabel={`Roll the save for ${item.actor.name}`}
          aid={
            <StabilizeControl
              targetId={item.actor.id}
              targetName={item.actor.name}
              helpers={aid}
              gm
              onFeedback={onFeedback}
            />
          }
        />
      );
      break;
    }
    case "ask": {
      const { ask } = item;
      tone = "gm";
      detail = ask.message;
      const name = item.actor?.name ?? "the player";
      body = (
        <div className="needs-card-buttons">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              send(() => command("rules:answer", { askId: ask.id, allow: true }), `Allowed ${name}'s request.`)
            }
          >
            Allow
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              send(() => command("rules:answer", { askId: ask.id, allow: false }), `Denied ${name}'s request.`)
            }
          >
            Deny
          </Button>
        </div>
      );
      break;
    }
    case "initiative": {
      detail = `${item.actors.map((actor) => actor.name).join(", ")}. ${
        state.combat.playerInitiativeMode === "wait"
          ? "Turns begin once everyone has rolled."
          : "The fight goes on meanwhile."
      }`;
      body = (
        <div className="needs-card-buttons">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              send(() => command("initiative:roll-remaining", {}), "Rolled initiative for the rest of the table.")
            }
          >
            Roll for the rest
          </Button>
        </div>
      );
      break;
    }
    case "rest": {
      const { actor } = item;
      // Approving rests this one character now; passing the 8 hours for everyone is the Rest dialog's job.
      detail = `Approve gives ${actor.name} a long rest now. Pass the 8 hours from Rest.`;
      body = (
        <div className="needs-card-buttons">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              send(
                () => command("rest:answer", { actorId: actor.id, approve: true }),
                `${actor.name} finished a long rest.`
              )
            }
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              send(
                () => command("rest:answer", { actorId: actor.id, approve: false }),
                `Turned down ${actor.name}'s long rest.`
              )
            }
          >
            Not now
          </Button>
        </div>
      );
      break;
    }
  }
  return (
    <li className={`needs-card needs-card--${tone}`} data-needs={item.kind}>
      <p className="needs-card-title">{needsTitle(item, state)}</p>
      {detail && <p className="needs-card-detail">{detail}</p>}
      <div className="needs-card-body">{body}</div>
    </li>
  );
}

/**
 * The GM's queue of decisions, above the panel's tabs: each item says what happened in numbers and carries its own
 * buttons, so nothing waits in a scrolled list. Renders nothing while nothing waits. A new item is announced.
 */
export function NeedsYou({ state, token }: Readonly<{ state: GmView; token: string | null }>) {
  const items = needsItems(state);
  const { rollMode } = useRollPreference();
  const { toast } = useToast();
  const [announcement, setAnnouncement] = useState("");
  const grid = useMapCalibration(state.combat.mapAssetId, token);
  const tokens = new Map(state.combat.tokens.map((entry) => [entry.actorId, entry]));
  const distance = (a: string, b: string) => {
    const first = tokens.get(a);
    const second = tokens.get(b);
    return first && second ? creatureDistanceFeet(grid.calibration, first, second) : null;
  };
  // Announce what arrived since the last look, by its title.
  const seen = useRef<ReadonlySet<string>>(new Set(items.map((item) => item.key)));
  const keys = items.map((item) => item.key).join("|");
  useEffect(() => {
    const arrived = items.filter((item) => !seen.current.has(item.key));
    seen.current = new Set(items.map((item) => item.key));
    if (arrived.length > 0) setAnnouncement(`Needs you: ${needsTitle(arrived[arrived.length - 1], state)}.`);
    // Only a change in which items wait announces anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  return (
    <>
      <p className="nh-sr-only" aria-live="polite">
        {announcement}
      </p>
      {items.length > 0 && (
        <section className="needs-you scroll-y" aria-labelledby="needs-you-heading">
          <h2 className="needs-you-head" id="needs-you-heading">
            <IconBell />
            <span>Needs you · {items.length}</span>
          </h2>
          <ul className="needs-you-list">
            {items.map((item) => (
              <NeedsCard
                key={item.key}
                item={item}
                state={state}
                rollMode={rollMode}
                distance={distance}
                onFeedback={(text) => toast(text)}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Whether an item blocks the turn moving on: something rolled that waits for an answer or an Apply. */
export function holdsTheTurn(state: GmView): boolean {
  return needsItems(state).some((item) => item.kind === "reaction" || item.kind === "save" || item.kind === "damage");
}
