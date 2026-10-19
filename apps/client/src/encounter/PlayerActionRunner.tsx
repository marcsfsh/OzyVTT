import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  actionChoicesOf,
  choosesAbility,
  summonChoicesOf,
  type ActorDefinition,
  type ContentActionSummary
} from "@vtt/domain";
import type { CastShaping } from "@vtt/schemas";
import { command, read } from "../lib/command";
import { ActionList } from "../sheet/ActionList";
import { CastDetail } from "../sheet/CastDetail";
import { SheetDetail, type DetailPlace } from "../sheet/SheetDetail";
import { TurnCard } from "../sheet/TurnCard";
import { characterLevel, pinsOf, optionCountsOf, type SheetActor } from "../sheet/sheet-model";
import { castOptions, preparedState, type CastOption } from "../sheet/spell-model";
import { NO_FACTS, turnOptions, type TurnFacts, type TurnOption } from "../sheet/turn-options";
import { useSpellReference } from "./spells";
import { ActionResultHead, CheckOutcome, HealingOutcome } from "./ActionResultHead";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { AttackOutcome, AttackPreview } from "./AttackPreview";
import { DamageLook } from "./DamageLook";
import { CommonActionChips } from "./CommonActionChips";
import { ReadyChooser, readyableSpells } from "./ReadyChooser";
import { damageBreakdown } from "./format";
import { modeWords } from "./roll-mode-notes";
import { AskTheGmPrompt } from "./RuleAsk";
import { awaitsItsSpell, factsOf, summaryOfAvailability, type AvailabilityRow } from "../sheet/useSheetDefinition";
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
import { foesFirst, pickableTargets, type TargetRow } from "../table/targetRows";
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
    // A summon whose user picks the creature or its type (Find Familiar) asks before it resolves.
    ...(summonChoicesOf(action.summons) ? { summonChoices: summonChoicesOf(action.summons)! } : {}),
    // Bringing a creature aims at no one, unless it rises from a corpse or the cast also strikes (Spiritual Weapon).
    ...(action.summons && !action.summons.fromCorpse && !action.attack && !action.save && action.damage.length === 0
      ? { targeting: "none" as const }
      : {}),
    // What it asks for as it resolves; a self grant that asks is aimed at no one, so the pick comes before the tap.
    ...(actionChoicesOf(action) ? { choices: actionChoicesOf(action)! } : {}),
    ...(actionChoicesOf(action) && action.grants?.target === "self" ? { targeting: "none" as const } : {}),
    // A heal for others picks its targets: one (Divine Spark's healing), or several for a divided pool.
    ...(action.healing && !action.healing.self
      ? { targeting: action.healing.divided ? ("multi" as const) : ("single" as const) }
      : {}),
    // So does a touch that ends a condition (Lay on Hands' cure).
    ...(action.endsConditions && !action.healing ? { targeting: "single" as const } : {})
  };
}

/** A sheet's own action with what the server offers for it when it shape-shifts: the forms it may take, the effects
 *  it picks one of, and whom it aims at (Wild Shape at no one, leaving a form too). */
export function withShapeOffer(
  action: ContentActionSummary,
  row: ContentActionSummary | undefined
): ContentActionSummary {
  // The action a form adds to leave it early (its id is the server's).
  const leaving = action.id === "leave-form";
  if (!row || (!row.forms && !row.options && !leaving)) return action;
  return {
    ...action,
    ...(row.forms ? { forms: row.forms } : {}),
    ...(row.options ? { options: row.options } : {}),
    ...(row.targeting && action.targeting === undefined ? { targeting: row.targeting } : {})
  };
}

/** What the server lists for this character beyond its own rows: the generic actions it can take (with the Bonus
 *  Action forms its features give), which of its rows are added to a hit, which wait for their spell, and why any
 *  can't be used now. Read once per sheet; the server still decides each use. */
