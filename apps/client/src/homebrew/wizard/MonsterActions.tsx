/**
 * The stat block's action composer: one list per timing (actions, bonus actions, reactions, legendary actions), each
 * action built by kind. An attack asks reach or range, its bonus, its damage and what a hit leaves on the target; a
 * saving throw asks the ability, the DC, who it reaches and what a failure does; a Multiattack names the attacks it
 * makes. Every number it suggests is the SRD's own arithmetic on this monster's scores (Proficiency Bonus plus the
 * ability; 8 plus both for a DC). The text is written from the answers, in the SRD's words, until the GM writes
 * their own.
 */

import { useId } from "react";
import { SaveConditionSchema } from "@vtt/schemas";
import { Chip, Field, FieldGrid, Input, NumberField, RowEditor, Select, Stepper, Switch, Textarea } from "@vtt/ui";
import type { Draft } from "../schema";
import { DAMAGE_TYPES, SIZES } from "../vocabulary";
import {
  ABILITY_IDS,
  ABILITY_NAMES,
  modifierOf,
  proficiencyOf,
  scoresOf,
  signed,
  type AbilityId
} from "./monster-build";
import {
  USAGES,
  actionsOf,
  activationOf,
  attackBonusFor,
  editAction,
  generatedText,
  kindOf,
  newAction,
  partsOf,
  saveDcFor,
  saveTargetOf,
  usageOf,
  withSaveTarget,
  withUsage,
  type ActionKind,
  type Activation,
  type MonsterAction,
  type SaveTarget
} from "./monster-actions";

const KIND_WORDS: Readonly<Record<ActionKind, string>> = {
  attack: "An attack",
  save: "A saving throw",
  multiattack: "Multiattack",
  other: "Something else"
};

const KINDS_FOR: Readonly<Record<Activation, readonly ActionKind[]>> = {
  action: ["attack", "save", "multiattack", "other"],
  "bonus-action": ["attack", "save", "other"],
  reaction: ["other"],
  legendary: ["attack", "save", "other"]
};

const CONDITIONS = SaveConditionSchema.options;
const titleCase = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

const creatureWord = (draft: Draft) =>
  (typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : "creature").toLowerCase();

/** The other lists' rows stay where they were; this list's rows take their place in its own order. */
function mergeTiming(all: readonly MonsterAction[], activation: Activation, next: readonly MonsterAction[]) {
  const others = all.filter((action) => activationOf(action) !== activation);
  return [...others, ...next];
}

/** After any edit, a Multiattack whose text was written from the answers is rewritten, since it names other
 *  actions. */
function refreshMultiattacks(
  before: readonly MonsterAction[],
  after: readonly MonsterAction[],
  creature: string
): MonsterAction[] {
  return after.map((action) => {
    if (kindOf(action) !== "multiattack") return action;
    const was = generatedText(action, before, creature);
    const held = typeof action.description === "string" ? action.description : "";
    return held === "" || held === was
      ? { ...action, description: generatedText(action, after, creature) ?? held }
      : action;
  });
}

/** A new kind keeps the action's place, name, timing and uses, and starts that kind's mechanics fresh. */
function toKind(action: MonsterAction, kind: ActionKind, draft: Draft): MonsterAction {
  const {
    attack: _attack,
    save: _save,
    damage: _damage,
    onHit: _onHit,
    multiattack: _multiattack,
    area: _area,
    ...kept
  } = action as Record<string, unknown>;
  const fresh = seeded(kind, activationOf(action), draft);
  return {
    ...fresh,
    ...kept,
    ...(kind === "multiattack" ? { name: kept.name || fresh.name } : {}),
    damage: kind === "attack" || kind === "save" ? fresh.damage : []
  };
}

/** A new action, its numbers the SRD's arithmetic on this monster: attack bonus PB plus Strength or Dexterity
 *  (the better), save DC 8 plus PB plus Constitution. */
function seeded(kind: ActionKind, activation: Activation, draft: Draft): MonsterAction {
  const scores = scoresOf(draft);
  const proficiency = proficiencyOf(draft);
  const best = Math.max(modifierOf(scores.str), modifierOf(scores.dex));
  const blank = newAction(kind, activation);
  if (kind === "attack")
    return {
      ...blank,
      attack: { bonus: attackBonusFor(proficiency, best), reachFeet: 5 },
      damage: [{ formula: best === 0 ? "1d6" : `1d6 ${best > 0 ? "+" : "-"} ${Math.abs(best)}`, type: "slashing" }]
    };
  if (kind === "save")
    return {
      ...blank,
      save: {
        ability: "dex",
        dc: saveDcFor(proficiency, modifierOf(scores.con)),
        successDamage: "half",
        failureConditions: []
      }
    };
  return blank;
}

