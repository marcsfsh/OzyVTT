import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  type ActionResolution,
  type HitOffer,
  type HitOptionChoice,
  type PendingReaction,
  type PlayerPendingReaction
} from "@vtt/domain";
import { Button, IconX } from "@vtt/ui";
import { useRollPreference } from "../dice/roll-preference";
import { command } from "../lib/command";
import { castsSpell, damageAdjustments, plainActionName } from "./format";
import { HitOfferChoices, PushChoice } from "./AttackPreview";
import { modeWords } from "./roll-mode-notes";
import { FaceEntry, ForceModeButtons, RerollControl, type DieMode } from "./RollControls";
import "./prompts.css";

/**
 * A reaction window awaiting an answer. What the buttons do follows the trigger:
 * - Uncanny Dodge: the hit's damage is parked here, so both buttons apply it, halved on Use. Each names what the
 *   server weighed through the reactor's defences; a prompt parked before that was recorded shows the raw numbers.
 * - Parry or Shield: the attack waits at its roll; both buttons finish it, Use against the raised AC.
 * - An opportunity attack or Retaliation: Attack rolls a melee swing (or takes a typed d20) to confirm, with the extras
 *   its hit can carry (Sneak Attack) to add; the server holds the die, so only Heroic Inspiration or the GM throws it
 *   again. Let them go clears.
 * - Hellish Rebuke or Storm's Thunder: Use strikes the creature that dealt the damage.
 * The GM's dismiss clears the prompt without applying anything it holds, for a moment settled by hand.
 */
