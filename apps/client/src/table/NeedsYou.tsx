import { DamageRollPrompt } from "../encounter/DamageRollPrompt";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GmActor, GmView, TargetAsk } from "@vtt/domain";
import { Button, IconBell, IconChevron, IconChevronRight, useToast } from "@vtt/ui";
import { setWaitingList, useWaitingList } from "../settings/preferences";
import { useRollPreference } from "../dice/roll-preference";
import { command, read } from "../lib/command";
import { beginTargeting, setTargetingResult } from "../encounter/targeting";
import { DyingTracker } from "../encounter/DyingTracker";
import { PendingDamagePrompt } from "../encounter/PendingDamagePrompt";
import { ReactionPrompt, triggerWords } from "../encounter/ReactionPrompt";
import { SavePrompt } from "../encounter/SavePrompt";
import { stepLabel, TurnOrder } from "../encounter/TurnOrder";
import { aidGiverOf, type AidGiver, StabilizeControl } from "../encounter/StabilizeControl";
import { useMapCalibration } from "../scene/gridPreview";
import { damageWords, needsItems, needsTitle, type NeedsItem } from "./needs";
import { creatureDistanceFeet } from "./targetHints";
import { ActorAvatar } from "../actors/ActorAvatar";
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
  if (!nearest) return `Nobody in the encounter can help yet. ${help}`;
  return nearest.feet === null
    ? `${nearest.candidate.name} can help. ${help}`
    : `${nearest.candidate.name} is ${nearest.feet} ft away. ${help}`;
}

/** Opens the GM's targeting for a player's ask, cast the way its player chose; the acting console and the map aim it,
 *  and the GM's resolve answers the ask. */
async function aimFor(
  state: GmView,
  ask: TargetAsk,
  onFeedback: (text: string) => void,
  setBusy: (busy: boolean) => void
) {
  const actor = state.actors.find((candidate) => candidate.id === ask.actorId);
  if (!actor?.definitionId) {
    onFeedback(`${ask.actorName} is no longer in the encounter.`);
    return;
  }
  setBusy(true);
  const response = await read("content:monster-actions", { definitionId: actor.definitionId, actorId: actor.id });
  setBusy(false);
  const action = response.ok ? response.actions?.find((candidate) => candidate.id === ask.actionId) : undefined;
  if (!action) {
    onFeedback(response.message ?? `${ask.actionName} could not be found on ${ask.actorName}'s sheet.`);
    return;
  }
  setTargetingResult(null);
  beginTargeting(action, actor.id, ask.slotLevel, ask.darts, ask.shaping ?? []);
  onFeedback(`Choose ${ask.actorName}'s target on the map.`);
}

/** The creature an item is about, for its card's face: who must answer, who was hit or who asks. */
function faceOf(item: NeedsItem, state: GmView): GmActor | null {
  const byId = (id: string | undefined) => (id ? (state.actors.find((actor) => actor.id === id) ?? null) : null);
  switch (item.kind) {
    case "order":
    case "reaction":
    case "save":
    case "dying":
    case "rest":
      return item.actor;
    case "ask":
      return item.actor ?? null;
    case "target":
      return byId(item.ask.actorId);
    case "damage":
      return byId(item.proposal.targetActorId);
    case "damage-roll":
      return byId(item.roll.sourceActorId);
    case "initiative":
      return item.actors[0] ?? null;
  }
}

/** Items a player answers on their own device come after what the GM owes; within each, today's order holds. */
export function waitsOnPlayer(item: NeedsItem): boolean {
  return (item.kind === "order" || item.kind === "reaction" || item.kind === "save") && item.waiting;
}

