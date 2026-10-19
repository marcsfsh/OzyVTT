import { useSyncExternalStore } from "react";
import type {
  AbilityId,
  ActionResolution,
  AnnotationPoint,
  AnnotationShapeKind,
  AskableCommand,
  ContentActionSummary,
  HitOptionChoice,
  RulesBlocked
} from "@vtt/domain";
import type { CastShaping } from "@vtt/schemas";
import { command } from "../lib/command";
import { newId } from "../lib/ids";

/**
 * Shared targeting state, so both action runners and the map agree on the action, targets and
 * template. Resolution stays on the server's `action:resolve`; this only coordinates UX.
 */
export type TargetingTemplate = Readonly<{
  shape: AnnotationShapeKind;
  sizeFeet: number;
  widthFeet: number | null;
  placed: Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }> | null;
  /** How many areas one use places (Fire Storm's ten Cubes), and the ones already set down beside the one moving. */
  count?: number;
  others?: ReadonlyArray<Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>>;
}>;
export type TargetingSession = Readonly<
  {
    action: ContentActionSummary;
    attackerId: string;
    /** "none": no target to pick (Search, Study), only the skill it is made with. */
    mode: "single" | "multi" | "template" | "none";
    selected: readonly string[];
    template: TargetingTemplate | null;
    /** The spell slot a spell is cast with, sent with every resolve of this session. */
    slotLevel?: number;
    /** How much of its pool an action whose user picks the cost spends (Lay on Hands' points). */
    spend?: number;
    /** The conditions a touch also ends, each for points of its pool (Restoring Touch). */
    conditionIds?: readonly string[];
    /** The Hit Points each target takes of a pool its user divides (Preserve Life); absent, the server splits evenly. */
    healingShares?: Readonly<Record<string, number>>;
    /** A darts action's darts (Magic Missile at this slot) and how many each selected target takes. */
    darts?: Readonly<{ total: number; counts: Readonly<Record<string, number>> }>;
    /** The damage type picked for an action whose caster chooses one (Chromatic Orb). */
    damageType?: NonNullable<ContentActionSummary["damageTypes"]>[number];
    /** The skill a check action is made with (Search, Influence); absent, Escape a Grapple uses the better one. */
    skill?: string;
    /** The ability a cast chooses (Hex); it is not rolled until one is chosen. */
    ability?: AbilityId;
    /** The condition picked for a failed save whose caster chooses one (Blindness/Deafness); absent, the first. */
    conditionId?: string;
    /** The option picked for an action that offers several (Fire Shield's warm or chill); it starts on the first. */
    optionId?: string;
    /** The option picked for each target, for an action that asks for one per target (Eyebite). */
    targetOptions?: Readonly<Record<string, string>>;
    /** The carried weapon a grant binds to (Magic Weapon, Shillelagh). */
    itemId?: string;
    /** The target's armor or weapon the action acts on (a rust monster's Antennae); absent, the server's default. */
    objectItemId?: string;
    /** The GM places a spell's lingering area and resolves no action: the zone it is for. */
    placeZoneId?: string;
    /** How the caster shapes the cast (Metamagic, Sculpt Spells), with the creatures each pick names once chosen. */
    shaping?: readonly CastShaping[];
    /** The creature a summon brings, and its creature type, where its user picks (Find Familiar's form). */
    summonPick?: Readonly<{ monsterId: string; form?: string }>;
    summonType?: string;
  } & ShapeChoice
>;

/** What a shape-shifting use picks: its form (Wild Shape's Wolf) or each target's own (Animal Shapes), whether the
 *  user's gear melds into the form or is worn, and which of its effects it takes (Enlarge or Reduce). */
export type ShapeChoice = Readonly<{
  form?: string;
  targetForms?: Readonly<Record<string, string>>;
  gear?: "merged" | "worn";
  option?: string;
}>;

/** The picks a shape-shift starts with: its one form when it has only one, gear melded, and the first effect. */
export function startingShapeChoice(action: ContentActionSummary): ShapeChoice {
  const forms = action.forms;
  const only = forms && !forms.perTarget && forms.options.length === 1 ? forms.options[0] : undefined;
  return {
    ...(only ? { form: only.id } : {}),
    ...(forms?.gearChoice ? { gear: "merged" as const } : {}),
    ...(action.options && action.options.length > 0 ? { option: action.options[0]!.id } : {})
  };
}

