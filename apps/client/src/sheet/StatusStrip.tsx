import { useState } from "react";
import { Chip, IconConcentration, IconPlus, IconStar } from "@vtt/ui";
import {
  ConditionDetail,
  ConditionPicker,
  conditionIcon,
  conditionTone,
  descriptionFor,
  labelFor,
  requestConditionReference,
  type LinkingEffect,
  useConditionCommands,
  useConditionReference
} from "../encounter/conditions";
import { EffectDetail, type ChipEffect } from "../encounter/EffectChips";
import {
  concentrationOf,
  concentrationSpell,
  exhaustionCost,
  exhaustionLevel,
  heroicInspirationOf,
  shortDuration,
  type SheetActor
} from "./sheet-model";

type Shown = Readonly<{ kind: "condition" | "effect"; id: string }> | Readonly<{ kind: "add" }> | null;

/**
 * Every live state on one strip under the sheet's header: Concentration with the spell and its time left, the
 * conditions, Heroic Inspiration while it is held, Exhaustion with what it costs, and timed effects with their time
 * left. A tap opens what the state does and the way to end it this viewer has; Add puts a condition on. Heroic
 * Inspiration leaves the strip wherever a band or the Vitals show it.
 */
export function StatusStrip({
  actor,
  role,
  inFight,
  leading,
  states = true,
  inspiration = true,
  onFeedback
}: Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  /** A player asks the GM to end an imposed state in a live fight, where the GM's question queue is. */
  inFight: boolean;
  /** Chips the compact row puts first (AC, Initiative, Dying). */
  leading?: React.ReactNode;
  /** Shows the live states and Add after the leading chips. Off in the table's row while the Vitals show them. */
  states?: boolean;
  /** Shows Heroic Inspiration while held. Off where the laptop's band or the phone's Vitals already show it. */
  inspiration?: boolean;
  onFeedback: (text: string) => void;
}>) {
  const reference = useConditionReference();
  const [picked, setPicked] = useState<Shown>(null);
  // With the states off the row, nothing of theirs stays open under it.
  const shown = states ? picked : null;
  const commands = useConditionCommands(actor.id, onFeedback, (conditionId) => {
    if (shown?.kind === "condition" && shown.id === conditionId) setPicked(null);
  });
  const effects = actor.effects as readonly ChipEffect[];
  const concentration = concentrationOf(effects);
  const others = effects.filter((effect) => effect !== concentration);
  const exhaustion = exhaustionLevel(actor);
  const inspired = states && inspiration && heroicInspirationOf(actor) === true;
  const toggle = (next: NonNullable<Shown>) =>
    setPicked((current) =>
      current && current.kind === next.kind && ("id" in current ? current.id : "") === ("id" in next ? next.id : "")
        ? null
        : next
    );
  const isShown = (kind: "condition" | "effect", id: string) =>
    shown !== null && shown.kind === kind && shown.id === id;
  const openCondition = shown?.kind === "condition" ? actor.conditions.find((entry) => entry.id === shown.id) : null;
  const openEffect = shown?.kind === "effect" ? effects.find((effect) => effect.id === shown.id) : null;
  const effectChip = (effect: ChipEffect, label: React.ReactNode, concentrating = false) => {
    const time = shortDuration(effect);
    return (
      <Chip
        key={effect.id}
        tone="info"
        icon={concentrating ? <IconConcentration /> : undefined}
        pressed={isShown("effect", effect.id)}
        aria-expanded={isShown("effect", effect.id)}
        aria-label={`${concentrating ? `Concentration on ${concentrationSpell(effect.name)}` : effect.name}${time ? `, ${time} left` : ""}`}
        onClick={() => toggle({ kind: "effect", id: effect.id })}
      >
        {label}
        {time && <span className="cs-chip-time">{time}</span>}
      </Chip>
    );
  };
  return (
    <div className="cs-status-block">
      <div className="cs-status" role="group" aria-label="Live states">
        {leading}
        {states &&
          concentration &&
          effectChip(concentration, `Concentration · ${concentrationSpell(concentration.name)}`, true)}
        {states &&
          actor.conditions
            .filter((condition) => condition.id !== "exhaustion")
            .map((condition) => (
              <Chip
                key={condition.id}
                tone={conditionTone(condition.id)}
                icon={conditionIcon(condition.id)}
                pressed={isShown("condition", condition.id)}
                aria-expanded={isShown("condition", condition.id)}
                title={descriptionFor(condition.id, reference)}
                onClick={() => {
                  requestConditionReference();
                  toggle({ kind: "condition", id: condition.id });
                }}
              >
                {labelFor(condition, reference)}
              </Chip>
            ))}
        {inspired && (
          <Chip tone="beneficial" icon={<IconStar />} className="cs-chip-static">
            Heroic Inspiration
          </Chip>
        )}
        {states && exhaustion > 0 && (
          <Chip
            className="cs-chip-caution"
            pressed={isShown("condition", "exhaustion")}
            aria-expanded={isShown("condition", "exhaustion")}
            aria-label={`Exhaustion ${exhaustion}, ${exhaustionCost(exhaustion)}`}
            onClick={() => {
              requestConditionReference();
              toggle({ kind: "condition", id: "exhaustion" });
            }}
          >
            Exhaustion {exhaustion}
            <span className="cs-chip-time">{exhaustionCost(exhaustion)}</span>
          </Chip>
        )}
        {states && others.map((effect) => effectChip(effect, effect.name))}
        {states && (
          <Chip
            className="cs-chip-add"
            pressed={shown?.kind === "add"}
            aria-expanded={shown?.kind === "add"}
            aria-label="Edit conditions"
            icon={<IconPlus />}
            onClick={() => {
              requestConditionReference();
              toggle({ kind: "add" });
            }}
          >
            {shown?.kind === "add" ? "Done" : "Add"}
          </Chip>
        )}
      </div>
      {openCondition && (
        <div className="cs-status-detail">
          <ConditionDetail
            instance={openCondition}
            label={labelFor(openCondition, reference)}
            text={descriptionFor(openCondition.id, reference)}
            holder={(actor.effects as readonly LinkingEffect[]).find((effect) =>
              effect.linkedConditionIds.includes(openCondition.id)
            )}
            viewer={role}
            canAsk={role === "player" && inFight}
            busy={commands.busy}
            onRemove={() => commands.send(openCondition.id, false)}
            onAsk={() => commands.ask(openCondition.id)}
            onClose={() => setPicked(null)}
          />
        </div>
      )}
      {openEffect && (
        <div className="cs-status-detail">
          <EffectDetail
            actorId={actor.id}
            effect={openEffect}
            canEnd={role === "gm"}
            canAsk={role === "player" && inFight}
            canAct
            onFeedback={onFeedback}
            onClose={() => setPicked(null)}
          />
        </div>
      )}
      {shown?.kind === "add" && (
        <div className="cs-status-detail">
          <ConditionPicker conditions={actor.conditions} busy={commands.busy} onSet={commands.send} />
        </div>
      )}
    </div>
  );
}
