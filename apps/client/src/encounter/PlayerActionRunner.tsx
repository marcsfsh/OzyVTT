import { useEffect, useMemo, useState } from "react";
import { type ActorDefinition, type ContentActionSummary } from "@vtt/domain";
import { ActionResultHead, HealingOutcome } from "./ActionResultHead";
import { ActionRow } from "./ActionRow";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { actionSummaryParts } from "./action-summary";
import { AttackOutcome, AttackPreview } from "./AttackPreview";
import { AskTheGmPrompt } from "./RuleAsk";
import {
  beginTargeting,
  clearTargeting,
  resolveActionDirect,
  resolveTargeting,
  setTargetingResult,
  useTargeting,
  useTargetingBusy,
  useTargetingResult
} from "./targeting";
import "./action-runner.css";

/** Maps a player's own stat-block action onto the ContentActionSummary the targeting store uses.
 *  Area templates are dropped: players target by explicit ids; the GM places AoE templates. */
export function summaryOfOwnAction(action: ActorDefinition["actions"][number]): ContentActionSummary {
  return {
    id: action.id,
    name: action.name,
    activation: action.activation,
    description: action.description,
    attackBonus: action.attack?.bonus ?? null,
    reachFeet: action.attack?.reachFeet ?? null,
    rangeFeet: action.attack?.rangeFeet ?? null,
    rangeNormalFeet: action.attack?.rangeNormalFeet ?? null,
    saveAbility: action.save?.ability ?? null,
    saveDc: action.save?.dc ?? null,
    damage: action.damage.map((part) => ({ formula: part.formula, type: part.type })),
    area: null,
    attackCount: action.attack?.count ?? null,
    usesLimit: action.uses?.limit ?? null,
    usesPer: action.uses?.per ?? null,
    usesRecharge: action.uses?.recharge ?? null,
    usesPool: action.uses?.pool ?? null,
    requiresEffectTag: action.requiresEffectTag ?? null,
    multiattack: action.multiattack
      ? action.multiattack.map((component) => ({ actionId: component.actionId, count: component.count }))
      : null,
    grants: action.grants !== undefined,
    reaction: action.reaction ?? null
  };
}

/**
 * A player's action console on their own turn, mirroring the GM's ActionRunner for their claimed
 * character: pick an action and targets, preview the d20 (Adv/Disadv or a typed die), and confirm.
 * Per the table's player-damage policy the server either hands the damage to the GM (proposal) or
 * applies it (direct); the player never applies damage directly.
 */