/** Whether a shape-shift still waits for its form: one form, or one for each chosen target. */
export function formUnchosen(action: ContentActionSummary, choice: ShapeChoice, targetIds: readonly string[]): boolean {
  const forms = action.forms;
  if (!forms || forms.options.length === 0) return false;
  if (forms.perTarget) return targetIds.some((id) => choice.targetForms?.[id] === undefined);
  return choice.form === undefined;
}

/** The picks as `action:resolve` and `action:use` take them, for the targets chosen. */
export function shapeChoicePayload(choice: ShapeChoice, targetIds: readonly string[]) {
  const perTarget = Object.entries(choice.targetForms ?? {}).filter(([id]) => targetIds.includes(id));
  return {
    ...(choice.form !== undefined ? { form: choice.form } : {}),
    ...(perTarget.length > 0 ? { targetForms: perTarget.map(([targetId, form]) => ({ targetId, form })) } : {}),
    ...(choice.gear !== undefined ? { gear: choice.gear } : {}),
    ...(choice.option !== undefined ? { option: choice.option } : {})
  };
}

let session: TargetingSession | null = null;
let result: ActionResolution | null = null;
/** The previewed attack's die was typed from a physical die, so its reroll is typed too. */
let typedPreview = false;
let busy = false;
/** A strict-mode rejection awaiting the GM's call (ADR-0020); here so any surface can show the dialog. */
let blockedPrompt: {
  blocked: RulesBlocked;
  retry: (override: { reason: string }) => void;
  /**
   * The refused command as sent, so a player can ask the GM to allow it (`rules:ask`). Always the
   * committing form: replaying an attack preview would roll a d20 and apply nothing.
   */
  asked: { type: AskableCommand; payload: unknown };
} | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function beginTargeting(
  action: ContentActionSummary,
  attackerId: string,
  slotLevel?: number,
  dartsAtSlot?: number,
  shaping?: readonly CastShaping[]
) {
  const area = action.area;
  const dartTotal = dartsAtSlot ?? action.darts;
  // A check action starts on its usual skill; Escape a Grapple starts on the better of its two, the server's pick.
  const usualSkill = action.id === "escape-grapple" ? undefined : action.checkSkills?.[0]?.id;
  const slot = {
    ...(slotLevel !== undefined ? { slotLevel } : {}),
    ...(shaping && shaping.length > 0 ? { shaping } : {}),
    ...(dartTotal !== undefined ? { darts: { total: dartTotal, counts: {} } } : {}),
    ...(usualSkill !== undefined ? { skill: usualSkill } : {}),
    // A picked cost starts at one; the picker raises it.
    ...(action.useCost === "chosen" ? { spend: 1 } : {}),
    // An option starts on the first, as the server reads none.
    ...(action.choices?.options?.[0] ? { optionId: action.choices.options[0].id } : {}),
    ...startingShapeChoice(action)
  };
  if (area) {
    // Map the SRD area shape onto a drawable annotation shape (sphere/cylinder/emanation → circle, cube → square).
    const shape: AnnotationShapeKind =
      area.shape === "sphere" || area.shape === "cylinder" || area.shape === "emanation"
        ? "circle"
        : area.shape === "cube"
          ? "square"
          : area.shape;
    session = {
      action,
      attackerId,
      mode: "template",
      selected: [],
      template: {
        shape,
        // A higher slot grows the area where the spell says so (Fog Cloud), as the server will place it.
        sizeFeet: Math.min(
          1000,
          area.sizeFeet +
            (slotLevel !== undefined && action.areaPerSlot
              ? action.areaPerSlot.feet * Math.max(0, slotLevel - action.areaPerSlot.level)
              : 0)
        ),
        widthFeet: area.widthFeet,
        placed: null,
        ...(area.count !== undefined ? { count: area.count, others: [] } : {})
      },
      ...slot
    };
  } else {
    // An attack lands on exactly one target; single-target builtins (Help, Unarmed Strike) too;
    // a save / pure-damage action can hit many.
    session = {
      action,
      attackerId,
      mode:
        action.attackBonus !== null || action.targeting === "single"
          ? "single"
          : action.targeting === "none"
            ? "none"
            : "multi",
      selected: [],
      template: null,
      ...slot
    };
  }
  result = null;
  typedPreview = false;
  emit();
}
/** The GM places (or moves) a spell's lingering area: the same template placement, sent as `spell-zone:place`. */
export function beginZonePlacement(
  zone: Readonly<{ id: string; name: string; casterId: string; area: ContentActionSummary["area"] }>
) {
  if (!zone.area) return;
  beginTargeting(
    {
      id: `spell-zone-${zone.id}`,
      name: `${zone.name} area`,
      activation: "other",
      description: "",
      attackBonus: null,
      reachFeet: null,
      rangeFeet: null,
      rangeNormalFeet: null,
      saveAbility: null,
      saveDc: null,
      damage: [],
      area: zone.area,
      attackCount: null,
      usesLimit: null,
      usesPer: null,
      usesRecharge: null,
      usesPool: null,
      requiresEffectTag: null,
      multiattack: null,
      grants: false,
      reaction: null
    },
    zone.casterId
  );
  if (session) session = { ...session, placeZoneId: zone.id };
  emit();
}
export function toggleTarget(actorId: string) {
  if (!session || session.mode === "template" || session.mode === "none") return;
  const dropping = session.selected.includes(actorId);
  session =
    session.mode === "single"
      ? { ...session, selected: session.selected[0] === actorId ? [] : [actorId] }
      : {
          ...session,
          selected: dropping ? session.selected.filter((id) => id !== actorId) : [...session.selected, actorId]
        };
  if (session.darts) {
    const { [actorId]: _dropped, ...counts } = session.darts.counts;
    session = { ...session, darts: { ...session.darts, counts: dropping ? counts : { ...counts, [actorId]: 1 } } };
  }
  // A creature no longer targeted is no longer one the cast's shaping names.
  if (session.shaping && (dropping || session.mode === "single")) {
    const kept = session.selected;
    session = {
      ...session,
      shaping: session.shaping.map((entry) =>
        entry.creatureIds ? { ...entry, creatureIds: entry.creatureIds.filter((id) => kept.includes(id)) } : entry
      )
    };
  }
  emit();
}
/** Picks the damage type an action deals, for one whose caster chooses (Chromatic Orb). */
export function setDamageType(damageType: string) {
  const picked = session?.action.damageTypes?.find((type) => type === damageType);
  if (!session || picked === undefined) return;
  session = { ...session, damageType: picked };
  emit();
}
/** Picks the creature a summon brings, by its place in the action's choices. */
export function setSummonPick(index: number) {
  const picked = session?.action.summonChoices?.forms?.[index];
  if (!session || !picked) return;
  session = { ...session, summonPick: { monsterId: picked.monsterId, ...(picked.form ? { form: picked.form } : {}) } };
  emit();
}
/** Picks the creature type a summon takes (a familiar's Celestial, Fey or Fiend). */
export function setSummonType(creatureType: string) {
  if (!session?.action.summonChoices?.creatureTypes?.includes(creatureType)) return;
  session = { ...session, summonType: creatureType };
  emit();
}
/** Picks the condition a failed save imposes, for an action whose caster chooses one (Blindness/Deafness). */
export function setConditionChoice(conditionId: string) {
  if (!session?.action.conditionChoices?.includes(conditionId)) return;
  session = { ...session, conditionId };
  emit();
}
/** Picks the option an action resolves with (Fire Shield's chill shield); with a target, that target's own. */
export function setChoiceOption(optionId: string, targetId?: string) {
  if (!session?.action.choices?.options?.some((option) => option.id === optionId)) return;
  session =
    targetId === undefined
      ? { ...session, optionId }
      : { ...session, targetOptions: { ...session.targetOptions, [targetId]: optionId } };
  emit();
}
/** Picks the carried weapon a grant binds to; undefined leaves it to the server (the first that fits). */
export function setBoundItem(itemId: string | undefined) {
  if (!session?.action.choices?.bindsWeapon) return;
  const { itemId: _previous, ...rest } = session;
  session = itemId === undefined ? rest : { ...rest, itemId };
  emit();
}
/** Picks the target's armor or weapon the action acts on; undefined leaves it to the server (worn armor first). */
export function setObjectItem(objectItemId: string | undefined) {
  if (!session?.action.choices?.object) return;
  const { objectItemId: _previous, ...rest } = session;
  session = objectItemId === undefined ? rest : { ...rest, objectItemId };
  emit();
}
/** Picks the skill a check action is made with; undefined lets Escape a Grapple use the better one. */
export function setCheckSkill(skill: string | undefined) {
  if (!session) return;
  if (skill !== undefined && !session.action.checkSkills?.some((entry) => entry.id === skill)) return;
  const { skill: _previous, ...rest } = session;
  session = skill === undefined ? rest : { ...rest, skill };
  emit();
}
/** Picks a shape-shift's form, or one target's own when each takes its own (Animal Shapes). */
export function setShapeForm(form: string, targetId?: string) {
  if (!session?.action.forms?.options.some((option) => option.id === form)) return;
  session =
    targetId === undefined
      ? { ...session, form }
      : { ...session, targetForms: { ...(session.targetForms ?? {}), [targetId]: form } };
  emit();
}
/** Picks whether the user's gear melds into the form or is worn by it. */
export function setShapeGear(gear: "merged" | "worn") {
  if (!session?.action.forms?.gearChoice) return;
  session = { ...session, gear };
  emit();
}
/** Picks which of its effects a use takes (Enlarge or Reduce). */
export function setEffectOption(option: string) {
  if (!session?.action.options?.some((entry) => entry.id === option)) return;
  session = { ...session, option };
  emit();
}
/** Picks the ability a cast chooses (Hex). */
export function setChosenAbility(ability: AbilityId) {
  if (!session?.action.choosesAbility) return;
  session = { ...session, ability };
  emit();
}
/** The picks of a cast's shaping that name creatures among its targets: Careful Spell's and Sculpt Spells' protected
 *  creatures, and Heightened Spell's one target when the spell has several. */