/** A prompt a player answers on their own device, which the GM can open to answer instead. */
function AnswerFor({ name, children }: Readonly<{ name: string; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  return open ? (
    <>{children}</>
  ) : (
    <Button size="sm" onClick={() => setOpen(true)}>
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
  let detail: string | null = null;
  let body: ReactNode = null;
  switch (item.kind) {
    case "order": {
      detail = `${item.steps.steps.map(stepLabel).join(", ")} happen at the same moment.`;
      const prompt = <TurnOrder key={item.steps.id} waiting={item.steps} onFeedback={onFeedback} />;
      body = item.waiting ? <AnswerFor name={item.actor.name}>{prompt}</AnswerFor> : prompt;
      break;
    }
    case "reaction": {
      const { reaction } = item;
      const parked = reaction.parkedAttack;
      const target = state.actors.find((actor) => actor.id === reaction.targetActorId);
      const roll =
        parked?.attackTotal !== null && parked?.attackTotal !== undefined && target?.armorClass !== undefined
          ? ` (${parked.attackTotal} against AC ${target.armorClass})`
          : "";
      detail =
        reaction.kind === "attack-would-hit"
          ? `${reaction.sourceName}'s hit${roll} waits until ${item.actor.name} answers.`
          : reaction.kind === "leaves-reach"
            ? `${reaction.sourceName} is leaving ${item.actor.name}'s reach.`
            : reaction.kind === "damaged-by-creature"
              ? `${reaction.sourceName} damaged ${item.actor.name}.`
              : reaction.kind === "triggered"
                ? `${triggerWords(reaction, item.actor.name)}.`
                : reaction.kind === "falls"
                  ? `${reaction.sourceName}'s fall waits until ${item.actor.name} answers.`
                  : reaction.kind === "casts-spell"
                    ? `${reaction.sourceName}'s spell waits until ${item.actor.name} answers.`
                    : reaction.kind === "attack-targeted"
                      ? `${reaction.sourceName}'s attack at ${reaction.targetName ?? item.actor.name} waits until ${item.actor.name} answers.`
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
      const { proposal, roll } = item;
      if (roll) {
        // The player rolls it; the GM may type it instead, or settle the hit as it stands.
        detail = `${proposal.targetName} was hit. ${roll.sourceName}'s player rolls ${roll.formula}.`;
        body = (
          <>
            <DamageRollPrompt roll={roll} onFeedback={onFeedback} />
            <PendingDamagePrompt proposal={proposal} onFeedback={onFeedback} />
          </>
        );
        break;
      }
      detail = `${damageWords(proposal.proposedDamageParts, proposal.proposedTotal)}${proposal.critical ? " · critical hit" : ""}.`;
      body = <PendingDamagePrompt proposal={proposal} onFeedback={onFeedback} />;
      break;
    }
    case "damage-roll": {
      const { roll } = item;
      detail = `The saves wait for it. ${roll.sourceName}'s player rolls ${roll.formula}.`;
      body = <DamageRollPrompt roll={roll} onFeedback={onFeedback} />;
      break;
    }
    case "target": {
      const { ask } = item;
      detail = `${ask.slotLevel !== undefined ? `Cast at level ${ask.slotLevel}. ` : ""}Pick the target on the map, then roll it as you would your own.`;
      body = (
        <div className="needs-card-buttons">
          <Button
            size="sm"
            className="needs-main"
            disabled={busy}
            onClick={() => void aimFor(state, ask, onFeedback, setBusy)}
          >
            Choose the target
          </Button>
          <Button
            size="sm"

            disabled={busy}
            onClick={() =>
              send(
                () => command("action:withdraw-target-ask", { askId: ask.id }),
                `Turned down ${ask.actorName}'s ${ask.actionName}.`
              )
            }
          >
            Turn down
          </Button>
        </div>
      );
      break;
    }
    case "dying": {
      const helpers = helpersFor(state, item.actor, distance);
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
      detail = ask.message;
      const name = item.actor?.name ?? "the player";
      body = (
        <div className="needs-card-buttons">
          <Button
            size="sm"
            className="needs-main"
            disabled={busy}
            onClick={() =>
              send(() => command("rules:answer", { askId: ask.id, allow: true }), `Allowed ${name}'s request.`)
            }
          >
            Allow
          </Button>
          <Button
            size="sm"

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
            className="needs-main"
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
      detail = `Approve gives ${actor.name} a Long Rest now. Pass the 8 hours from Rest.`;
      body = (
        <div className="needs-card-buttons">
          <Button
            size="sm"
            className="needs-main"
            disabled={busy}
            onClick={() =>
              send(
                () => command("rest:answer", { actorId: actor.id, approve: true }),
                `${actor.name} finished a Long Rest.`
              )
            }
          >
            Approve
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              send(
                () => command("rest:answer", { actorId: actor.id, approve: false }),
                `Turned down ${actor.name}'s Long Rest.`
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
  const face = faceOf(item, state);
  // Every item the GM owes carries the amber rim; one that waits on a player is grey and quieter (C3 spec 2.2).
  return (
    <li className={`needs-card${waitsOnPlayer(item) ? " is-waiting" : ""}`} data-needs={item.kind}>
      <div className="needs-card-head">
        {face && <ActorAvatar actor={face} name={face.name} size="sm" className="needs-card-face" />}
        <p className="needs-card-title">{needsTitle(item, state)}</p>
      </div>
      {detail && <p className="needs-card-detail">{detail}</p>}
      <div className="needs-card-body">{body}</div>
    </li>
  );
}

/**
 * The GM's waiting list: each item says what happened in numbers and carries its own buttons. It sits at the top of the
 * Encounter tab or, by the GM's choice, in its own first tab (`alone`), and its head holds the switch between the two
 * (ADR-0058). Over the turn it renders nothing while nothing waits; alone it says so. A new item is announced.
 */
export function NeedsYou({
  state,
  token,
  alone = false
}: Readonly<{ state: GmView; token: string | null; alone?: boolean }>) {
  const all = needsItems(state);
  const items = [...all.filter((item) => !waitsOnPlayer(item)), ...all.filter(waitsOnPlayer)];
  const place = useWaitingList();
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
  // The switch names the other place: Own tab while the list is over the turn, Over the turn while it has its tab.
  const placeSwitch =
    place === "tab" ? (
      <Button variant="secondary" size="sm" className="needs-you-place" onClick={() => setWaitingList("turn")}>
        <IconChevron className="needs-you-place-up" /> Over the turn
      </Button>
    ) : (
      <Button variant="secondary" size="sm" className="needs-you-place" onClick={() => setWaitingList("tab")}>
        Own tab <IconChevronRight />
      </Button>
    );
  return (
    <>
      <p className="nh-sr-only" aria-live="polite">
        {announcement}
      </p>
      {(items.length > 0 || alone) && (
        <section className={`needs-you${alone ? " is-alone" : " scroll-y"}`} aria-labelledby="needs-you-heading">
          <div className="needs-you-headrow">
            <h2 className="needs-you-head" id="needs-you-heading">
              <IconBell />
              <span>Needs you · {items.length}</span>
            </h2>
            {placeSwitch}
          </div>
          {items.length === 0 ? (
            <p className="table-panel-empty">Nothing waits on you.</p>
          ) : (
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
          )}
        </section>
      )}
    </>
  );
}

/** Whether an item blocks the turn moving on: something rolled that waits for an answer or an Apply. */
export function holdsTheTurn(state: GmView): boolean {
  return needsItems(state).some((item) => item.kind === "reaction" || item.kind === "save" || item.kind === "damage");
}