export function MonsterActions({
  draft,
  onDraft,
  activation,
  idPrefix
}: Readonly<{ draft: Draft; onDraft: (next: Draft) => void; activation: Activation; idPrefix: string }>) {
  const all = actionsOf(draft);
  const rows = all.filter((action) => activationOf(action) === activation);
  const creature = creatureWord(draft);

  const commit = (next: readonly MonsterAction[]) => {
    const merged = mergeTiming(all, activation, next);
    onDraft({ ...draft, actions: refreshMultiattacks(all, merged, creature) });
  };
  const put = (index: number, before: MonsterAction, after: MonsterAction) =>
    commit(rows.map((row, i) => (i === index ? editAction(before, after, all, creature) : row)));

  const kinds = KINDS_FOR[activation];
  return (
    <RowEditor
      rows={rows}
      onChange={commit}
      rowKey={(action) => String(action.id)}
      onAdd={() => {
        const fresh = seeded(kinds[0], activation, draft);
        return editAction(fresh, fresh, all, creature);
      }}
      addLabel={
        activation === "bonus-action"
          ? "Add a bonus action"
          : activation === "reaction"
            ? "Add a reaction"
            : activation === "legendary"
              ? "Add a legendary action"
              : "Add an action"
      }
      emptyText={
        activation === "action"
          ? "No actions yet. Most monsters have at least one attack."
          : activation === "bonus-action"
            ? "No bonus actions. Most monsters have none."
            : activation === "reaction"
              ? "No reactions. Most monsters have none."
              : "No legendary actions yet."
      }
      collapsible
      max={activation === "action" ? 12 : 6}
      maxReachedReason="That is as many as one list of a stat block holds here."
      ariaLabel={
        activation === "bonus-action"
          ? "Bonus actions"
          : activation === "reaction"
            ? "Reactions"
            : activation === "legendary"
              ? "Legendary actions"
              : "Actions"
      }
      rowLabel={(action) => (typeof action.name === "string" && action.name ? action.name : "Unnamed action")}
      renderRow={(action, index) => (
        <ActionBuilder
          action={action}
          all={all}
          kinds={kinds}
          draft={draft}
          idPrefix={`${idPrefix}-${index}`}
          onChange={(next) => put(index, action, next)}
          onKind={(kind) => put(index, action, toKind(action, kind, draft))}
        />
      )}
    />
  );
}