export function ReactionPrompt({
  reaction,
  actorName,
  canDismiss,
  onFeedback,
  rollMode,
  viewer,
  inspired = false
}: Readonly<{
  reaction: PendingReaction | PlayerPendingReaction;
  actorName: string;
  canDismiss: boolean;
  onFeedback: (text: string) => void;
  rollMode: "auto" | "manual";
  /** The GM may force a mode and reroll freely; a player rerolls with Heroic Inspiration. */
  viewer: "gm" | "player";
  /** The reacting character holds Heroic Inspiration. */
  inspired?: boolean;
}>) {
  const { mayType } = useRollPreference();
  const [busy, setBusy] = useState(false);
  // Answering rolls a melee swing first: an opportunity attack, or Retaliation.
  const opportunity =
    reaction.kind === "leaves-reach" || (reaction.kind === "damaged-by-creature" && reaction.rollsAttack);
  // An opportunity attack previewed but not applied: confirm it, as with a saving throw.
  const [rolled, setRolled] = useState<{
    attack: NonNullable<ActionResolution["attack"]>;
    rollMode?: ActionResolution["rollMode"];
    push?: ActionResolution["push"];
    hitOffers?: readonly HitOffer[];
  } | null>(null);
  // Extras for the hit (Sneak Attack); a re-roll can change what is offered, so only those still offered are sent.
  const [extras, setExtras] = useState<HitOptionChoice[]>([]);
  const hitOptions = extras.filter((choice) => rolled?.hitOffers?.some((offer) => offer.id === choice.id));
  // The GM's forced mode, sent with every later look at the held die so Confirm reads it the same way.
  const [forced, setForced] = useState<DieMode | undefined>(undefined);
  const [typed, setTyped] = useState(false);
  // null means the full distance, so a re-roll that changes the offer never carries a stale pick.
  const [pushPick, setPushPick] = useState<number | null>(null);
  const push = rolled?.push ?? null;
  const pushFeet = push ? Math.min(pushPick ?? push.maxFeet, push.maxFeet) : undefined;
  const autoRolled = useRef(false);
  const weighed = reaction.weighed;
  const takeIfUsed =
    weighed?.use ?? reaction.proposedDamageParts.reduce((sum, part) => sum + Math.floor(part.amount / 2), 0);
  const takeIfDeclined = weighed?.decline ?? reaction.proposedDamage;
  // `use` distinguishes the swing (Attack) from letting the mover go; opts drive the preview flow.
  const answer = (
    use: boolean,
    opts: {
      commit?: boolean;
      attackNatural?: number;
      reroll?: boolean;
      pushFeet?: number;
      mode?: DieMode;
      hitOptions?: HitOptionChoice[];
    } = {}
  ) => {
    setBusy(true);
    const { mode: picked, ...rest } = opts;
    const mode = "mode" in opts ? picked : forced;
    void command("reaction:answer", {
      reactionId: reaction.id,
      use,
      ...rest,
      ...(use && mode ? { rollMode: mode } : {})
    }).then((result) => {
      setBusy(false);
      if (!result.ok) {
        onFeedback(result.message ?? "The reaction could not be answered.");
        return;
      }
      const outcome = result.outcome;
      if (!outcome) return;
      if (opportunity) {
        // A preview keeps the prompt open to confirm; an applied answer clears it.
        if (outcome.resolution?.preview && outcome.resolution.attack) {
          // A typed die stays typed until a reroll the server throws (the GM's) replaces it.
          if (opts.attackNatural !== undefined) setTyped(true);
          else if (opts.reroll) setTyped(false);
          setRolled({
            attack: outcome.resolution.attack,
            rollMode: outcome.resolution.rollMode,
            push: outcome.resolution.push,
            ...(outcome.resolution.hitOffers ? { hitOffers: outcome.resolution.hitOffers } : {})
          });
          return;
        }
        setRolled(null);
        const attack = outcome.resolution?.attack;
        const swing = reaction.kind === "leaves-reach" ? "opportunity attack" : reaction.actionName;
        onFeedback(
          use
            ? `${actorName}'s ${swing}: ${attack ? `${attack.outcome.toUpperCase()} (${attack.total})` : "resolved"}${outcome.appliedDamage > 0 ? `, ${outcome.appliedDamage} damage` : ""}.`
            : reaction.kind === "leaves-reach"
              ? `${actorName} let ${reaction.sourceName} go.`
              : `${actorName} kept the reaction.`
        );
      } else if (reaction.kind === "attack-would-hit") {
        const attack = outcome.resolution?.attack;
        const landed = attack && (attack.outcome === "hit" || attack.outcome === "crit");
        onFeedback(
          `${use ? `${actorName} used ${reaction.actionName}` : `${actorName} declined ${reaction.actionName}`}. ${
            landed
              ? `The attack hits${outcome.appliedDamage > 0 ? ` for ${outcome.appliedDamage} damage` : ""}`
              : "The attack misses"
          }.`
        );
      } else if (reaction.kind === "falls") {
        onFeedback(use ? `${actorName} used ${reaction.actionName}.` : `${actorName} kept the reaction.`);
      } else if (reaction.kind === "damaged-by-creature") {
        const save = outcome.resolution?.save;
        onFeedback(
          use
            ? `${actorName} used ${reaction.actionName} against ${reaction.sourceName}${
                save
                  ? `: DC ${save.dc} ${save.ability.toUpperCase()} save`
                  : outcome.appliedDamage > 0
                    ? `: ${outcome.appliedDamage} damage`
                    : ""
              }.`
            : `${actorName} kept the reaction.`
        );
      } else {
        const defences = damageAdjustments(outcome.parts, outcome.flatReduction);
        onFeedback(
          `${
            use
              ? `${actorName} used ${reaction.actionName}, and ${reaction.proposedDamage} damage became ${outcome.appliedDamage}`
              : `${actorName} took ${outcome.appliedDamage} damage`
          }${defences ? `; ${defences}` : ""}.`
        );
      }
    });
  };
  // Auto mode rolls the opportunity swing as soon as the prompt appears (still a preview).
  const rollOnAppear = useEffectEvent(() => answer(true, { commit: false }));
  useEffect(() => {
    if (opportunity && rollMode === "auto" && !rolled && !autoRolled.current) {
      autoRolled.current = true;
      rollOnAppear();
    }
  }, [opportunity, rollMode, rolled]);
  const dismiss = () => {
    setBusy(true);
    void command("reaction:dismiss", { reactionId: reaction.id }).then((result) => {
      setBusy(false);
      onFeedback(
        result.ok
          ? "The reaction prompt is dismissed, and nothing was applied."
          : (result.message ?? "The prompt could not be dismissed.")
      );
    });
  };
  const hit = rolled ? rolled.attack.outcome === "hit" || rolled.attack.outcome === "crit" : false;
  const letGo = reaction.kind === "leaves-reach" ? "Let them go" : "Decline";
  const name = plainActionName(reaction.actionName);
  // A spell is cast, anything else used: "Cast Shield", "Use Parry".
  const useLabel = `${castsSpell(reaction.actionId, reaction.actionName) ? "Cast" : "Use"} ${name}`;
  return (
    <div className="save-prompt reaction-prompt" role="group" aria-label={`Reaction for ${actorName}`}>
      <span className="save-prompt-label">
        {reaction.kind === "leaves-reach" ? (
          <>
            <strong>Opportunity Attack</strong> · {reaction.sourceName} is leaving reach
          </>
        ) : reaction.kind === "damaged-by-creature" ? (
          <>
            <strong>{name}</strong> · {reaction.sourceName} damaged {actorName}
          </>
        ) : reaction.kind === "falls" ? (
          <>
            <strong>{name}</strong> · {reaction.sourceName} is falling
            {reaction.fallFeet !== undefined ? ` ${reaction.fallFeet} ft` : ""}
          </>
        ) : reaction.kind === "attack-would-hit" ? (
          <>
            <strong>{name}</strong> · {reaction.sourceName}'s attack would hit {actorName}. +{reaction.acBonus} AC turns
            it into a miss.
          </>
        ) : (
          <>
            <strong>{name}</strong> against {reaction.sourceName}
            {reaction.critical ? " · critical hit" : ""} · {reaction.proposedDamage} damage incoming
          </>
        )}
      </span>
      {push && pushFeet !== undefined && <PushChoice push={push} value={pushFeet} busy={busy} onPick={setPushPick} />}
      {rolled?.hitOffers && rolled.hitOffers.length > 0 && (
        <HitOfferChoices offers={rolled.hitOffers} chosen={hitOptions} busy={busy} onChange={setExtras} />
      )}
      {opportunity && rolled ? (
        // The swing is rolled: confirm it, or let them go. The GM may force a mode or reroll; a player rerolls with
        // Heroic Inspiration.
        <span className="save-prompt-confirm">
          <strong className={hit ? "save-pass" : "save-fail"}>
            Rolled {rolled.attack.total}
            {modeWords(rolled.rollMode)}
            {rolled.attack.targetAc !== null ? ` against AC ${rolled.attack.targetAc}` : ""} ·{" "}
            {rolled.attack.outcome === "crit" ? "CRIT" : rolled.attack.outcome.toUpperCase()} · d20{" "}
            {rolled.attack.naturalRoll}
          </strong>
          {viewer === "gm" && (
            <ForceModeButtons
              current={forced}
              disabled={busy}
              onPick={(mode) => {
                const next = mode === "normal" ? undefined : mode;
                setForced(next);
                answer(true, { commit: false, mode: next });
              }}
            />
          )}
          <button
            type="button"
            className="encounter-primary"
            disabled={busy}
            onClick={() =>
              answer(true, {
                commit: true,
                ...(pushFeet !== undefined ? { pushFeet } : {}),
                ...(hitOptions.length > 0 ? { hitOptions } : {})
              })
            }
          >
            Confirm {hit ? "hit" : "miss"}
          </button>
          {(viewer === "gm" || inspired) && (
            <RerollControl
              viewer={viewer}
              typed={typed}
              busy={busy}
              onInvalid={onFeedback}
              onReroll={(face) =>
                answer(true, { commit: false, reroll: true, ...(face !== undefined ? { attackNatural: face } : {}) })
              }
            />
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setRolled(null);
              answer(false);
            }}
          >
            {letGo}
          </Button>
        </span>
      ) : (
        <span className="save-prompt-actions">
          {opportunity ? (
            <>
              <button
                type="button"
                className="save-prompt-roll"
                disabled={busy}
                title={`Roll one melee attack against ${reaction.sourceName}`}
                onClick={() => answer(true, { commit: false })}
              >
                Attack
              </button>
              {mayType && (
                <FaceEntry
                  label="Attack d20"
                  busy={busy}
                  onInvalid={onFeedback}
                  onFace={(face) => answer(true, { commit: false, attackNatural: face })}
                />
              )}
              <button
                type="button"
                disabled={busy}
                title={
                  reaction.kind === "leaves-reach" ? "Keep the reaction; the mover leaves freely" : "Keep the reaction"
                }
                onClick={() => answer(false)}
              >
                {letGo}
              </button>
            </>
          ) : reaction.kind === "falls" ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                title="Keep the reaction. The fall lands as it is."
                onClick={() => answer(false)}
              >
                Decline
              </Button>
              <button
                type="button"
                className="encounter-primary reaction-use"
                disabled={busy}
                title={`Spend the reaction on ${reaction.sourceName}'s fall.`}
                onClick={() => answer(true)}
              >
                {useLabel}
              </button>
            </>
          ) : reaction.kind === "attack-would-hit" || reaction.kind === "damaged-by-creature" ? (
            <>
              {/* Taking the hit comes first; using the reaction is the prompt's one primary. */}
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                title={
                  reaction.kind === "attack-would-hit" ? "Keep the reaction. The attack hits." : "Keep the reaction."
                }
                onClick={() => answer(false)}
              >
                {reaction.kind === "attack-would-hit" ? "Take the hit" : "Decline"}
              </Button>
              <button
                type="button"
                className="encounter-primary reaction-use"
                disabled={busy}
                title={
                  reaction.kind === "attack-would-hit"
                    ? `Spend the reaction for +${reaction.acBonus} AC against the attack.`
                    : `Spend the reaction against ${reaction.sourceName}.`
                }
                onClick={() => answer(true)}
              >
                {useLabel}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="save-prompt-roll"
                disabled={busy}
                title={`Spend the reaction to halve the damage${weighed ? " after your defences" : " before resistances"}.`}
                onClick={() => answer(true)}
              >
                {useLabel} · take {takeIfUsed}
              </button>
              <button
                type="button"
                disabled={busy}
                title={`Keep the reaction and take full damage${weighed ? " after your defences" : " before resistances"}.`}
                onClick={() => answer(false)}
              >
                Take {takeIfDeclined}
              </button>
            </>
          )}
          {canDismiss && (
            <button
              type="button"
              className="save-prompt-dismiss"
              disabled={busy}
              title="Dismiss without applying anything"
              aria-label="Dismiss without applying anything"
              onClick={dismiss}
            >
              <IconX />
            </button>
          )}
        </span>
      )}
    </div>
  );
}
