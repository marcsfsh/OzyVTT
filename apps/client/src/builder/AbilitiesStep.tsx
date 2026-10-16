import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BuilderAbilityMethod, BuilderPolicy } from "@vtt/domain";
import {
  ABILITIES,
  ABILITY_ROLL_FORMULA,
  ABILITY_SCORE_MAXIMUM,
  ABILITY_SCORE_MINIMUM,
  abilityModifier,
  hitDieAverage,
  hitDieFaces,
  POINT_BUY_BUDGET,
  POINT_BUY_MAXIMUM,
  POINT_BUY_MINIMUM,
  STANDARD_ARRAY,
  validateAbilityFormula,
  type Ability,
  type HitDie
} from "@vtt/rules-5e";
import { AbilityScoreAllocator, DiceInputRow, SegmentedControl, Select, type DiceEntryMode } from "@vtt/ui";
import { command } from "../lib/command";
import { ABILITY_LABELS, isAssignMethod, pointBuySpent, type BuilderDraft, type OfferContext } from "./build-payload";

/** The ability scores step: the method, the scores, the background's increases and hit points. */

export const METHOD_LABELS: Readonly<Record<BuilderAbilityMethod, string>> = {
  "standard-array": "Standard array",
  "point-buy": "Point buy",
  roll: "Roll 4d6",
  custom: "GM formula"
};

/** The methods the table allows; a custom method needs the GM's formula. */
export const allowedMethodsOf = (policy: BuilderPolicy): readonly BuilderAbilityMethod[] =>
  policy.allowedAbilityMethods.filter((method) => method !== "custom" || policy.customFormula);

/** The draft's method, or the first allowed one when the table no longer allows it. */
export function abilityMethodOf(policy: BuilderPolicy, draft: BuilderDraft): BuilderAbilityMethod {
  const allowed = allowedMethodsOf(policy);
  return allowed.includes(draft.abilityMethod) ? draft.abilityMethod : (allowed[0] ?? "standard-array");
}

/**
 * Switching method clears only what the new method owns: point buy leaves the pool alone and the
 * assign methods leave the point-buy spread alone. Roll -> standard array replaces the pool.
 */
export const methodChange = (chosen: BuilderAbilityMethod): Partial<BuilderDraft> => ({
  abilityMethod: chosen,
  ...(isAssignMethod(chosen)
    ? {
        poolAssignment: {},
        abilityPool:
          chosen === "standard-array" ? STANDARD_ARRAY.map((value, index) => ({ id: `sa-${index}`, value })) : [],
        abilityRollId: undefined
      }
    : {})
});

export type ServerRolls = Readonly<{
  rolling: boolean;
  roll: (formula: string, label: string, apply: (total: number) => void) => void;
}>;

/**
 * Dice the wizard throws on the server. Rolls arrive through the roll history (`dice.roll` replies
 * with an id, not a total), so the number the wizard uses is the one the table can see was rolled.
 */
export function useServerRolls(
  rolls: ReadonlyArray<Readonly<{ id: string; total: number }>>,
  onRefused: (message: string) => void
): ServerRolls {
  const [rolling, setRolling] = useState(false);
  const pending = useRef(new Map<string, (total: number) => void>());
  useEffect(() => {
    if (pending.current.size === 0) return;
    for (const record of rolls) {
      const apply = pending.current.get(record.id);
      if (apply) {
        pending.current.delete(record.id);
        apply(record.total);
      }
    }
    if (pending.current.size === 0) setRolling(false);
  }, [rolls]);
  const roll = (formula: string, label: string, apply: (total: number) => void) => {
    setRolling(true);
    // GM-only visibility, but still server-thrown and recorded in the roll history.
    void command("dice:roll", { formula, purpose: "manual", visibility: "gm-only", label }).then((result) => {
      if (!result.ok || !result.rollId) {
        setRolling(false);
        onRefused(result.message ?? "The table refused the roll.");
        return;
      }
      pending.current.set(result.rollId, apply);
    });
  };
  return { rolling, roll };
}