export const SHAPING_CREATURE_PICKS: ReadonlySet<string> = new Set([
  "careful-spell",
  "sculpt-spells",
  "heightened-spell"
]);

/** Chooses the creatures one of the cast's shaping picks names; the server checks how many and whom. */
export function setShapingCreatures(id: CastShaping["id"], creatureIds: readonly string[]) {
  if (!session?.shaping?.some((entry) => entry.id === id)) return;
  session = {
    ...session,
    shaping: session.shaping.map((entry) => (entry.id === id ? { ...entry, creatureIds: [...creatureIds] } : entry))
  };
  emit();
}

/** Whether a shaping pick still has creatures to choose: protected creatures, or Heightened Spell's target among
 *  several. */
const shapingUnchosen = (picking: TargetingSession) =>
  (picking.shaping ?? []).some(
    (entry) =>
      SHAPING_CREATURE_PICKS.has(entry.id) &&
      (entry.creatureIds ?? []).length === 0 &&
      !(entry.id === "heightened-spell" && picking.mode === "single")
  );

/** Whether the session has what its Roll needs: its targets or placed area, a chosen ability for a cast that takes
 *  one, and the creatures its shaping names. */
export function targetingReady(picking: TargetingSession): boolean {
  if (picking.action.choosesAbility && picking.ability === undefined) return false;
  if (shapingUnchosen(picking)) return false;
  if (formUnchosen(picking.action, picking, picking.selected)) return false;
  // A chosen cost of nothing spends nothing (Restoring Touch with no Hit Points and no condition picked).
  if (picking.action.useCost === "chosen" && picking.spend === 0 && (picking.conditionIds ?? []).length === 0)
    return false;
  // A divided pool can't give out more than it holds.
  if (picking.action.dividesHealing !== undefined && sharedOut(picking) > picking.action.dividesHealing) return false;
  if (picking.mode === "template") return Boolean(picking.template?.placed);
  if (picking.mode === "none") return true;
  return picking.selected.length > 0;
}
/** The Hit Points of a divided pool given to the creatures still selected (Preserve Life). */
export const sharedOut = (picking: TargetingSession): number =>
  picking.selected.reduce((sum, id) => sum + (picking.healingShares?.[id] ?? 0), 0);
