import { useEffect, useMemo, useState } from "react";
import { type ActorDefinition, type ContentActionSummary } from "@vtt/domain";
import { read } from "../lib/command";
import { ActionResultHead, HealingOutcome } from "./ActionResultHead";
import { ActionRow } from "./ActionRow";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { actionSummaryParts } from "./action-summary";
import { AttackOutcome, AttackPreview } from "./AttackPreview";
import { CommonActionChips } from "./CommonActionChips";
import { damageBreakdown } from "./format";
import { AskTheGmPrompt } from "./RuleAsk";
import { summaryOfAvailability, type AvailabilityRow } from "./useSheetDefinition";
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
    reaction: action.reaction ?? null,
    ...(action.darts !== undefined ? { darts: action.darts } : {}),
    ...(action.damageTypes !== undefined ? { damageTypes: [...action.damageTypes] } : {}),
    // A heal for others picks its targets: one (Divine Spark's healing), or several for a divided pool.
    ...(action.healing && !action.healing.self
      ? { targeting: action.healing.divided ? ("multi" as const) : ("single" as const) }
      : {})
  };
}

/** What the server lists for this character beyond its own rows: the generic actions it can take (with the Bonus
 *  Action forms its features give) and which of its rows are added to a hit rather than taken alone. Read once per
 *  sheet; the server still decides each use. */
function useServerActionFacts(actorId: string, definition: ActorDefinition) {
  const [facts, setFacts] = useState<{ common: readonly ContentActionSummary[]; ridesAHit: ReadonlySet<string> }>({
    common: [],
    ridesAHit: new Set()
  });
  useEffect(() => {
    let live = true;
    void read("actor:available-actions", { actorId }).then((result) => {
      if (!live || !result.ok) return;
      const rows: readonly AvailabilityRow[] = result.actions ?? [];
      setFacts({
        common: rows.filter((row) => row.builtin).map(summaryOfAvailability),
        ridesAHit: new Set(rows.filter((row) => row.ridesAHit).map((row) => row.id))
      });
    });
    return () => {
      live = false;
    };
  }, [actorId, definition]);
  return facts;
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
  const facts = useServerActionFacts(actorId, definition);
  // A limited use is a structured effect the server resolves, so Action Surge and the like get a
  // targetless Use tap here too. Sneak Attack, a smite and the like are added to a hit instead, so they aren't
  // offered as a tap that would be refused.
  const actions = useMemo(
    () => [
      ...definition.actions
        .filter(
          (action) =>
            !facts.ridesAHit.has(action.id) &&
            (action.attack ||
              action.save ||
              action.damage.length > 0 ||
              action.uses !== undefined ||
              // A feature's heal (Second Wind); a spell's heal is cast from the spell list.
              (action.healing !== undefined && action.spellId === undefined))
        )
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
    [definition, extraActions, facts]
  );
  const hitExtras = definition.actions.filter(
    (action) => facts.ridesAHit.has(action.id) && action.spellId === undefined
  );
  const healingOf = (action: ContentActionSummary) => definition.actions.find((own) => own.id === action.id)?.healing;
  // A self heal (Second Wind) is a direct tap; a heal for others picks its targets first.
  const isTargetlessOwn = (action: ContentActionSummary) => {
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

  if (actions.length === 0 && facts.common.length === 0) return null;
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
          {hitExtras.length > 0 && (
            <p className="action-result-hint">
              {hitExtras.map((action) => action.name).join(", ")}: add {hitExtras.length === 1 ? "it" : "them"} to a hit
              on the attack's result, before you confirm it.
            </p>
          )}
          <CommonActionChips
            actions={facts.common}
            busy={busy}
            onUse={(action, targetless) => {
              setTargetingResult(null);
              if (targetless) resolveActionDirect(actorId, action.id, revision, onOutcome);
              else beginTargeting(action, actorId);
            }}
          />
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