export function AbilitiesStep({
  draft,
  policy,
  mayTypeDice,
  context,
  base,
  bonuses,
  rolls,
  problem,
  abilityEntry,
  hpEntry,
  onAbilityEntryChange,
  onHpEntryChange,
  onRollRefused,
  editDraft
}: Readonly<{
  draft: BuilderDraft;
  policy: BuilderPolicy;
  /** Whether this person may type what their own dice showed (the GM, or a table that allows it); otherwise the
      table throws the dice and the server holds the result. */
  mayTypeDice: boolean;
  context: OfferContext;
  base: Readonly<Record<Ability, number | null>>;
  bonuses: Readonly<Record<Ability, number>>;
  rolls: ServerRolls;
  /** The wizard's failure alert (a refused roll), shown at the top of the step. */
  problem: ReactNode;
  abilityEntry: DiceEntryMode;
  hpEntry: DiceEntryMode;
  onAbilityEntryChange: (mode: DiceEntryMode) => void;
  onHpEntryChange: (mode: DiceEntryMode) => void;
  onRollRefused: (message: string) => void;
  editDraft: (update: (current: BuilderDraft) => BuilderDraft) => void;
}>) {
  const patch = (change: Partial<BuilderDraft>) => editDraft((current) => ({ ...current, ...change }));
  const allowedMethods = allowedMethodsOf(policy);
  const method = abilityMethodOf(policy, draft);
  const rollFormula = method === "custom" ? (policy.customFormula ?? ABILITY_ROLL_FORMULA) : ABILITY_ROLL_FORMULA;
  const assignMode = isAssignMethod(method);
  // The server bound-checks manual scores against this formula (`validateBaseScores`), so the input
  // must not accept a value that would be rejected at Create.
  const rollBounds = useMemo(() => {
    const check = validateAbilityFormula(rollFormula);
    return check.ok
      ? { min: check.minimum, max: check.maximum }
      : { min: ABILITY_SCORE_MINIMUM, max: ABILITY_SCORE_MAXIMUM };
  }, [rollFormula]);
  const setMethod = (next: string) => patch(methodChange(next as BuilderAbilityMethod));
  const addRolledScore = (total: number) =>
    editDraft((current) =>
      current.abilityPool.length >= 6
        ? current
        : {
            ...current,
            abilityPool: [...current.abilityPool, { id: `r-${current.abilityPool.length}-${total}`, value: total }]
          }
    );
  const [rollingSix, setRollingSix] = useState(false);
  const rollAllScores = () => {
    if (!mayTypeDice) {
      // The six come from one server roll the create names, so the table can see what was rolled.
      setRollingSix(true);
      void command("builder:roll-abilities", { method: method === "custom" ? "custom" : "roll" }).then((result) => {
        setRollingSix(false);
        if (!result.ok || !result.scores || !result.rollId) {
          onRollRefused(result.message ?? "The table refused the roll.");
          return;
        }
        const rollId = result.rollId;
        const scores = result.scores;
        editDraft((current) => ({
          ...current,
          abilityPool: scores.map((value, index) => ({ id: `r-${index}-${value}`, value })),
          poolAssignment: {},
          abilityRollId: rollId
        }));
      });
      return;
    }
    const missing = 6 - draft.abilityPool.length;
    for (let index = 0; index < missing; index += 1)
      rolls.roll(rollFormula, `Ability score ${draft.abilityPool.length + index + 1}`, addRolledScore);
  };
  const addHpRoll = (total: number) =>
    editDraft((current) =>
      current.hpEntries.length >= current.level - 1 ? current : { ...current, hpEntries: [...current.hpEntries, total] }
    );
  const hitDie = (context.hitDie ?? "d8") as HitDie;
  /** Each level rolls its own class's die (a Fighter level a d10, a Wizard level a d6). */
  const dieAt = (level: number) => (context.levelDice[level - 1] ?? hitDie) as HitDie;
  const dice = [...new Set(context.levelDice.filter((die): die is HitDie => die !== null))];
  const multiclass = context.classes.length > 1;
  const nextLevel = draft.hpEntries.length + 2;
  const rollAllHp = () => {
    const missing = draft.level - 1 - draft.hpEntries.length;
    for (let index = 0; index < missing; index += 1) {
      const level = draft.hpEntries.length + index + 2;
      rolls.roll(`1d${hitDieFaces(dieAt(level))}`, `Hit points, level ${level}`, addHpRoll);
    }
  };
  const allocatorRows = ABILITIES.map((ability) => {
    const score = base[ability];
    const bonus = bonuses[ability];
    const total = score == null ? null : score + bonus;
    return {
      id: ability,
      label: ABILITY_LABELS[ability],
      abbr: ability.toUpperCase(),
      score,
      bonus,
      total,
      modifier: total == null ? null : abilityModifier(total),
      min: POINT_BUY_MINIMUM,
      max: POINT_BUY_MAXIMUM
    };
  });
  const spent = pointBuySpent(draft);
  const options = context.background?.abilityOptions ?? null;

  return (
    <>
      {problem}
      {/* What this class wants from the six scores about to be assigned. */}
      {context.classRecord && (
        <p className="cb-note tabular">
          {context.classRecord.name} · {context.classRecord.hitDie} ·{" "}
          {context.classRecord.savingThrows.map((ability) => ability.toUpperCase()).join("/")}
          {context.classRecord.primaryAbilities.length > 0 &&
            ` · primary ${context.classRecord.primaryAbilities.map((ability) => ability.toUpperCase()).join(", ")}`}
        </p>
      )}
      {/* A multiclass build needs 13 in each class's primary ability; the server checks it level by level. */}
      {multiclass && (
        <p className="cb-note">
          Multiclassing:{" "}
          {context.classes
            .map(({ record }) =>
              record.multiclassPrerequisites
                ? `${record.name} ${record.multiclassPrerequisites.minimums
                    .map((minimum) => `${minimum.ability.toUpperCase()} ${minimum.minimum}`)
                    .join(record.multiclassPrerequisites.mode === "any" ? " or " : " and ")}`
                : `${record.name} has no minimum`
            )
            .join(" · ")}
        </p>
      )}
      <AbilityScoreAllocator
        mode={assignMode ? "assign" : "spend"}
        rows={allocatorRows}
        methods={allowedMethods.map((entry) => ({ value: entry, label: METHOD_LABELS[entry] }))}
        method={method}
        onMethodChange={setMethod}
        methodHint={
          method === "custom"
            ? `Your GM's formula: ${policy.customFormula}`
            : method === "roll"
              ? `Rolled with ${ABILITY_ROLL_FORMULA}.`
              : method === "point-buy"
                ? `Spend ${POINT_BUY_BUDGET} points across scores 8-15.`
                : `Assign ${STANDARD_ARRAY.join(", ")}, one each.`
        }
        pool={
          assignMode
            ? draft.abilityPool.map((entry) => ({
                id: entry.id,
                value: entry.value,
                assignedTo: ABILITIES.find((ability) => draft.poolAssignment[ability] === entry.id) ?? null
              }))
            : undefined
        }
        onAssign={
          assignMode
            ? (abilityId, poolId) =>
                editDraft((current) => {
                  const cleared = Object.fromEntries(
                    Object.entries(current.poolAssignment).map(([key, value]) => [key, value === poolId ? null : value])
                  );
                  return { ...current, poolAssignment: { ...cleared, [abilityId]: poolId } };
                })
            : undefined
        }
        onScoreChange={
          assignMode
            ? undefined
            : (abilityId, score) => patch({ spendScores: { ...draft.spendScores, [abilityId]: score } })
        }
        budget={assignMode ? undefined : { spent, total: POINT_BUY_BUDGET }}
        toolbar={
          assignMode && method !== "standard-array" ? (
            <DiceInputRow
              label={`Ability scores (${draft.abilityPool.length} of 6)`}
              notation={rollFormula}
              mode={abilityEntry}
              onModeChange={onAbilityEntryChange}
              rollLabel="Roll the rest for me"
              onRoll={rollAllScores}
              onManual={addRolledScore}
              onReroll={
                draft.abilityPool.length > 0
                  ? () => patch({ abilityPool: [], poolAssignment: {}, abilityRollId: undefined })
                  : undefined
              }
              result={
                draft.abilityPool.length > 0 ? draft.abilityPool.map((entry) => entry.value).join(", ") : undefined
              }
              min={rollBounds.min}
              max={rollBounds.max}
              busy={rolls.rolling || rollingSix}
              complete={draft.abilityPool.length >= 6}
              manualAllowed={mayTypeDice}
              hint={
                mayTypeDice
                  ? `Roll them here, or type what your own dice showed (${rollBounds.min}-${rollBounds.max}).`
                  : "The table rolls all six at once, and everyone sees the roll."
              }
            />
          ) : undefined
        }
      />

      {options && (
        <section className="cb-offer">
          <div className="cb-offer-head">
            {/* The SegmentedControl and the Selects below are the readout. */}
            <h3 className="cb-offer-title">{context.background?.name} ability increases</h3>
          </div>
          <SegmentedControl
            ariaLabel="Ability increase spread"
            value={draft.backgroundBonus.length === 3 ? "1/1/1" : draft.backgroundBonus.length === 2 ? "2/1" : ""}
            onChange={(next) =>
              patch({
                backgroundBonus:
                  next === "2/1"
                    ? [
                        { ability: options.from[0] as Ability, amount: 2 },
                        { ability: options.from[1] as Ability, amount: 1 }
                      ]
                    : options.from.slice(0, 3).map((ability) => ({ ability: ability as Ability, amount: 1 }))
              })
            }
            options={options.spreads.map((legal) => ({
              value: legal.join("/"),
              label: `+${legal.join(" / +")}`
            }))}
          />
          <div className="cb-asi-rows">
            {draft.backgroundBonus.map((entry, index) => (
              <label key={index} className="cb-asi-row">
                <span className="cb-asi-label">+{entry.amount} to</span>
                <Select
                  value={entry.ability}
                  aria-label={`Ability to raise by ${entry.amount}`}
                  onChange={(event) =>
                    patch({
                      backgroundBonus: draft.backgroundBonus.map((row, position) =>
                        position === index ? { ...row, ability: event.target.value as Ability } : row
                      )
                    })
                  }
                >
                  {options.from.map((ability) => (
                    <option key={ability} value={ability}>
                      {ABILITY_LABELS[ability as Ability]}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="cb-offer">
        <div className="cb-offer-head">
          <h3 className="cb-offer-title">Hit points</h3>
          {/* The hit die and CON modifier that decide the hit points about to be rolled. */}
          <span className="cb-offer-count tabular" role="status">
            {multiclass ? dice.join("/") : hitDie} · CON{" "}
            {base.con == null
              ? "—"
              : abilityModifier(base.con + bonuses.con) >= 0
                ? `+${abilityModifier(base.con + bonuses.con)}`
                : abilityModifier(base.con + bonuses.con)}
          </span>
        </div>
        {/* The rule `character-build.ts` applies, said in table terms. */}
        <p className="cb-offer-help">
          Level 1 is always the full die. From level 2 up, take the average or roll -{" "}
          {policy.hitPointRollFloor === "average"
            ? "at this table a roll below the average is raised to it."
            : "a roll counts as rolled, even below the average."}{" "}
          Rolled HP is remembered: leveling down and back up restores it.
        </p>
        <SegmentedControl
          ariaLabel="How to gain hit points"
          value={draft.hpMode}
          onChange={(next) => patch({ hpMode: next as BuilderDraft["hpMode"], hpEntries: [] })}
          options={[
            {
              value: "average",
              label: multiclass ? "Average of each level's die" : `Average (${hitDieAverage(hitDie)} per level)`
            },
            // Typing physical dice is the GM's, or every player's at a table that allows it.
            ...(mayTypeDice ? [{ value: "entries", label: "Enter rolls" }] : []),
            { value: "roll", label: "Table rolls" }
          ]}
        />
        {draft.hpMode === "roll" && draft.level > 1 && (
          <p className="cb-note">
            {multiclass
              ? `The table rolls each level's own die (${context.classes
                  .map(({ record }) => `${record.hitDie} for ${record.name}`)
                  .join(", ")}) for levels 2 to ${draft.level} when you finish, and everyone sees the roll.`
              : `The table rolls a ${hitDie} for each level from 2 to ${draft.level} when you finish, and everyone sees the roll.`}{" "}
            Rolls already on this character are kept.
          </p>
        )}
        {draft.hpMode === "entries" &&
          (draft.level === 1 ? (
            <p className="cb-note">A level 1 character rolls nothing — your hit points are the full {hitDie}.</p>
          ) : (
            <DiceInputRow
              label={
                multiclass && nextLevel <= draft.level
                  ? `Levels 2-${draft.level} (${draft.hpEntries.length} of ${draft.level - 1}) · level ${nextLevel} is a ${dieAt(nextLevel)}`
                  : `Levels 2-${draft.level} (${draft.hpEntries.length} of ${draft.level - 1})`
              }
              notation={`1${dieAt(Math.min(nextLevel, draft.level))}`}
              mode={hpEntry}
              onModeChange={onHpEntryChange}
              rollLabel="Roll the rest for me"
              onRoll={rollAllHp}
              onManual={addHpRoll}
              onReroll={draft.hpEntries.length > 0 ? () => patch({ hpEntries: [] }) : undefined}
              result={draft.hpEntries.length > 0 ? draft.hpEntries.join(", ") : undefined}
              min={1}
              max={hitDieFaces(dieAt(Math.min(nextLevel, draft.level)))}
              busy={rolls.rolling}
              complete={draft.hpEntries.length >= draft.level - 1}
            />
          ))}
      </section>
    </>
  );
}