export function PlayerActionRunner({
  actorId,
  definition,
  extraActions = [],
  revision,
  rollMode,
  bonusMode,
  playerDamageMode,
  targets
}: Readonly<{
  actorId: string;
  definition: ActorDefinition;
  /** Actions the server derived from the equipped loadout (a wand's charge, an amulet's cast); they are never in `definition.actions`. Numbers include item riders; resolution goes by id. */ extraActions?: readonly ContentActionSummary[];
  revision: number;
  rollMode: "auto" | "manual";
  bonusMode: "auto" | "total";
  playerDamageMode: "proposal" | "direct";
  targets: readonly { actorId: string; name: string }[];
}>) {
  const [feedback, setFeedback] = useState("");
  const onFeedback = setFeedback;
  // A limited use is a structured effect the server resolves, so Action Surge and the like get a
  // targetless Use tap here too.
  const actions = useMemo(
    () => [
      ...definition.actions
        .filter((action) => action.attack || action.save || action.damage.length > 0 || action.uses !== undefined)
        .map(summaryOfOwnAction),
      // Item-derived actions are appended: their `item-<inventory id>` keys cannot collide with
      // stat-block ids.
      ...extraActions.filter(
        (action) =>
          action.attackBonus !== null ||
          action.saveAbility !== null ||
          action.damage.length > 0 ||
          action.usesLimit !== null
      )
    ],
    [definition, extraActions]
  );
  const isTargetlessOwn = (action: ContentActionSummary) =>
    action.attackBonus === null &&
    action.saveAbility === null &&
    action.damage.length === 0 &&
    action.usesLimit !== null;
  const session = useTargeting();
  const result = useTargetingResult();
  const busy = useTargetingBusy();
  // This runner owns the shared targeting only when the session is for this character.
  const picking = session && session.attackerId === actorId ? session : null;
  // The turn moved off this character (or the panel closed): drop any targeting/result.
  useEffect(
    () => () => {
      clearTargeting();
      setTargetingResult(null);
    },
    []
  );

  if (actions.length === 0) return null;
  const onOutcome = (ok: boolean, message?: string) => {
    if (!ok && message) onFeedback(message);
  };

  return (
    <div className="action-runner player-actions">
      {/* On Enforce the resolve suppresses its own message, so the refusal and the ask are shown here. */}
      <AskTheGmPrompt onFeedback={onFeedback} />
      {!picking && !result && (
        <>
          <p className="player-actions-label">
            Your actions <span>· your turn</span>
          </p>
          <ul className="action-list">
            {actions.map((action) => (
              <li key={action.id}>
                <ActionRow
                  action={action}
                  parts={actionSummaryParts(action, actions)}
                  note="Tap to use"
                  disabled={busy}
                  onUse={() => {
                    setTargetingResult(null);
                    if (isTargetlessOwn(action)) resolveActionDirect(actorId, action.id, revision, onOutcome);
                    else beginTargeting(action, actorId);
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {picking && !result?.preview && (
        <ActionTargetPicker
          picking={picking}
          targets={targets
            .filter((target) => target.actorId !== actorId)
            .map((target) => ({ id: target.actorId, label: target.name }))}
          busy={busy}
          onRoll={() => resolveTargeting(revision, onOutcome)}
        />
      )}
      {result && (
        <div className="action-result" role="status">
          <ActionResultHead result={result} />
          {result.attack && <AttackOutcome attack={result.attack} audience="player" />}
          {result.preview && result.attack && (
            <AttackPreview
              attack={result.attack}
              mode={result.rollMode?.mode}
              busy={busy}
              rollMode={rollMode}
              bonusMode={bonusMode}
              onFeedback={onFeedback}
              push={result.push}
              resolve={(options) => resolveTargeting(revision, onOutcome, options)}
            />
          )}
          {result.save && (
            <p className="action-outcome">
              Each target: DC {result.save.dc} {result.save.ability.toUpperCase()} save - the GM answers these.
            </p>
          )}
          {result.damage.length > 0 &&
            !result.preview &&
            (() => {
              const breakdown = [
                ...result.damage.map((part) => `${part.formula} ${part.type} = ${part.total}`),
                ...(result.bonusDamage ?? []).map((part) => `+${part.amount} ${part.source}`)
              ].join(" + ");
              return (
                <p className="action-damage">
                  Damage: <strong>{result.damageTotal}</strong>
                  {breakdown ? ` (${breakdown})` : ""}
                  {result.crit ? " - crit dice doubled" : ""}
                </p>
              );
            })()}
          {result.healing && <HealingOutcome healing={result.healing} />}
          {/* Players never apply damage: a committed hit goes to the GM (proposal) or is auto-applied
          (direct), unless a target's reaction (Uncanny Dodge) parked it on a prompt instead. */}
          {!result.preview &&
            result.attack &&
            (result.attack.outcome === "hit" ||
              result.attack.outcome === "crit" ||
              result.attack.outcome === "unknown") &&
            result.damageTotal > 0 &&
            (() => {
              const reactionPrompt = result.reactionPrompts?.find(
                (candidate) => candidate.actorId === result.attack!.targetId
              );
              if (reactionPrompt)
                return (
                  <p className="action-save-note">
                    Waiting on {result.attack!.targetName}'s <strong>{reactionPrompt.actionName}</strong> - it resolves
                    in the turn order.
                  </p>
                );
              return (
                <p className="action-save-note">
                  {playerDamageMode === "direct"
                    ? `Applied to ${result.attack!.targetName}.`
                    : `Handed to the GM to apply to ${result.attack!.targetName}.`}
                </p>
              );
            })()}
        </div>
      )}
      {feedback && (
        <p className="save-prompt-outcome" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}
