import { useEffect, useMemo, useState } from "react";
import { choosesAbility, type ActorDefinition, type ContentActionSummary } from "@vtt/domain";
import { ActionResultHead, HealingOutcome } from "./ActionResultHead";
import { ActionRow } from "./ActionRow";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { actionSummaryParts } from "./action-summary";
import { AttackOutcome, AttackPreview } from "./AttackPreview";
import { damageBreakdown } from "./format";
import { modeWords } from "./roll-mode-notes";
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
    ...(action.useCost !== undefined ? { useCost: action.useCost } : {}),
    requiresEffectTag: action.requiresEffectTag ?? null,
    multiattack: action.multiattack
      ? action.multiattack.map((component) => ({ actionId: component.actionId, count: component.count }))
      : null,
    grants: action.grants !== undefined,
    reaction: action.reaction ?? null,
    ...(action.darts !== undefined ? { darts: action.darts } : {}),
    ...(action.damageTypes !== undefined ? { damageTypes: [...action.damageTypes] } : {}),
    ...(choosesAbility(action) ? { choosesAbility: true } : {}),
    // A heal for others picks its targets: one (Divine Spark's healing), or several for a divided pool.
    ...(action.healing && !action.healing.self
      ? { targeting: action.healing.divided ? ("multi" as const) : ("single" as const) }
      : {}),
    // So does a touch that ends a condition (Lay on Hands' cure).
    ...(action.endsConditions && !action.healing ? { targeting: "single" as const } : {})
  };
}

/**
 * A player's action console on their own turn, mirroring the GM's ActionRunner for their claimed
 * character: pick an action and targets, roll the d20 (or type the face a physical die shows), see why
 * it has Advantage or Disadvantage, and confirm.
 * Per the table's player-damage policy the server either hands the damage to the GM (proposal) or
 * applies it (direct); the player never applies damage directly.
 */
export function PlayerActionRunner({
  actorId,
  definition,
  extraActions = [],
  revision,
  inspired = false,
  playerDamageMode,
  targets
}: Readonly<{
  actorId: string;
  definition: ActorDefinition;
  /** Actions the server derived from the equipped loadout (a wand's charge, an amulet's cast); they are never in `definition.actions`. Numbers include item riders; resolution goes by id. */ extraActions?: readonly ContentActionSummary[];
  revision: number;
  /** The character holds Heroic Inspiration, which can reroll the attack's d20. */
  inspired?: boolean;
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
        .filter(
          (action) =>
            action.attack ||
            action.save ||
            action.damage.length > 0 ||
            action.uses !== undefined ||
            // A feature's heal (Second Wind); a spell's heal is cast from the spell list.
            (action.healing !== undefined && action.spellId === undefined)
        )
        .map(summaryOfOwnAction),
      // Item-derived actions are appended: their `item-<inventory id>` keys cannot collide with
      // stat-block ids. The server says which resolve (a potion, a scroll, a coat of poison).
      ...extraActions.filter(
        (action) =>
          (action.targeting !== undefined && action.targeting !== null) ||
          action.attackBonus !== null ||
          action.saveAbility !== null ||
          action.damage.length > 0 ||
          action.usesLimit !== null
      )
    ],
    [definition, extraActions]
  );
  const healingOf = (action: ContentActionSummary) => definition.actions.find((own) => own.id === action.id)?.healing;
  // A self heal (Second Wind) is a direct tap; a heal for others picks its targets first. An item's action carries the
  // server's word on it (a scroll of Detect Magic is a tap, a potion picks its drinker).
  const isTargetlessOwn = (action: ContentActionSummary) => {
    if (action.targeting === "none") return true;
    // A touch that ends a condition picks who it touches.
    if (action.targeting === "single" || action.targeting === "multi") return false;
    const healing = healingOf(action);
    if (healing) return healing.self === true;
    return (
      action.attackBonus === null &&
      action.saveAbility === null &&
      action.damage.length === 0 &&
      action.usesLimit !== null
    );
  };
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
            // A heal may be for the healer too (a potion drunk, not handed over).
            .filter(
              (target) =>
                target.actorId !== actorId || picking.action.healing != null || healingOf(picking.action) !== undefined
            )
            .map((target) => ({ id: target.actorId, label: target.name }))}
          busy={busy}
          onInvalidFace={onFeedback}
          onRoll={(face) => resolveTargeting(revision, onOutcome, face !== undefined ? { attackNatural: face } : {})}
        />
      )}
      {result && (
        <div className="action-result" role="status">
          <ActionResultHead result={result} />
          {/* Why the d20 had Advantage or Disadvantage, before the player confirms it. */}
          {result.attack && result.rollMode && result.rollMode.mode !== "normal" && (
            <p className="action-rollmode">{modeWords(result.rollMode).replace(/^ · /, "")}</p>
          )}
          {result.attack && <AttackOutcome attack={result.attack} audience="player" />}
          {result.preview && result.attack && (
            <AttackPreview
              attack={result.attack}
              busy={busy}
              viewer="player"
              inspired={inspired}
              onFeedback={onFeedback}
              push={result.push}
              {...(result.hitOffers ? { hitOffers: result.hitOffers } : {})}
              resolve={(options) => resolveTargeting(revision, onOutcome, options)}
            />
          )}
          {result.save && (
            <p className="action-outcome">
              Each target: DC {result.save.dc} {result.save.ability.toUpperCase()} save - the GM answers these.
            </p>
          )}
          {result.waitingOnReaction && result.attack && (
            <p className="action-save-note">
              Waiting on {result.attack.targetName}'s{" "}
              <strong>
                {result.reactionPrompts?.find((candidate) => candidate.actorId === result.attack!.targetId)
                  ?.actionName ?? "reaction"}
              </strong>{" "}
              - it may turn the hit into a miss. The attack finishes in the turn order.
            </p>
          )}
          {result.damage.length > 0 &&
            !result.preview &&
            (() => {
              const breakdown = damageBreakdown(result);
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
          {/* A miss owes damage only through Graze, which is already in the total. */}
          {!result.preview &&
            result.attack &&
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
          {/* No attack roll and no save (Magic Missile): each target's damage goes the same way as a hit's. */}
          {!result.preview && !result.attack && (result.damageTargets?.length ?? 0) > 0 && (
            <p className="action-save-note">
              {playerDamageMode === "direct" ? "Applied to " : "Handed to the GM to apply to "}
              {result.damageTargets!.map((owed) => `${owed.targetName} (${owed.total})`).join(", ")}.
            </p>
          )}
          {result.opens &&
            (() => {
              // Cleave: the hit opened a swing at a second creature, picked like any target.
              const swing = actions.find((candidate) => candidate.id === result.opens!.actionId);
              return swing ? (
                <p className="action-result-hint">
                  <button
                    type="button"
                    className="action-again"
                    disabled={busy}
                    onClick={() => {
                      setTargetingResult(null);
                      beginTargeting(swing, actorId);
                    }}
                  >
                    {result.opens!.actionName}
                  </button>{" "}
                  swings at another target within 5 feet of {result.attack?.targetName ?? "the first"}.
                </p>
              ) : null;
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