function useServerActionFacts(actorId: string, definition: ActorDefinition, effectsKey: string) {
  const [facts, setFacts] = useState<TurnFacts & { common: readonly ContentActionSummary[] }>({
    ...NO_FACTS,
    common: []
  });
  useEffect(() => {
    let live = true;
    void read("actor:available-actions", { actorId }).then((result) => {
      if (!live || !result.ok) return;
      const rows: readonly AvailabilityRow[] = result.actions ?? [];
      setFacts({
        common: rows.filter((row) => row.builtin).map(summaryOfAvailability),
        rows: new Map(rows.filter((row) => !row.builtin).map((row) => [row.id, summaryOfAvailability(row)])),
        ridesAHit: new Set(rows.filter((row) => row.ridesAHit).map((row) => row.id)),
        awaiting: new Set(rows.filter(awaitsItsSpell).map((row) => row.id)),
        reasons: new Map(
          rows.flatMap((row) => {
            const why = factsOf(row).reason;
            return why ? [[row.id, why] as const] : [];
          })
        ),
        passive: new Set(rows.filter((row) => row.passive !== undefined).map((row) => row.id)),
        mastery: new Map(rows.flatMap((row) => (row.mastery ? [[row.id, row.mastery.name] as const] : [])))
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
  insideNow,
  actor = null,
  myTurn = true,
  offTurn = false,
  header,
  pickOnly,
  castPlace = { kind: "inline" },
  look = "list",
  round = null,
  acting = null,
  turnTitle,
  pinnable = true
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
  /** The live character, for its spell slots, prepared spells and uses left. */
  actor?: SheetActor | null;
  /** The character acts now; off its turn the list stays in view and only reactions are live. */
  myTurn?: boolean;
  /** It acts off its own turn (a readied spell or action), so a result it gets stays until its player closes it. */
  offTurn?: boolean;
  /** What sits above the list (the economy on the sheet's own Play tab). */
  header?: ReactNode;
  /** Only the aim and its result, for a use started from another tab of the sheet; Done closes it. */
  pickOnly?: Readonly<{ onDone: () => void }>;
  /** Where a spell's cast detail opens: in place of the list, or the sheet's right column on a laptop. */
  castPlace?: DetailPlace;
  /** "card": a phone's turn card with favourite tiles; "list": every option grouped by what it costs. */
  look?: "list" | "card";
  /** The fight's round, and who acts off this character's turn, for the turn card's heading. */
  round?: number | null;
  acting?: string | null;
  /** The turn card's heading when the turn isn't the character's own (a creature its character commands). */
  turnTitle?: string;
  /** Whether the player may pin favourites on this card: only on their own character. */
  pinnable?: boolean;
}>) {
  const [feedback, setFeedback] = useState("");
  const onFeedback = setFeedback;
  // The Ready action asks what is readied when a spell could be: a spell is cast now and held.
  const [readying, setReadying] = useState(false);
  const readySpells = readyableSpells(definition);
  const slotLevels = (definition.spellcasting?.slots ?? []).filter((slot) => slot.max > 0).map((slot) => slot.level);
  // Casting a spell, or its Concentration ending, changes which of its later actions are offered.
  const facts = useServerActionFacts(actorId, definition, effectTags.join(","));
  const spellReference = useSpellReference();
  const spellIndex = useMemo(() => new Map(spellReference.map((entry) => [entry.id, entry])), [spellReference]);
  const ownSummaries = useMemo(
    () => new Map(definition.actions.map((action) => [action.id, summaryOfOwnAction(action)])),
    [definition]
  );
  // A limited use is a structured effect the server resolves, so Action Surge and the like get a targetless tap
  // here too. Sneak Attack, a smite and the like are added to a hit instead, so they aren't offered as a tap that
  // would be refused.
  const options = useMemo(
    () =>
      turnOptions({
        definition,
        actor,
        ownSummaries,
        // The loadout's rows (a weapon's swing, a wand's charge) from the caller, else from the server's own read.
        extraActions:
          extraActions.length > 0
            ? extraActions
            : [...facts.rows.values()].filter((row) => !definition.actions.some((own) => own.id === row.id)),
        facts,
        spellReference: spellIndex,
        characterLevel: characterLevel(definition) ?? 1
      }),
    [definition, actor, ownSummaries, extraActions, facts, spellIndex]
  );
  /** Every option the picker can be handed, the spells' later rows included. */
  const actions = useMemo(
    () => options.flatMap((option) => [option.summary, ...option.children.map((child) => child.summary)]),
    [options]
  );
  /** A spell waiting for its slot to be chosen. */
  const [casting, setCasting] = useState<TurnOption | null>(null);
  const hitExtras = definition.actions.filter(
    (action) => facts.ridesAHit.has(action.id) && action.spellId === undefined
  );
  const healingOf = (action: ContentActionSummary) => definition.actions.find((own) => own.id === action.id)?.healing;
  // A self heal (Second Wind) is a direct tap; a heal for others picks its targets first. An item's action carries the
  // server's word on it (a scroll of Detect Magic is a tap, a potion picks its drinker).
  const isTargetlessOwn = (action: ContentActionSummary) => {
    // A summon with a creature to pick asks for it first.
    if (action.summonChoices) return false;
    // A pick comes first (Fire Shield's warm or chill, the weapon Magic Weapon is cast on).
    if (action.choices) return false;
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
  // The turn moved on: what was being aimed on it goes, as when the runner was mounted only for the turn. A result got
  // off the turn (a readied spell released, which ends the Ready) stays until its player closes it.
  const wasMyTurn = useRef(myTurn);
  const resultOffTurn = useRef(false);
  const offTurnNow = useRef(offTurn);
  offTurnNow.current = offTurn;
  // Whether the result in view arrived off the turn, read when it arrives.
  useEffect(() => {
    resultOffTurn.current = result !== null && offTurnNow.current;
  }, [result]);
  useEffect(() => {
    if (wasMyTurn.current && !myTurn) {
      clearTargeting();
      if (!resultOffTurn.current) setTargetingResult(null);
    }
    wasMyTurn.current = myTurn;
  }, [myTurn]);
  // The list gives way to the picker, the result or a refusal in place, and on a phone the list was scrolled down to
  // the tapped row, so the runner's top is brought back into view.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const shown = picking ? `pick:${picking.action.id}` : result ? `result:${result.actionName}` : feedback || null;
  useEffect(() => {
    if (shown) revealInRegion(rootRef.current, "nearest");
  }, [shown]);
  // A cast in place takes the card's place and Back gives the card back. The list may have been scrolled down to the
  // tapped option, so the top of whichever shows comes back into view.
  const castingId = casting?.id ?? null;
  const castSeen = useRef(castingId);
  useEffect(() => {
    if (castSeen.current === castingId) return;
    castSeen.current = castingId;
    if (castPlace.kind === "inline") revealInRegion(rootRef.current, "nearest");
  }, [castingId, castPlace.kind]);

  if (actions.length === 0 && facts.common.length === 0) return null;
  const onOutcome = (ok: boolean, message?: string) => {
    if (!ok && message) onFeedback(message);
  };
  /** A tap on an option: one with nothing to aim resolves at once; the rest go to targeting. */
  const take = (
    action: ContentActionSummary,
    slotLevel?: number,
    darts?: number,
    shaping: readonly CastShaping[] = []
  ) => {
    const shaped = withShapeOffer(action, facts.rows.get(action.id));
    // A shape-shift picks its form first (Wild Shape), and Enlarge/Reduce its effect.
    if (!shaped.forms && !shaped.options && isTargetlessOwn(shaped))
      resolveActionDirect(actorId, action.id, revision, onOutcome, undefined, undefined, {
        ...(slotLevel !== undefined ? { slotLevel } : {}),
        ...(shaping.length > 0 ? { shaping } : {})
      });
    else beginTargeting(shaped, actorId, slotLevel, darts, shaping);
  };
  /** The ways a spell option can be cast now. The fight's own rules decide; the list only offers what it can. */
  const castChoices = (option: TurnOption): CastOption[] =>
    option.spell && actor
      ? castOptions({
          spell: option.spell,
          definition,
          actor,
          content: spellIndex.get(option.spell.id),
          policeSlots: false,
          prepared: preparedState(option.spell, actor, definition) !== "unprepared"
        })
      : [];
  /** Casts a spell option the chosen way: at a slot level (Magic Missile's darts grow with it), without a slot, or
   *  as a Ritual, shaped as its caster chose (Metamagic). */
  const castWith = (option: TurnOption, choice: CastOption, shaping: readonly CastShaping[] = []) => {
    const spell = option.spell!;
    const variant =
      choice.kind === "free" ? spell.freeActionId : choice.kind === "ritual" ? spell.ritualActionId : undefined;
    if (variant) {
      const summary = ownSummaries.get(variant);
      if (summary) take(summary, undefined, undefined, shaping);
      return;
    }
    const own = definition.actions.find((candidate) => candidate.id === option.id);
    const darts =
      own?.darts !== undefined && own.spellSlot && choice.kind === "slot"
        ? own.darts + Math.max(0, choice.level - own.spellSlot.level)
        : undefined;
    take(option.summary, choice.kind === "slot" ? choice.level : undefined, darts, shaping);
  };

  /** The turn card's pins, stored on the character; the server checks each is one of its options now. */
  const setPins = (ids: readonly string[]) =>
    void command("character:set-favourites", { actorId, optionIds: [...ids] }).then((reply) => {
      if (!reply.ok) onFeedback(reply.message ?? "The favourites could not be saved.");
    });
  /** A tap on an option: a spell with a choice of slot opens its cast detail, the rest go at once. */
  const pickOption = (option: TurnOption) => {
    setTargetingResult(null);
    const choices = option.spell ? castChoices(option) : [];
    // A spell its caster may shape (Metamagic) opens its cast, where the options are offered.
    const shapeable = (option.summary.shaping?.options.length ?? 0) > 0;
    if (option.spell && (choices.length > 1 || shapeable || (choices.length === 1 && !choices[0]!.available))) {
      setCasting(option);
      return;
    }
    if (option.spell && choices.length === 1) {
      castWith(option, choices[0]!);
      return;
    }
    take(option.summary);
  };
  const castDetail =
    casting && casting.spell ? (
      <CastDetail
        spell={casting.spell}
        action={casting.summary}
        content={spellIndex.get(casting.spell.id)}
        options={castChoices(casting)}
        aimed
        busy={busy}
        onBack={() => setCasting(null)}
        onCast={(choice, shaping) => {
          setCasting(null);
          castWith(casting, choice, shaping);
        }}
      />
    ) : null;

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
      {!pickOnly && !picking && !result && casting && casting.spell && castPlace.kind === "inline" && castDetail}
      {!pickOnly && !picking && !result && (!casting || castPlace.kind !== "inline") && (
        <>
          {look === "card" ? (
            <TurnCard
              options={options}
              myTurn={myTurn}
              round={round}
              acting={acting}
              {...(turnTitle ? { title: turnTitle } : {})}
              busy={busy}
              {...(unavailable ? { unavailable } : {})}
              header={header}
              pins={pinsOf(actor)}
              counts={optionCountsOf(actor)}
              {...(actor && pinnable ? { onSetPins: setPins } : {})}
              onUse={pickOption}
            />
          ) : (
            <>
              {header}
              <ActionList
                options={options}
                myTurn={myTurn}
                busy={busy}
                {...(unavailable ? { unavailable } : {})}
                onUse={pickOption}
              />
            </>
          )}
          {hitExtras.length > 0 && (
            <p className="action-result-hint">
              {hitExtras.map((action) => action.name).join(", ")}: add {hitExtras.length === 1 ? "it" : "them"} to a hit
              on the attack's result, before you confirm it.
            </p>
          )}
          {casting && castDetail && castPlace.kind !== "inline" && (
            <SheetDetail place={castPlace} title={`Cast ${casting.name}`} onClose={() => setCasting(null)}>
              {castDetail}
            </SheetDetail>
          )}
          <CommonActionChips
            actions={facts.common}
            busy={busy || unavailable !== undefined || !myTurn}
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
          targets={pickableTargets(
            foesFirst(
              targets
                // A heal may be for the healer too (a potion the healer drinks), and so may a touch that cures or
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
            ),
            picking.action,
            picking.action.spellId !== undefined ? spellIndex.get(picking.action.spellId) : undefined
          )}
          onMap
          {...(insideNow ? { insideNow } : {})}
          carried={actor?.inventory ?? []}
          busy={busy}
          onInvalidFace={onFeedback}
          onRoll={(face) => resolveTargeting(revision, onOutcome, face !== undefined ? { attackNatural: face } : {})}
          {...(picking.action.damageLook && picking.action.attackBonus === null
            ? { onLookAtDamage: () => resolveTargeting(revision, onOutcome, { damageLook: true }) }
            : {})}
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
              knockOutOffered={result.knockOut === "offered"}
              look={result}
              resolve={(options) => resolveTargeting(revision, onOutcome, options)}
            />
          )}
          {/* A spell's damage looked at before the cast lands (Empowered Spell, Heroic Inspiration). */}
          {result.preview && !result.attack && result.heldDamage && (
            <DamageLook
              result={result}
              look={result.heldDamage}
              busy={busy}
              confirmLabel="Confirm"
              onAnswer={(id, dice) =>
                resolveTargeting(revision, onOutcome, { damageLook: true, damageAnswer: { id, dice } })
              }
              onConfirm={() => resolveTargeting(revision, onOutcome, { commit: true })}
            />
          )}
          {result.save && (
            <p className="action-outcome">
              Each target makes a DC {result.save.dc} {result.save.ability.toUpperCase()} save. The GM answers these.
            </p>
          )}
          {result.waitingOnReaction &&
            result.attack &&
            (() => {
              const prompt = result.reactionPrompts?.find((candidate) => candidate.actorId === result.attack!.targetId);
              // Another creature's answer to the roll (Cutting Words) is not named: it may be one the player can't see.
              return prompt ? (
                <p className="action-save-note">
                  Waiting on {result.attack.targetName}'s <strong>{prompt.actionName}</strong>. It may turn the hit into
                  a miss, and the attack finishes when it is answered.
                </p>
              ) : (
                <p className="action-save-note">
                  Waiting on an answer to the attack roll. The attack finishes when it is answered.
                </p>
              );
            })()}
          {result.damage.length > 0 &&
            !result.preview &&
            (() => {
              const breakdown = damageBreakdown(result);
              return (
                <p className="action-damage">
                  Damage: <strong>{result.damageTotal}</strong>
                  {breakdown ? ` (${breakdown})` : ""}
                  {result.crit ? " · a Critical Hit, its dice doubled" : ""}
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
                (candidate) => candidate.holdsDamage || candidate.actorId === result.attack!.targetId
              );
              if (reactionPrompt)
                return reactionPrompt.actorId === result.attack!.targetId ? (
                  <p className="action-save-note">
                    Waiting on {result.attack!.targetName}'s <strong>{reactionPrompt.actionName}</strong>. The damage
                    lands when it is answered.
                  </p>
                ) : (
                  <p className="action-save-note">
                    Waiting on an answer to the damage roll. The damage lands when it is answered.
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
          {pickOnly && !result.preview && (
            <button type="button" className="action-again" onClick={pickOnly.onDone}>
              Done
            </button>
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
