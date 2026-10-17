import { useEffect, useMemo, useRef, useState } from "react";
import { choosesAbility, type ActorDefinition, type ContentActionSummary } from "@vtt/domain";
import { read } from "../lib/command";
import { ActionResultHead, CheckOutcome, HealingOutcome } from "./ActionResultHead";
import { ActionRow } from "./ActionRow";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { actionSummaryParts } from "./action-summary";
import { AttackOutcome, AttackPreview } from "./AttackPreview";
import { CommonActionChips } from "./CommonActionChips";
import { ReadyChooser, readyableSpells } from "./ReadyChooser";
import { damageBreakdown } from "./format";
import { modeWords } from "./roll-mode-notes";
import { AskTheGmPrompt } from "./RuleAsk";
import { awaitsItsSpell, summaryOfAvailability, type AvailabilityRow } from "./useSheetDefinition";
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
import { foesFirst, type TargetRow } from "../table/targetRows";
import { revealInRegion } from "../lib/reveal";
import "./action-runner.css";

/** Maps a player's own stat-block action onto the ContentActionSummary the targeting store uses. An area spell keeps
 *  its area, so the player aims it on the map and the server decides who is under it. */
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
    area: action.area ?? null,
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
    ...(action.save?.conditionChoices ? { conditionChoices: [...action.save.conditionChoices] } : {}),
    // A cure that ends one condition of several asks which (Lesser Restoration).
    ...(action.endsOneCondition && action.endsConditions ? { conditionChoices: [...action.endsConditions] } : {}),
    ...(choosesAbility(action) ? { choosesAbility: true } : {}),
    // A heal for others picks its targets: one (Divine Spark's healing), or several for a divided pool.
    ...(action.healing && !action.healing.self
      ? { targeting: action.healing.divided ? ("multi" as const) : ("single" as const) }
      : {}),
    // So does a touch that ends a condition (Lay on Hands' cure).
    ...(action.endsConditions && !action.healing ? { targeting: "single" as const } : {})
  };
}

/** What the server lists for this character beyond its own rows: the generic actions it can take (with the Bonus
 *  Action forms its features give) and which of its rows are added to a hit and never taken alone. Read once per
 *  sheet; the server still decides each use. */
function useServerActionFacts(actorId: string, definition: ActorDefinition, effectsKey: string) {
  const [facts, setFacts] = useState<{
    common: readonly ContentActionSummary[];
    ridesAHit: ReadonlySet<string>;
    /** A spell's later actions whose spell isn't up, which aren't offered until it is. */
    awaiting: ReadonlySet<string>;
    /** The damage the server rolls for a row, where it differs (a spell's later action at the level it was cast). */
    damage: ReadonlyMap<string, ContentActionSummary["damage"]>;
  }>({ common: [], ridesAHit: new Set(), awaiting: new Set(), damage: new Map() });
  useEffect(() => {
    let live = true;
    void read("actor:available-actions", { actorId }).then((result) => {
      if (!live || !result.ok) return;
      const rows: readonly AvailabilityRow[] = result.actions ?? [];
      setFacts({
        common: rows.filter((row) => row.builtin).map(summaryOfAvailability),
        ridesAHit: new Set(rows.filter((row) => row.ridesAHit).map((row) => row.id)),
        awaiting: new Set(rows.filter(awaitsItsSpell).map((row) => row.id)),
        damage: new Map(rows.flatMap((row) => (row.damage ? [[row.id, row.damage] as const] : [])))
      });
    });
    return () => {
      live = false;
    };
  }, [actorId, definition, effectsKey]);
  return facts;
}