/** Sets how many darts a selected target takes, within the darts the action has left to assign. */
export function setTargetDarts(actorId: string, count: number) {
  if (!session?.darts || !session.selected.includes(actorId)) return;
  const others = Object.entries(session.darts.counts)
    .filter(([id]) => id !== actorId)
    .reduce((sum, [, taken]) => sum + taken, 0);
  const next = Math.max(1, Math.min(session.darts.total - others, count));
  session = { ...session, darts: { ...session.darts, counts: { ...session.darts.counts, [actorId]: next } } };
  emit();
}
/** The targets as the server reads darts: each named once per dart it takes. */
const dartTargetIds = (selected: readonly string[], darts: TargetingSession["darts"]) =>
  darts ? selected.flatMap((id) => Array.from({ length: darts.counts[id] ?? 1 }, () => id)) : [...selected];
/** Sets the placed area down beside the others, and starts another (Fire Storm's next Cube). */
export function placeAnotherTemplate() {
  const template = session?.template;
  if (!session || !template?.placed) return;
  const others = [...(template.others ?? []), template.placed];
  if (others.length >= (template.count ?? 1)) return;
  session = { ...session, template: { ...template, others, placed: null } };
  emit();
}
export function setTemplatePlacement(origin: AnnotationPoint, target: AnnotationPoint) {
  if (session?.template) {
    session = { ...session, template: { ...session.template, placed: { origin, target } } };
    emit();
  }
}
/** How much of its pool the action being targeted spends (Lay on Hands' points). */
export function setTargetingSpend(spend: number) {
  if (!session || session.action.useCost !== "chosen") return;
  session = { ...session, spend };
  emit();
}
/** Picks or drops a condition the touch also ends (Restoring Touch). */
export function toggleConditionPick(conditionId: string) {
  if (!session?.action.conditionPicks?.conditions.includes(conditionId)) return;
  const picked = session.conditionIds ?? [];
  session = {
    ...session,
    conditionIds: picked.includes(conditionId) ? picked.filter((id) => id !== conditionId) : [...picked, conditionId]
  };
  emit();
}
/** The Hit Points one target takes of a pool its user divides (Preserve Life). */
export function setHealingShare(targetId: string, points: number) {
  if (!session || session.action.dividesHealing === undefined) return;
  session = { ...session, healingShares: { ...session.healingShares, [targetId]: Math.max(0, points) } };
  emit();
}
export function clearTargeting() {
  if (session !== null || blockedPrompt !== null) {
    session = null;
    blockedPrompt = null;
    emit();
  }
}
export function setTargetingResult(next: ActionResolution | null) {
  result = next;
  if (next === null) typedPreview = false;
  emit();
}
export function clearBlockedPrompt() {
  if (blockedPrompt !== null) {
    blockedPrompt = null;
    emit();
  }
}