function ActionBuilder({
  action,
  all,
  kinds,
  draft,
  idPrefix,
  onChange,
  onKind
}: Readonly<{
  action: MonsterAction;
  all: readonly MonsterAction[];
  kinds: readonly ActionKind[];
  draft: Draft;
  idPrefix: string;
  onChange: (next: MonsterAction) => void;
  onKind: (kind: ActionKind) => void;
}>) {
  const autoId = useId();
  const kind = kindOf(action);
  const activation = activationOf(action);
  const set = (patch: Readonly<Record<string, unknown>>) => onChange({ ...action, ...patch });

  return (
    <div className="hb-monster-action">
      {kinds.length > 1 && (
        <ChipGroup
          label="What it is"
          id={`${autoId}-kind`}
          options={kinds.map((value) => ({ value, label: KIND_WORDS[value] }))}
          value={kind}
          onChange={(next) => onKind(next as ActionKind)}
        />
      )}
      <Field label="Its name" htmlFor={`${idPrefix}-name`}>
        <Input
          id={`${idPrefix}-name`}
          value={typeof action.name === "string" ? action.name : ""}
          placeholder={kind === "attack" ? "Claw" : kind === "save" ? "Fire Breath" : "Nimble Escape"}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>

      {kind === "attack" && <AttackAnswers action={action} draft={draft} idPrefix={idPrefix} onChange={onChange} />}
      {kind === "save" && <SaveAnswers action={action} draft={draft} idPrefix={idPrefix} onChange={onChange} />}
      {kind === "multiattack" && <MultiattackAnswers action={action} all={all} onChange={onChange} />}
      {activation === "reaction" && (
        <ReactionAnswers action={action} draft={draft} idPrefix={idPrefix} onChange={onChange} />
      )}

      {kind !== "multiattack" && activation !== "reaction" && (
        <ChipGroup
          label="How often it can"
          id={`${autoId}-usage`}
          options={USAGES.map((usage) => ({ value: usage.value, label: usage.label }))}
          value={usageOf(action)}
          onChange={(next) => onChange(withUsage(action, next as (typeof USAGES)[number]["value"]))}
          help="Recharge rolls a d6 at the start of its turn; 5-6 brings it back on a 5 or 6. A day is a long rest."
        />
      )}

      {activation === "legendary" && (
        <>
          <Stepper
            label="Legendary actions it costs"
            value={(action.legendary as { cost?: number } | undefined)?.cost ?? 1}
            min={1}
            max={3}
            onChange={(cost) => set({ legendary: { ...(action.legendary as object), cost } })}
          />
          <Switch
            checked={(action.legendary as { oncePerRound?: boolean } | undefined)?.oncePerRound === true}
            onChange={(next) => {
              const { oncePerRound: _once, ...legendary } = (action.legendary as Record<string, unknown>) ?? {};
              set({ legendary: next ? { ...legendary, oncePerRound: true } : legendary });
            }}
            label="It can't take this one again until the start of its next turn"
          />
        </>
      )}

      {activation !== "reaction" && (
        <Field
          label="What the stat block says"
          htmlFor={`${idPrefix}-text`}
          help={
            kind === "other"
              ? "Say what it does; the GM reads it at the table."
              : "Written from your answers, in the SRD's words, until you change it."
          }
        >
          <Textarea
            id={`${idPrefix}-text`}
            rows={3}
            value={typeof action.description === "string" ? action.description : ""}
            onChange={(event) => set({ description: event.target.value })}
          />
        </Field>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- attacks ---- */

function AttackAnswers({
  action,
  draft,
  idPrefix,
  onChange
}: Readonly<{ action: MonsterAction; draft: Draft; idPrefix: string; onChange: (next: MonsterAction) => void }>) {
  const autoId = useId();
  const attack = (action.attack as {
    bonus: number;
    reachFeet?: number;
    rangeFeet?: number;
    rangeNormalFeet?: number;
  }) ?? {
    bonus: 0
  };
  const melee = typeof attack.reachFeet === "number";
  const ranged = typeof attack.rangeFeet === "number";
  const way = melee && ranged ? "both" : ranged ? "ranged" : "melee";
  const scores = scoresOf(draft);
  const proficiency = proficiencyOf(draft);
  const parts = partsOf(action);
  const onHit = (Array.isArray(action.onHit) ? action.onHit : []) as Array<{
    conditions: Array<{ id: string }>;
    escapeDc?: number;
    maxTargetSize?: string;
  }>;
  const rider = onHit[0];
  const riderConditions = rider?.conditions.map((condition) => condition.id) ?? [];
  const setAttack = (patch: Readonly<Record<string, unknown>>) => {
    const next: Record<string, unknown> = { ...attack, ...patch };
    for (const [key, value] of Object.entries(next)) if (value === undefined) delete next[key];
    onChange({ ...action, attack: next });
  };
  const setRider = (next: { conditions: string[]; escapeDc?: number; maxTargetSize?: string }) => {
    const { onHit: _old, ...rest } = action as Record<string, unknown>;
    if (next.conditions.length === 0) return onChange(rest);
    const grappled = next.conditions.includes("grappled");
    onChange({
      ...rest,
      onHit: [
        {
          conditions: next.conditions.map((id) => ({ id })),
          ...(grappled ? { escapeDc: next.escapeDc ?? 8 + proficiency + modifierOf(scores.str) } : {}),
          ...(next.maxTargetSize ? { maxTargetSize: next.maxTargetSize } : {})
        }
      ]
    });
  };

  return (
    <>
      <ChipGroup
        label="How it attacks"
        id={`${autoId}-way`}
        options={[
          { value: "melee", label: "In melee" },
          { value: "ranged", label: "At range" },
          { value: "both", label: "Either" }
        ]}
        value={way}
        onChange={(next) =>
          setAttack({
            reachFeet: next === "ranged" ? undefined : (attack.reachFeet ?? 5),
            rangeFeet: next === "melee" ? undefined : (attack.rangeFeet ?? (next === "both" ? 60 : 320)),
            rangeNormalFeet: next === "melee" ? undefined : (attack.rangeNormalFeet ?? (next === "both" ? 20 : 80))
          })
        }
        help="A thrown spear is either: reach 5 feet, or range 20/60."
      />
      <FieldGrid min="9rem">
        {melee && (
          <Field label="Reach" htmlFor={`${idPrefix}-reach`}>
            <NumberField
              id={`${idPrefix}-reach`}
              value={attack.reachFeet ?? 5}
              min={5}
              max={120}
              unit="ft"
              onChange={(next) => setAttack({ reachFeet: next ?? 5 })}
            />
          </Field>
        )}
        {ranged && (
          <>
            <Field label="Normal range" htmlFor={`${idPrefix}-normal`}>
              <NumberField
                id={`${idPrefix}-normal`}
                value={attack.rangeNormalFeet ?? null}
                min={5}
                max={1000}
                unit="ft"
                onChange={(next) => setAttack({ rangeNormalFeet: next ?? undefined })}
              />
            </Field>
            <Field label="Long range" htmlFor={`${idPrefix}-long`}>
              <NumberField
                id={`${idPrefix}-long`}
                value={attack.rangeFeet ?? null}
                min={5}
                max={1000}
                unit="ft"
                onChange={(next) => setAttack({ rangeFeet: next ?? 5 })}
              />
            </Field>
          </>
        )}
      </FieldGrid>

      <Field
        label="Its attack bonus"
        htmlFor={`${idPrefix}-bonus`}
        help={`The SRD's arithmetic: Proficiency Bonus ${signed(proficiency)} plus Strength ${signed(modifierOf(scores.str))} is ${signed(attackBonusFor(proficiency, modifierOf(scores.str)))}; with Dexterity ${signed(modifierOf(scores.dex))} it is ${signed(attackBonusFor(proficiency, modifierOf(scores.dex)))}.`}
      >
        <NumberField
          id={`${idPrefix}-bonus`}
          value={attack.bonus}
          min={-5}
          max={30}
          allowNegative
          onChange={(next) => setAttack({ bonus: next ?? 0 })}
        />
      </Field>

      <DamageParts
        parts={parts}
        idPrefix={idPrefix}
        hint={`Add the ability it attacks with: Strength ${signed(modifierOf(scores.str))}, Dexterity ${signed(modifierOf(scores.dex))}. Like 1d8 + 3.`}
        onChange={(next) => onChange({ ...action, damage: next })}
      />

      <ConditionChips
        label="A hit also gives the target"
        id={`${autoId}-onhit`}
        chosen={riderConditions}
        onChange={(conditions) =>
          setRider({ ...rider, conditions, escapeDc: rider?.escapeDc, maxTargetSize: rider?.maxTargetSize })
        }
      />
      {riderConditions.length > 0 && (
        <FieldGrid min="9rem">
          {riderConditions.includes("grappled") && (
            <Field
              label="Escape DC"
              htmlFor={`${idPrefix}-escape`}
              help={`8 plus its Proficiency Bonus and Strength is ${8 + proficiency + modifierOf(scores.str)}.`}
            >
              <NumberField
                id={`${idPrefix}-escape`}
                value={rider?.escapeDc ?? null}
                min={1}
                max={40}
                onChange={(next) =>
                  setRider({
                    conditions: riderConditions,
                    escapeDc: next ?? undefined,
                    maxTargetSize: rider?.maxTargetSize
                  })
                }
              />
            </Field>
          )}
          <Field label="Only on a target this size or smaller" htmlFor={`${idPrefix}-size`}>
            <Select
              id={`${idPrefix}-size`}
              value={rider?.maxTargetSize ?? ""}
              onChange={(event) =>
                setRider({
                  conditions: riderConditions,
                  escapeDc: rider?.escapeDc,
                  maxTargetSize: event.target.value || undefined
                })
              }
            >
              <option value="">Any size</option>
              {SIZES.map((size) => (
                <option key={size.value} value={size.value}>
                  {size.label}
                </option>
              ))}
            </Select>
          </Field>
        </FieldGrid>
      )}
    </>
  );
}

/* ------------------------------------------------------------ saving throws ---- */

const AREA_SHAPES: ReadonlyArray<Readonly<{ value: string; label: string }>> = [
  { value: "one", label: "One creature" },
  { value: "cone", label: "A cone" },
  { value: "line", label: "A line" },
  { value: "sphere", label: "A sphere" },
  { value: "emanation", label: "An emanation" },
  { value: "cube", label: "A cube" }
];

function SaveAnswers({
  action,
  draft,
  idPrefix,
  onChange
}: Readonly<{ action: MonsterAction; draft: Draft; idPrefix: string; onChange: (next: MonsterAction) => void }>) {
  const autoId = useId();
  const save = action.save as {
    ability: AbilityId;
    dc: number;
    successDamage?: "half" | "none";
    failureConditions?: string[];
  };
  const scores = scoresOf(draft);
  const proficiency = proficiencyOf(draft);
  const target = saveTargetOf(action);
  const setSave = (patch: Readonly<Record<string, unknown>>) => onChange({ ...action, save: { ...save, ...patch } });
  const suggested = (ability: AbilityId) => saveDcFor(proficiency, modifierOf(scores[ability]));

  return (
    <>
      <ChipGroup
        label="Which saving throw"
        id={`${autoId}-ability`}
        options={ABILITY_IDS.map((ability) => ({ value: ability, label: ABILITY_NAMES[ability] }))}
        value={save.ability}
        onChange={(next) => setSave({ ability: next })}
      />
      <Field
        label="Its DC"
        htmlFor={`${idPrefix}-dc`}
        help={`The SRD's arithmetic: 8 plus its Proficiency Bonus plus the ability it uses, like Constitution for a breath (${suggested("con")}) or Charisma for a spell (${suggested("cha")}).`}
      >
        <NumberField
          id={`${idPrefix}-dc`}
          value={save.dc}
          min={1}
          max={40}
          onChange={(next) => setSave({ dc: next ?? suggested("con") })}
        />
      </Field>
      <ChipGroup
        label="Who it reaches"
        id={`${autoId}-target`}
        options={AREA_SHAPES}
        value={target.kind === "one" ? "one" : target.shape}
        onChange={(next) =>
          onChange(
            withSaveTarget(
              action,
              next === "one"
                ? { kind: "one", feet: 30 }
                : {
                    kind: "area",
                    shape: next as Extract<SaveTarget, { kind: "area" }>["shape"],
                    size: target.kind === "area" ? target.size : 15
                  }
            )
          )
        }
        help="An area is drawn on the map as a template when the action is used."
      />
      <Field
        label={
          target.kind === "one"
            ? "Within how many feet"
            : target.shape === "sphere"
              ? "Its radius"
              : target.shape === "cube"
                ? "Its side"
                : target.shape === "emanation"
                  ? "How far it reaches from the monster"
                  : "Its length"
        }
        htmlFor={`${idPrefix}-size`}
      >
        <NumberField
          id={`${idPrefix}-size`}
          value={target.kind === "one" ? target.feet : target.size}
          min={5}
          max={500}
          unit="ft"
          onChange={(next) =>
            onChange(
              withSaveTarget(
                action,
                target.kind === "one" ? { kind: "one", feet: next ?? 30 } : { ...target, size: next ?? 15 }
              )
            )
          }
        />
      </Field>
      <DamageParts
        parts={partsOf(action)}
        idPrefix={idPrefix}
        hint="Like 4d10. Leave it empty for a save that deals no damage."
        onChange={(next) => onChange({ ...action, damage: next })}
      />
      {partsOf(action).length > 0 && (
        <ChipGroup
          label="A target that succeeds takes"
          id={`${autoId}-success`}
          options={[
            { value: "half", label: "Half damage" },
            { value: "none", label: "No damage" }
          ]}
          value={save.successDamage ?? "half"}
          onChange={(next) => setSave({ successDamage: next })}
        />
      )}
      <ConditionChips
        label="A target that fails also has"
        id={`${autoId}-fail`}
        chosen={save.failureConditions ?? []}
        onChange={(failureConditions) => setSave({ failureConditions })}
      />
    </>
  );
}

/* ------------------------------------------------------------- multiattack ---- */

type Component = { actionId: string; count: number; or?: string[] };

function MultiattackAnswers({
  action,
  all,
  onChange
}: Readonly<{ action: MonsterAction; all: readonly MonsterAction[]; onChange: (next: MonsterAction) => void }>) {
  const plan = (Array.isArray(action.multiattack) ? action.multiattack : []) as Component[];
  const usable = all.filter(
    (candidate) =>
      candidate.id !== action.id && activationOf(candidate) === "action" && kindOf(candidate) !== "multiattack"
  );
  const nameOf = (candidate: MonsterAction) =>
    typeof candidate.name === "string" && candidate.name ? candidate.name : "Unnamed action";
  const setPlan = (next: Component[]) => onChange({ ...action, multiattack: next });

  if (usable.length === 0)
    return <p className="nh-field-help">Add the attacks it makes first; a Multiattack names them.</p>;

  return (
    <RowEditor
      rows={plan}
      onChange={(next) => setPlan([...next])}
      rowKey={(component) => `${component.actionId}-${plan.indexOf(component)}`}
      onAdd={(): Component => ({ actionId: String(usable[0].id), count: 1 })}
      addLabel="Add an attack to it"
      emptyText="It makes no attacks yet."
      max={6}
      maxReachedReason="Six is as many as a Multiattack names."
      ariaLabel="What the Multiattack makes"
      rowLabel={(component) => {
        const found = usable.find((candidate) => candidate.id === component.actionId);
        return `${component.count} × ${found ? nameOf(found) : "an action"}`;
      }}
      renderRow={(component, index) => {
        const put = (patch: Partial<Component>) =>
          setPlan(plan.map((entry, i) => (i === index ? ({ ...entry, ...patch } as Component) : entry)));
        const alternatives = usable.filter((candidate) => candidate.id !== component.actionId);
        return (
          <div className="hb-monster-action">
            <FieldGrid min="10rem">
              <Field label="It makes">
                <Select
                  value={component.actionId}
                  onChange={(event) =>
                    put({ actionId: event.target.value, or: component.or?.filter((id) => id !== event.target.value) })
                  }
                >
                  {usable.map((candidate) => (
                    <option key={String(candidate.id)} value={String(candidate.id)}>
                      {nameOf(candidate)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Stepper
                label="How many times"
                value={component.count}
                min={1}
                max={6}
                onChange={(count) => put({ count })}
              />
            </FieldGrid>
            {alternatives.length > 0 && (
              <div className="hb-field">
                <span className="nh-field-label">Or any of these in its place</span>
                <div className="hb-chips" role="group" aria-label="Or any of these in its place">
                  {alternatives.map((candidate) => {
                    const on = component.or?.includes(String(candidate.id)) ?? false;
                    return (
                      <Chip
                        key={String(candidate.id)}
                        pressed={on}
                        onClick={() => {
                          const next = on
                            ? (component.or ?? []).filter((id) => id !== candidate.id)
                            : [...(component.or ?? []), String(candidate.id)];
                          const { or: _or, ...rest } = component;
                          put(next.length > 0 ? { ...rest, or: next.slice(0, 3) } : rest);
                        }}
                      >
                        {nameOf(candidate)}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      }}
    />
  );
}

/* --------------------------------------------------------------- reactions ---- */

const TRIGGER_RESPONSE = /^_Trigger:_\s*([\s\S]*?)\s*_Response:_\s*([\s\S]*)$/;

/** A reaction is prose: what sets it off and what it does, in the SRD's two parts. A Parry's "adds 2 to its AC
 *  against that attack" is read from the text into a reaction the table offers. */
function ReactionAnswers({
  action,
  draft,
  idPrefix,
  onChange
}: Readonly<{ action: MonsterAction; draft: Draft; idPrefix: string; onChange: (next: MonsterAction) => void }>) {
  const description = typeof action.description === "string" ? action.description : "";
  const parsed = TRIGGER_RESPONSE.exec(description);
  const trigger = parsed?.[1] ?? "";
  const response = parsed?.[2] ?? (parsed ? "" : description);
  const write = (nextTrigger: string, nextResponse: string) =>
    onChange({ ...action, description: `_Trigger:_ ${nextTrigger.trim()} _Response:_ ${nextResponse.trim()}`.trim() });
  const creature = creatureWord(draft);
  const parry = /adds (\d+) to its AC against that attack/i.exec(response);
  return (
    <>
      <Field label="What sets it off" htmlFor={`${idPrefix}-trigger`}>
        <Input
          id={`${idPrefix}-trigger`}
          value={trigger}
          placeholder={`The ${creature} is hit by a melee attack roll.`}
          onChange={(event) => write(event.target.value, response)}
        />
      </Field>
      <Field label="What it does" htmlFor={`${idPrefix}-response`}>
        <Input
          id={`${idPrefix}-response`}
          value={response}
          placeholder={`The ${creature} adds 2 to its AC against that attack, possibly causing it to miss.`}
          onChange={(event) => write(trigger, event.target.value)}
        />
      </Field>
      <Switch
        checked={!!parry}
        onChange={(next) =>
          next
            ? write(
                trigger || `The ${creature} is hit by a melee attack roll while holding a weapon.`,
                `The ${creature} adds 2 to its AC against that attack, possibly causing it to miss.`
              )
            : write(trigger, "")
        }
        label="It parries: the table offers it when the monster is hit"
      />
      {parry && (
        <Stepper
          label="AC it adds"
          value={Number(parry[1])}
          min={1}
          max={5}
          onChange={(amount) => write(trigger, response.replace(/adds \d+ to its AC/i, `adds ${amount} to its AC`))}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- shared ---- */

function DamageParts({
  parts,
  idPrefix,
  hint,
  onChange
}: Readonly<{
  parts: ReadonlyArray<{ formula: string; type: string }>;
  idPrefix: string;
  hint: string;
  onChange: (next: Array<{ formula: string; type: string }>) => void;
}>) {
  const shown = parts.length > 0 ? parts : [];
  return (
    <div className="hb-field">
      <span className="nh-field-label">Damage</span>
      <p className="nh-field-help">{hint}</p>
      {shown.map((part, index) => (
        <FieldGrid min="9rem" key={index}>
          <Field label={index === 0 ? "Dice" : "Plus"} htmlFor={`${idPrefix}-dice-${index}`}>
            <Input
              id={`${idPrefix}-dice-${index}`}
              value={part.formula}
              placeholder="1d8 + 3"
              onChange={(event) =>
                onChange(shown.map((entry, i) => (i === index ? { ...entry, formula: event.target.value } : entry)))
              }
            />
          </Field>
          <Field label="Type" htmlFor={`${idPrefix}-type-${index}`}>
            <Select
              id={`${idPrefix}-type-${index}`}
              value={part.type}
              onChange={(event) =>
                onChange(shown.map((entry, i) => (i === index ? { ...entry, type: event.target.value } : entry)))
              }
            >
              {DAMAGE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          </Field>
        </FieldGrid>
      ))}
      <div className="hb-chips">
        {shown.length < 3 && (
          <Chip onClick={() => onChange([...shown, { formula: shown.length === 0 ? "1d6" : "1d6", type: "fire" }])}>
            {shown.length === 0 ? "Add damage" : "Add more damage"}
          </Chip>
        )}
        {shown.length > 0 && <Chip onClick={() => onChange(shown.slice(0, -1))}>Take the last off</Chip>}
      </div>
    </div>
  );
}

function ConditionChips({
  label,
  id,
  chosen,
  onChange
}: Readonly<{ label: string; id: string; chosen: readonly string[]; onChange: (next: string[]) => void }>) {
  return (
    <div className="hb-field">
      <span className="nh-field-label" id={id}>
        {label}
      </span>
      <div className="hb-chips" role="group" aria-labelledby={id}>
        {CONDITIONS.map((condition) => {
          const on = chosen.includes(condition);
          return (
            <Chip
              key={condition}
              pressed={on}
              onClick={() => onChange(on ? chosen.filter((entry) => entry !== condition) : [...chosen, condition])}
            >
              {titleCase(condition)}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}

export function ChipGroup({
  label,
  id,
  options,
  value,
  onChange,
  help
}: Readonly<{
  label: string;
  id: string;
  options: ReadonlyArray<Readonly<{ value: string; label: string }>>;
  value: string;
  onChange: (next: string) => void;
  help?: string;
}>) {
  return (
    <div className="hb-field">
      <span className="nh-field-label" id={id}>
        {label}
      </span>
      <div className="hb-chips" role="group" aria-labelledby={id}>
        {options.map((option) => (
          <Chip
            key={option.value}
            pressed={value === option.value}
            onClick={() => {
              if (value !== option.value) onChange(option.value);
            }}
          >
            {option.label}
          </Chip>
        ))}
      </div>
      {help && <p className="nh-field-help">{help}</p>}
    </div>
  );
}