/**
 * A player's action console on their own turn, the counterpart of the GM's ActionRunner for their claimed
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
  targets,
  effectTags = [],
  unavailable,
  targetRows,
  insideNow
}: Readonly<{
  actorId: string;
  definition: ActorDefinition;
  /** Actions the server derived from the equipped loadout (a wand's charge, an amulet's cast); they are never in `definition.actions`. Numbers include item riders; resolution goes by id. */ extraActions?: readonly ContentActionSummary[];
  revision: number;
  /** The character holds Heroic Inspiration, which can reroll the attack's d20. */
  inspired?: boolean;
  playerDamageMode: "proposal" | "direct";
  targets: readonly { actorId: string; name: string }[];
  /** Each target as its token shows it, with its distance and the AC the player knows. */
  targetRows?: ReadonlyMap<string, TargetRow>;
  /** For an area: who it covers where it is placed now, of the creatures the player can see. */
  insideNow?: readonly TargetRow[];
  /** The tags of the character's effects, which bring forward a generic action that needs one (Put Out the Fire). */
  effectTags?: readonly string[];
  /** Why no action can be taken now ("unavailable while Unconscious"): the list stays in view, disabled. */
  unavailable?: string;
}>) {
  const [feedback, setFeedback] = useState("");
  const onFeedback = setFeedback;
  // The Ready action asks what is readied when a spell could be: a spell is cast now and held.
  const [readying, setReadying] = useState(false);
  const readySpells = readyableSpells(definition);
  const slotLevels = (definition.spellcasting?.slots ?? []).filter((slot) => slot.max > 0).map((slot) => slot.level);
  // Casting a spell, or its Concentration ending, changes which of its later actions are offered.
  const facts = useServerActionFacts(actorId, definition, effectTags.join(","));
  // A limited use is a structured effect the server resolves, so Action Surge and the like get a
  // targetless Use tap here too. Sneak Attack, a smite and the like are added to a hit instead, so they aren't
  // offered as a tap that would be refused.
  const actions = useMemo(
    () => [
      ...definition.actions
        .filter(
          (action) =>
            !facts.ridesAHit.has(action.id) &&
            !facts.awaiting.has(action.id) &&
            // What a spell's area does later is the server's or the GM's to run; a player's tap doesn't.
            !(action.activation === "other" && /^spell-.+-then-/.test(action.id)) &&
            (action.attack ||
              action.save ||
              action.damage.length > 0 ||
              action.uses !== undefined ||
              // A feature's heal (Second Wind); a spell's heal is cast from the spell list.
              (action.healing !== undefined && action.spellId === undefined))
        )
        .map(summaryOfOwnAction)
        .map((action) => {
          const rolled = facts.damage.get(action.id);
          return rolled && rolled.length === action.damage.length ? { ...action, damage: rolled } : action;
        }),
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
    [definition, extraActions, facts]
  );
  const hitExtras = definition.actions.filter(
    (action) => facts.ridesAHit.has(action.id) && action.spellId === undefined
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
  // The list gives way to the picker, the result or a refusal in place, and on a phone the list was scrolled down to
  // the tapped row, so the runner's top is brought back into view.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const shown = picking ? `pick:${picking.action.id}` : result ? `result:${result.actionName}` : feedback || null;
  useEffect(() => {
    if (shown) revealInRegion(rootRef.current, "nearest");
  }, [shown]);

  if (actions.length === 0 && facts.common.length === 0) return null;
  const onOutcome = (ok: boolean, message?: string) => {
    if (!ok && message) onFeedback(message);
  };

  return (
    <div className="action-runner player-actions" ref={rootRef}>
      {/* On Enforce the resolve suppresses its own message, so the refusal and the ask are shown here. */}
      <AskTheGmPrompt onFeedback={onFeedback} />
      {/* A refusal sits at the top, where the runner scrolls to: below a long list it went unseen. */}
      {feedback && (
        <p className="save-prompt-outcome" role="status">
          {feedback}
        </p>
      )}
      {!picking && !result && (
        <>
          <p className="player-actions-label">Your actions{unavailable && <span> · {unavailable}</span>}</p>
          <ul className="action-list">
            {actions.map((action) => (
              <li key={action.id}>
                <ActionRow
                  action={action}
                  parts={actionSummaryParts(action, actions)}
                  note={unavailable ? "Unavailable" : "Tap to use"}
                  disabled={busy || unavailable !== undefined}
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
            busy={busy || unavailable !== undefined}
            effectTags={effectTags}
            onUse={(action, targetless) => {
              setTargetingResult(null);
              if (action.id === "ready" && readySpells.length > 0) setReadying(true);
              else if (targetless) resolveActionDirect(actorId, action.id, revision, onOutcome);
              else beginTargeting(action, actorId);
            }}
          />
        </>
      )}
      {readying && (
        <ReadyChooser
          spells={readySpells}
          slotLevels={slotLevels}
          busy={busy}
          onClose={() => setReadying(false)}
          onReady={(spell) => {
            setReadying(false);
            if (spell)
              resolveActionDirect(actorId, spell.actionId, revision, onOutcome, undefined, {
                ...(spell.slotLevel !== undefined ? { slotLevel: spell.slotLevel } : {})
              });
            else resolveActionDirect(actorId, "ready", revision, onOutcome);
          }}
        />
      )}
      {picking && !result?.preview && (
        <ActionTargetPicker
          picking={picking}
          targets={foesFirst(
            targets
              // A heal may be for the healer too (a potion drunk, not handed over), and so may a touch that cures or
              // protects with no attack, save or damage (Lesser Restoration, Enhance Ability on the caster).
              .filter(
                (target) =>
                  target.actorId !== actorId ||
                  picking.action.healing != null ||
                  healingOf(picking.action) !== undefined ||
                  (picking.action.builtin !== true &&
                    picking.action.attackBonus === null &&
                    picking.action.saveAbility === null &&
                    picking.action.damage.length === 0)
              )
              .map(
                (target): Pick<TargetRow, "id" | "label"> & Partial<TargetRow> =>
                  targetRows?.get(target.actorId) ?? { id: target.actorId, label: target.name }
              ),
            "player-character",
            picking.action.healing != null || healingOf(picking.action) !== undefined
          )}
          onMap
          {...(insideNow ? { insideNow } : {})}
          busy={busy}
          onInvalidFace={onFeedback}
          onRoll={(face) => resolveTargeting(revision, onOutcome, face !== undefined ? { attackNatural: face } : {})}
        />
      )}
      {result && (
        <div className="action-result" role="status">
          <ActionResultHead result={result} />
          {/* Why the d20 had Advantage or Disadvantage: an attack's before the player confirms it, a check's (Hide in
              armor) with its total. */}
          {(result.attack || result.check) && result.rollMode && result.rollMode.mode !== "normal" && (
            <p className="action-rollmode">{modeWords(result.rollMode).replace(/^ · /, "")}</p>
          )}
          {result.attack && <AttackOutcome attack={result.attack} audience="player" />}
          {result.check && <CheckOutcome check={result.check} />}
          {result.effectGranted && (
            <p className="action-effect-granted">
              {definition.name} gains <strong>{result.effectGranted.name}</strong>.
            </p>
          )}
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
              Each target makes a DC {result.save.dc} {result.save.ability.toUpperCase()} save. The GM answers these.
            </p>
          )}
          {result.waitingOnReaction && result.attack && (
            <p className="action-save-note">
              Waiting on {result.attack.targetName}'s{" "}
              <strong>
                {result.reactionPrompts?.find((candidate) => candidate.actorId === result.attack!.targetId)
                  ?.actionName ?? "reaction"}
              </strong>
              . It may turn the hit into a miss, and the attack finishes when it is answered.
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
                  {result.crit ? " · crit dice doubled" : ""}
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
                    Waiting on {result.attack!.targetName}'s <strong>{reactionPrompt.actionName}</strong>. The damage
                    lands when it is answered.
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
    </div>
  );
}