/**
 * Resolves the current session through `action:resolve`. A rules-mode rejection (ADR-0020) exposes
 * `blocked` so the caller can offer the audited override, which keeps the same targets.
 */
export type ResolveOptions = Readonly<{
  override?: { reason: string };
  /** false previews the attack roll (no apply); the confirming call passes commit:true. Attacks default to preview. */
  commit?: boolean;
  /** The GM's forced Advantage or Disadvantage for the attack d20; the server ignores a player's. */
  rollMode?: "advantage" | "disadvantage" | "normal";
  /** The face a physical d20 shows, used in place of the server's throw. */
  attackNatural?: number;
  /** Throw the previewed d20 again: Heroic Inspiration for a player, free for the GM. */
  reroll?: boolean;
  /** How far Push mastery shoves on the confirmed hit (0 declines); absent pushes the full distance. */
  pushFeet?: number;
  /** Extras the confirmed hit carries (Sneak Attack, a smite), from the preview's offers. */
  hitOptions?: readonly HitOptionChoice[];
  /** The confirmed melee hit knocks its target out if it drops it to 0 (SRD Knocking Out a Creature). */
  knockOut?: boolean;
  /** An answer to the previewed attack roll (Bardic Inspiration, Peerless Aim), applied to the held die. */
  answer?: Readonly<{ id: string; subtract?: boolean; face?: number }>;
  /** Roll the damage and hold it, so it can be answered before it counts (Empowered Spell, Heroic Inspiration). */
  damageLook?: boolean;
  /** An answer to the held damage: the dice it rerolls, by their place in the look. */
  damageAnswer?: Readonly<{ id: "empowered-spell" | "heroic-inspiration"; dice: readonly number[] }>;
}>;

export function resolveTargeting(
  revision: number | undefined,
  onResult: (ok: boolean, message?: string) => void,
  opts: ResolveOptions = {}
) {
  if (!session || busy) return;
  const {
    attackerId,
    action,
    mode,
    selected,
    template,
    slotLevel,
    spend,
    conditionIds,
    healingShares,
    darts,
    damageType,
    skill,
    ability,
    conditionId,
    shaping,
    summonPick,
    summonType,
    optionId,
    targetOptions,
    itemId,
    objectItemId
  } = session;
  const shapeChoice = shapeChoicePayload(session, selected);
  if (session.placeZoneId !== undefined) {
    if (!template?.placed) return;
    const zoneId = session.placeZoneId;
    busy = true;
    emit();
    void command("spell-zone:place", {
      zoneId,
      template: { shape: template.shape, origin: template.placed.origin, target: template.placed.target },
      ...(revision !== undefined ? { expectedRevision: revision } : {})
    }).then((response) => {
      busy = false;
      if (response.ok) session = null;
      emit();
      onResult(response.ok, response.message);
    });
    return;
  }
  // A single-target attack previews first (commit: false) so the result card can offer Confirm, and the
  // server holds the die for it. Templates, multi-target and save/utility actions resolve straight
  // through. An explicit `commit` in opts wins (the Confirm tap).
  const isAttack = action.attackBonus !== null && mode === "single";
  // A look at the damage is a preview of it, whatever the action.
  const commit = opts.damageLook ? false : (opts.commit ?? !isAttack);
  const extra = {
    ...(opts.override ? { override: opts.override } : {}),
    ...(opts.rollMode ? { rollMode: opts.rollMode } : {}),
    ...(opts.attackNatural !== undefined ? { attackNatural: opts.attackNatural } : {}),
    ...(opts.reroll ? { reroll: true } : {}),
    ...(opts.pushFeet !== undefined ? { pushFeet: opts.pushFeet } : {}),
    ...(opts.hitOptions && opts.hitOptions.length > 0 ? { hitOptions: [...opts.hitOptions] } : {}),
    ...(opts.knockOut ? { knockOut: true } : {}),
    ...(opts.answer ? { answer: { ...opts.answer } } : {}),
    ...(opts.damageLook ? { damageLook: true } : {}),
    ...(opts.damageAnswer ? { damageAnswer: { id: opts.damageAnswer.id, dice: [...opts.damageAnswer.dice] } } : {}),
    ...(slotLevel !== undefined ? { slotLevel } : {}),
    ...(spend !== undefined ? { spend } : {}),
    ...(conditionIds && conditionIds.length > 0 ? { conditionIds: [...conditionIds] } : {}),
    // The division of a pool among the creatures still selected; a target given nothing takes nothing.
    ...(healingShares && action.dividesHealing !== undefined
      ? {
          healingShares: Object.fromEntries(
            selected.map((id) => [id, healingShares[id] ?? 0] as const).filter(([, points]) => points > 0)
          )
        }
      : {}),
    ...(damageType !== undefined ? { damageType } : {}),
    ...(skill !== undefined ? { skill } : {}),
    ...(ability !== undefined ? { ability } : {}),
    ...(conditionId !== undefined ? { conditionId } : {}),
    ...(optionId !== undefined ? { optionId } : {}),
    // Only the picks for creatures still selected.
    ...(targetOptions && action.choices?.optionsPerTarget
      ? {
          targetOptions: Object.fromEntries(Object.entries(targetOptions).filter(([id]) => selected.includes(id)))
        }
      : {}),
    ...(itemId !== undefined ? { itemId } : {}),
    ...(objectItemId !== undefined ? { objectItemId } : {}),
    ...(shaping && shaping.length > 0 ? { shaping: shaping.map((entry) => ({ ...entry })) } : {}),
    ...(summonPick || summonType
      ? {
          summon: {
            ...(summonPick ? { picks: [{ ...summonPick }] } : {}),
            ...(summonType ? { creatureType: summonType } : {})
          }
        }
      : {}),
    ...shapeChoice,
    commit,
    ...(revision !== undefined ? { expectedRevision: revision } : {})
  };
  const payload =
    mode === "none"
      ? { actorId: attackerId, actionId: action.id, ...extra }
      : mode === "template"
        ? template?.placed
          ? (template.others ?? []).length > 0
            ? {
                actorId: attackerId,
                actionId: action.id,
                // Every area set down, and the one moving now.
                templates: [...template.others!, template.placed].map((placed) => ({
                  shape: template.shape,
                  origin: placed.origin,
                  target: placed.target
                })),
                ...extra
              }
            : {
                actorId: attackerId,
                actionId: action.id,
                template: { shape: template.shape, origin: template.placed.origin, target: template.placed.target },
                ...extra
              }
          : null
        : selected.length > 0
          ? { actorId: attackerId, actionId: action.id, targetIds: dartTargetIds(selected, darts), ...extra }
          : null;
  if (!payload) return;
  busy = true;
  blockedPrompt = null;
  emit();
  void command("action:resolve", payload).then((response) => {
    busy = false;
    // A preview keeps the session for re-rolls or confirm; a committed resolve ends it.
    if (response.ok && response.resolution) {
      result = response.resolution;
      // A typed die stays typed until a reroll the server throws (the GM's) replaces it.
      if (response.resolution.preview)
        typedPreview = opts.attackNatural !== undefined ? true : opts.reroll ? false : typedPreview;
      if (!response.resolution.preview) session = null;
    }
    // Overridable rejection: keep the session (same targets) and offer the audited override; the retry
    // skips expectedRevision because it is an explicit human confirmation. The GM's retry keeps `commit`
    // as sent; the player's ask is replayed on the GM's socket, so it is parked committing.
    else if (response.blocked?.overridable)
      blockedPrompt = {
        blocked: response.blocked,
        retry: (confirmed) => resolveTargeting(undefined, onResult, { ...opts, override: confirmed }),
        asked: { type: "action.resolve", payload: { commandId: newId(), ...payload, commit: true } }
      };
    emit();
    onResult(response.ok, response.blocked ? undefined : response.message);
  });
}

/** Resolve a targetless action (Rage, Reckless Attack, a Multiattack plan) without a targeting session. */
export function resolveActionDirect(
  attackerId: string,
  actionId: string,
  revision: number | undefined,
  onResult: (ok: boolean, message?: string) => void,
  override?: { reason: string },
  /** A spell readied to cast later, at a chosen slot level. */
  readied?: Readonly<{ slotLevel?: number }>,
  /** A spell with nothing to aim, cast now at a chosen slot level and shaped as its caster chose. */
  cast?: Readonly<{ slotLevel?: number; shaping?: readonly CastShaping[] }>
) {
  const extra = readied
    ? { ready: true, ...(readied.slotLevel !== undefined ? { slotLevel: readied.slotLevel } : {}) }
    : {
        ...(cast?.slotLevel !== undefined ? { slotLevel: cast.slotLevel } : {}),
        ...(cast?.shaping && cast.shaping.length > 0 ? { shaping: cast.shaping.map((entry) => ({ ...entry })) } : {})
      };
  void command("action:resolve", {
    actorId: attackerId,
    actionId,
    ...extra,
    ...(override ? { override } : {}),
    ...(revision !== undefined ? { expectedRevision: revision } : {})
  }).then((response) => {
    if (response.ok && response.resolution) {
      result = response.resolution;
      session = null;
    } else if (response.blocked?.overridable)
      blockedPrompt = {
        blocked: response.blocked,
        retry: (confirmed) => resolveActionDirect(attackerId, actionId, undefined, onResult, confirmed, readied, cast),
        asked: { type: "action.resolve", payload: { commandId: newId(), actorId: attackerId, actionId, ...extra } }
      };
    emit();
    onResult(response.ok, response.blocked ? undefined : response.message);
  });
}

/** What an attack on a door or a wall came to, as the map's status line says it. */
export function objectAttackLine(
  reply: Readonly<{ outcome?: "hit" | "crit" | "miss"; damage?: number; destroyed?: boolean }>
): string {
  if (reply.outcome === "miss") return "Miss.";
  const hit = reply.outcome === "crit" ? "Critical hit" : "Hit";
  const damage = reply.damage !== undefined ? ` · ${reply.damage} damage` : "";
  return `${hit}${damage}.${reply.destroyed ? " It breaks." : ""}`;
}

/**
 * Aims the live session at a door or a wall of the map. An attack strikes it as an object (`object:attack`); a spell
 * acts on it (`action:resolve` with `wallId`: Knock, Arcane Lock, Passwall, Disintegrate). The server checks reach,
 * range and sight, and whether the spell acts on walls at all.
 */
export function resolveAtWall(
  wallId: string,
  revision: number | undefined,
  onResult: (ok: boolean, message?: string) => void
) {
  if (!session || busy) return;
  const { attackerId, action, slotLevel } = session;
  busy = true;
  blockedPrompt = null;
  emit();
  const done = (ok: boolean, message?: string) => {
    busy = false;
    if (ok) session = null;
    emit();
    onResult(ok, message);
  };
  const expected = revision !== undefined ? { expectedRevision: revision } : {};
  if (action.attackBonus !== null) {
    void command("object:attack", { actorId: attackerId, actionId: action.id, target: { wallId }, ...expected }).then(
      (reply) => done(reply.ok, reply.ok ? objectAttackLine(reply) : reply.message)
    );
    return;
  }
  void command("action:resolve", {
    actorId: attackerId,
    actionId: action.id,
    wallId,
    commit: true,
    ...(slotLevel !== undefined ? { slotLevel } : {}),
    ...expected
  }).then((response) => {
    if (response.ok && response.resolution) result = response.resolution;
    done(response.ok, response.message);
  });
}

/** Aims the live attack at what holds a creature (a Net, a web, a rope): `object:attack` on the effect that holds it.
 *  Breaking it frees the creature. */
export function resolveAtHeld(
  actorId: string,
  effectId: string,
  revision: number | undefined,
  onResult: (ok: boolean, message?: string) => void
) {
  if (!session || busy || session.action.attackBonus === null) return;
  const { attackerId, action } = session;
  busy = true;
  emit();
  void command("object:attack", {
    actorId: attackerId,
    actionId: action.id,
    target: { actorId, effectId },
    ...(revision !== undefined ? { expectedRevision: revision } : {})
  }).then((reply) => {
    busy = false;
    if (reply.ok) session = null;
    emit();
    onResult(reply.ok, reply.ok ? objectAttackLine(reply) : reply.message);
  });
}

/** Take the targeted action's own move before the rest of it (Pounce): the server spends the action and grants the
 *  move now; the action picked again after the move makes the rest at no further cost. */
export function takeMoveFirst(onResult: (ok: boolean, message?: string) => void) {
  if (!session || busy) return;
  const { attackerId, action } = session;
  busy = true;
  emit();
  void command("action:resolve", { actorId: attackerId, actionId: action.id, moveFirst: true }).then((response) => {
    busy = false;
    if (response.ok) session = null;
    else if (response.blocked?.overridable)
      blockedPrompt = {
        blocked: response.blocked,
        retry: (confirmed) =>
          void command("action:resolve", {
            actorId: attackerId,
            actionId: action.id,
            moveFirst: true,
            override: confirmed
          }).then((retried) => {
            if (retried.ok) session = null;
            blockedPrompt = null;
            emit();
            onResult(retried.ok, retried.message);
          }),
        asked: {
          type: "action.resolve",
          payload: { commandId: newId(), actorId: attackerId, actionId: action.id, moveFirst: true }
        }
      };
    emit();
    onResult(response.ok, response.blocked ? undefined : response.message);
  });
}

export function useTargeting() {
  return useSyncExternalStore(
    subscribe,
    () => session,
    () => session
  );
}
export function useTargetingResult() {
  return useSyncExternalStore(
    subscribe,
    () => result,
    () => result
  );
}
/** Whether the previewed attack's die was typed from a physical die. */
export function useTargetingTyped() {
  return useSyncExternalStore(
    subscribe,
    () => typedPreview,
    () => typedPreview
  );
}
export function useTargetingBusy() {
  return useSyncExternalStore(
    subscribe,
    () => busy,
    () => busy
  );
}
export function useTargetingBlocked() {
  return useSyncExternalStore(
    subscribe,
    () => blockedPrompt,
    () => blockedPrompt
  );
}
