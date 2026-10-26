import { useEffect, useId, useRef } from "react";
import type { AbilityId, ContentActionSummary } from "@vtt/domain";
import { Button, Select, Stepper } from "@vtt/ui";
import { useSkillCatalog } from "../content/catalogs";
import { ABILITY_WORDS } from "../dice/roll-call-words";
import { useRollPreference } from "../dice/roll-preference";
import { areaWords } from "./action-summary";
import { FaceEntry } from "./RollControls";
import { plainActionName } from "./format";
import type { TargetRow } from "../table/targetRows";
import { InFooter } from "../table/footerSlot";
import { ShapeChoices } from "./ShapeChoices";
import { revealInRegion } from "../lib/reveal";
import { objectChoicesOf, weaponChoicesOf, type CarriedRow } from "./weapon-choices";
import {
  clearTargeting,
  pickedArea,
  placeAnotherTemplate,
  setBoundItem,
  setObjectItem,
  setChoiceOption,
  setCheckSkill,
  setChosenAbility,
  setVitalityTo,
  setAidTo,
  setConditionChoice,
  setDamageType,
  setEffectOption,
  toggleWardType,
  setHealingShare,
  setShapeForm,
  setShapeGear,
  setShapingCreatures,
  setSummonPick,
  setSummonType,
  setTargetDarts,
  setTargetingSpend,
  SHAPING_CREATURE_PICKS,
  sharedOut,
  targetingReady,
  toggleConditionPick,
  toggleTarget,
  type TargetingSession
} from "./targeting";

/**
 * An SRD action that rolls nothing (Help, Dash, Dodge). Only the server's built-in rows are judged: a sheet's own
 * action reaches the picker without its healing, so it can't be told apart from one that rolls.
 */
export const rollsNothing = (action: ContentActionSummary): boolean =>
  action.builtin === true &&
  action.attackBonus === null &&
  action.saveAbility === null &&
  !action.checkSkills?.length &&
  action.damage.length === 0 &&
  !action.healing;

/**
 * Choosing who an action targets: one (radio) or several (checkboxes), or, for an area, where to drag
 * the template on the map; the skill a check action is made with (Search, Influence), the ability a
 * cast chooses (Hex) and the condition it imposes or ends (Blindness/Deafness, Lesser Restoration).
 * Cancel drops the action; Roll sends it to the server, which throws the attack's d20, or the face a
 * physical die shows is typed in its place while the table lets this browser type.
 */
export function ActionTargetPicker({
  picking,
  targets,
  onMap = false,
  busy,
  onRoll,
  onInvalidFace,
  insideNow,
  carried = [],
  carriedBy,
  onMoveFirst,
  onLookAtDamage
}: Readonly<{
  picking: TargetingSession;
  targets: ReadonlyArray<Pick<TargetRow, "id" | "label"> & Partial<TargetRow>>;
  /** Tokens on the map can be tapped to pick them too, so the heading says so. */
  onMap?: boolean;
  busy: boolean;
  /** `face` is a typed attack d20. */
  onRoll: (face?: number) => void;
  onInvalidFace?: (message: string) => void;
  /** For an area: who it covers where it is placed, of the creatures this viewer can see. The server decides. */
  insideNow?: readonly TargetRow[];
  /** What the acting creature carries, for a grant cast on one of its weapons (Magic Weapon). */
  carried?: readonly CarriedRow[];
  /** What another creature carries, for an action at its armor or weapon (a rust monster's Antennae). */
  carriedBy?: (actorId: string) => readonly CarriedRow[];
  /** Take the action's own move first (Pounce), when it has one that comes before the rest. */
  onMoveFirst?: () => void;
  /** Roll the damage and look at it before it counts, for an answer to it (Empowered Spell, Heroic Inspiration). */
  onLookAtDamage?: () => void;
}>) {
  const { mayType } = useRollPreference();
  // On a phone the panel under the map is short, so the picker scrolls up to show its first rows.
  const groupRef = useRef<HTMLDivElement | null>(null);
  const actionId = picking.action.id;
  useEffect(() => {
    const phone = window.matchMedia?.("(max-width: 979px)").matches ?? false;
    revealInRegion(groupRef.current, phone ? "start" : "nearest");
  }, [actionId]);
  const skillCatalog = useSkillCatalog();
  const group = useId();
  const ready = targetingReady(picking);
  const skillName = (id: string) => skillCatalog.items.find((skill) => skill.id === id)?.name ?? id;
  const darts = picking.darts;
  const assigned = darts ? Object.values(darts.counts).reduce((sum, count) => sum + count, 0) : 0;
  // A pool its user divides among the creatures picked (Preserve Life).
  const pool = picking.action.dividesHealing;
  const given = sharedOut(picking);
  const picks = picking.action.conditionPicks;
  // The level or "Cantrip" the list shows in brackets is noise once the action is chosen.
  const name = plainActionName(picking.action.name);
  // A summon that rolls nothing (Find Familiar) asks for its creature and is used, not rolled.
  const summoning =
    picking.action.summonChoices !== undefined &&
    picking.action.attackBonus === null &&
    picking.action.saveAbility === null &&
    picking.action.damage.length === 0;
  const verb = rollsNothing(picking.action) || summoning ? "Use" : "Roll";
  const where = onMap ? " on the map or in the list" : "";
  return (
    <div className="action-targeting" role="group" aria-label={`Targets for ${name}`} ref={groupRef}>
      {picking.mode === "none" ? (
        <p className="action-targeting-head">
          <strong>{name}</strong> ·{" "}
          {picking.action.checkSkills?.length
            ? "choose the skill, then Roll."
            : summoning
              ? `choose its ${picking.action.summonChoices?.forms ? "form" : "type"}, then Use.`
              : `no target to choose.${verb === "Roll" ? " Roll to use it." : ""}`}
        </p>
      ) : picking.mode === "template" ? (
        <>
          {/* The area keeps the action's own size: the drag only places and points it. */}
          <p className="action-targeting-head">
            <strong>{name}</strong> · {pickedArea(picking) ? areaWords(pickedArea(picking)!) : "area"}
          </p>
          <p className="action-targeting-hint">
            {picking.template?.placed
              ? "Drag again to move it. Everything inside is caught when you roll."
              : "Drag on the map to place it. Everything inside is caught when you roll."}
          </p>
          {/* Several areas a use (Fire Storm's Cubes): each set down in turn, all caught once when you roll. */}
          {picking.template?.count !== undefined && (
            <p className="action-targeting-hint">
              {(picking.template.others?.length ?? 0) + (picking.template.placed ? 1 : 0)} of up to{" "}
              {picking.template.count} placed.
              {picking.action.area?.contiguous ? " Each must touch another." : ""}
            </p>
          )}
          {picking.template?.count !== undefined &&
            picking.template.placed &&
            (picking.template.others?.length ?? 0) + 1 < picking.template.count && (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => placeAnotherTemplate()}>
                Place another
              </Button>
            )}
          {picking.template?.placed && insideNow && (
            <>
              <p className="action-targeting-inside">Inside now · {insideNow.length}</p>
              <ul className="action-target-list scroll-y">
                {insideNow.map((target) => (
                  <li key={target.id} className="action-target is-inside">
                    <TargetAvatar target={target} />
                    <span className="action-target-name">{target.label}</span>
                  </li>
                ))}
              </ul>
              <p className="action-targeting-hint">Only those you can see are listed.</p>
            </>
          )}
        </>
      ) : (
        <>
          <p className="action-targeting-head">
            <strong>{name}</strong> · {picking.mode === "single" ? "choose one target" : "choose targets"}
            {where}
            {darts
              ? `. ${darts.total} darts: ${assigned >= darts.total ? "all assigned" : `${darts.total - Math.min(assigned, darts.total)} left, which go round the chosen targets in order`}.`
              : ""}
            {pool !== undefined
              ? `. ${pool} Hit Points to divide: ${given > pool ? `${given - pool} too many given` : `${pool - given} left`}. With none given, they are split evenly.`
              : ""}
          </p>
          <ul className="action-target-list scroll-y">
            {targets.map((target) => (
              <li key={target.id}>
                <label
                  className={`action-target${picking.selected.includes(target.id) ? " is-picked" : ""}${target.unavailable ? " is-unavailable" : ""}`}
                >
                  <input
                    type={picking.mode === "single" ? "radio" : "checkbox"}
                    name={group}
                    checked={picking.selected.includes(target.id)}
                    disabled={target.unavailable !== undefined && !picking.selected.includes(target.id)}
                    onChange={() => toggleTarget(target.id)}
                  />
                  {target.initials !== undefined && <TargetAvatar target={target as TargetRow} />}
                  <span className="action-target-name">{target.label}</span>
                  {target.detail && <span className="action-target-detail">{target.detail}</span>}
                  {target.unavailable && <span className="action-target-reason">{target.unavailable}</span>}
                </label>
                {darts && picking.selected.includes(target.id) && (
                  <Stepper
                    value={darts.counts[target.id] ?? 1}
                    min={1}
                    max={darts.total}
                    aria-label={`Darts at ${target.label}`}
                    onChange={(count) => setTargetDarts(target.id, count)}
                  />
                )}
                {pool !== undefined && picking.selected.includes(target.id) && (
                  <Stepper
                    value={picking.healingShares?.[target.id] ?? 0}
                    min={0}
                    max={pool}
                    aria-label={`Hit Points for ${target.label}`}
                    onChange={(points) => setHealingShare(target.id, points)}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {picking.action.checkSkills && picking.action.checkSkills.length > 0 && (
        <label className="action-damage-type">
          <span>Skill</span>
          <Select
            value={picking.skill ?? ""}
            onChange={(event) => setCheckSkill(event.target.value === "" ? undefined : event.target.value)}
          >
            {/* Escape a Grapple's default is the better of its two skills, which the server works out. */}
            {picking.action.id === "escape-grapple" && <option value="">The better one</option>}
            {picking.action.checkSkills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name ?? skillName(skill.id)} ({ABILITY_WORDS[skill.ability]})
              </option>
            ))}
          </Select>
        </label>
      )}
      {picking.action.choosesAbility && (
        <label className="action-damage-type">
          <span>Ability</span>
          <Select value={picking.ability ?? ""} onChange={(event) => setChosenAbility(event.target.value as AbilityId)}>
            {picking.ability === undefined && <option value="">Choose one</option>}
            {(Object.keys(ABILITY_WORDS) as AbilityId[]).map((ability) => (
              <option key={ability} value={ability}>
                {ABILITY_WORDS[ability]}
              </option>
            ))}
          </Select>
        </label>
      )}
      {picking.action.vitality && (
        <label className="action-damage-type">
          <span>Temporary Hit Points to</span>
          <Select
            value={picking.vitalityTo ?? picking.attackerId}
            onChange={(event) => setVitalityTo(event.target.value)}
          >
            {[
              { id: picking.attackerId, label: targets.find((row) => row.id === picking.attackerId)?.label ?? "You" },
              ...targets.filter((row) => row.id !== picking.attackerId)
            ].map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </Select>
        </label>
      )}
      {/* Land's Aid: one creature in the area regains its own roll of Hit Points. */}
      {picking.action.areaHeal && (
        <label className="action-damage-type">
          <span>Regains {picking.action.areaHeal.formula} Hit Points</span>
          <Select value={picking.aidTo ?? ""} onChange={(event) => setAidTo(event.target.value)}>
            <option value="">No one</option>
            {targets.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </Select>
        </label>
      )}
      {/* An action whose user picks its cost (Lay on Hands): how much of the pool goes into it. The server refuses
          more than is left. */}
      {picking.action.useCost === "chosen" && (
        <Stepper
          label={picks ? "Hit Points to restore" : "Points to spend"}
          value={picking.spend ?? 1}
          onChange={setTargetingSpend}
          min={picks ? 0 : 1}
          max={picking.action.usesLimit ?? 100}
          disabled={busy}
          aria-label={`How much of ${picking.action.name} to spend`}
          className="action-targeting-spend"
        />
      )}
      {picking.action.damageTypes && (
        <label className="action-damage-type">
          <span>Damage type</span>
          <Select
            value={picking.damageType ?? picking.action.damageTypes[0]}
            onChange={(event) => setDamageType(event.target.value)}
          >
            {picking.action.damageTypes.map((type) => (
              <option key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </Select>
        </label>
      )}
      <ChoicePicks picking={picking} targets={targets} carried={carried} carriedBy={carriedBy} />
      <ShapeChoices
        action={picking.action}
        choice={picking}
        targets={targets.filter((target) => picking.selected.includes(target.id))}
        onForm={setShapeForm}
        onGear={setShapeGear}
        onOption={setEffectOption}
        onWardType={toggleWardType}
      />
      <ShapingPicks
        picking={picking}
        group={group}
        rows={
          picking.mode === "template"
            ? (insideNow ?? [])
            : targets.filter((target) => picking.selected.includes(target.id))
        }
      />
      {picking.action.summonChoices?.forms && (
        <label className="action-damage-type">
          <span>Form</span>
          <Select
            value={String(
              Math.max(
                0,
                picking.action.summonChoices.forms.findIndex(
                  (row) => row.monsterId === picking.summonPick?.monsterId && row.form === picking.summonPick?.form
                )
              )
            )}
            onChange={(event) => setSummonPick(Number(event.target.value))}
          >
            {picking.action.summonChoices.forms.map((row, index) => (
              <option key={`${row.monsterId}:${row.form ?? ""}`} value={index}>
                {row.label}
              </option>
            ))}
          </Select>
        </label>
      )}
      {picking.action.summonChoices?.creatureTypes && (
        <label className="action-damage-type">
          <span>Type</span>
          <Select
            value={picking.summonType ?? picking.action.summonChoices.creatureTypes[0]}
            onChange={(event) => setSummonType(event.target.value)}
          >
            {picking.action.summonChoices.creatureTypes.map((type) => (
              <option key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </Select>
        </label>
      )}
      {picking.action.conditionChoices && picking.action.conditionChoices.length > 1 && (
        <label className="action-damage-type">
          <span>{picking.action.saveAbility ? "Condition on a failed save" : "Condition to end"}</span>
          <Select
            value={picking.conditionId ?? picking.action.conditionChoices[0]}
            onChange={(event) => setConditionChoice(event.target.value)}
          >
            {picking.action.conditionChoices.map((id) => (
              <option key={id} value={id}>
                {id.charAt(0).toUpperCase() + id.slice(1)}
              </option>
            ))}
          </Select>
        </label>
      )}
      {/* Conditions the touch also ends, each for points of the pool (Restoring Touch). */}
      {picks && (
        <fieldset className="action-condition-picks">
          <legend>Also end · {picks.pointsEach} points each</legend>
          <ul className="action-target-list">
            {picks.conditions.map((id) => (
              <li key={id}>
                <label className={`action-target${picking.conditionIds?.includes(id) ? " is-picked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={picking.conditionIds?.includes(id) ?? false}
                    onChange={() => toggleConditionPick(id)}
                  />
                  <span className="action-target-name">{id.charAt(0).toUpperCase() + id.slice(1)}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {/* On a phone Cancel and Roll go to the bar under the thumb. */}
      <InFooter>
        <div className="action-targeting-buttons">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => clearTargeting()}>
            Cancel
          </Button>
          {picking.action.moveFirst && onMoveFirst && (
            <Button type="button" variant="secondary" disabled={busy} onClick={onMoveFirst}>
              Move first
            </Button>
          )}
          {onLookAtDamage && (
            <Button type="button" variant="secondary" disabled={busy || !ready} onClick={onLookAtDamage}>
              {picking.action.damage.length === 0 && picking.action.healing
                ? "Roll healing first"
                : "Roll damage first"}
            </Button>
          )}
          <button type="button" className="encounter-primary" disabled={busy || !ready} onClick={() => onRoll()}>
            {verb} {name}
          </button>
        </div>
      </InFooter>
      {mayType && ready && picking.mode === "single" && picking.action.attackBonus !== null && (
        <div className="action-targeting-face">
          <FaceEntry
            label={`Attack d20 for ${picking.action.name}`}
            busy={busy}
            onInvalid={onInvalidFace}
            onFace={(face) => onRoll(face)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * What the action asks for as it resolves: one option (Fire Shield's warm or chill), one for each selected target
 * (Eyebite's effect on each), the carried weapon a grant binds to (Magic Weapon), and any carried item (Identify).
 * Each starts on the first, as the server reads none; the item starts on none.
 */
function ChoicePicks({
  picking,
  targets,
  carried,
  carriedBy
}: Readonly<{
  picking: TargetingSession;
  targets: ReadonlyArray<Pick<TargetRow, "id" | "label">>;
  carried: readonly CarriedRow[];
  carriedBy?: (actorId: string) => readonly CarriedRow[];
}>) {
  const choices = picking.action.choices;
  if (!choices) return null;
  const options = choices.options ?? [];
  const weapons = weaponChoicesOf(carried, choices.bindsWeapon);
  // The one target's armor and weapons, once it is picked.
  const holder = picking.selected.length === 1 ? picking.selected[0]! : null;
  const objects = holder && carriedBy ? objectChoicesOf(carriedBy(holder), choices.object) : [];
  const optionSelect = (key: string, label: string, value: string | undefined, onPick: (id: string) => void) => (
    <label className="action-damage-type" key={key}>
      <span>{label}</span>
      <Select value={value ?? options[0]?.id} onChange={(event) => onPick(event.target.value)}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </label>
  );
  return (
    <>
      {options.length > 0 &&
        !choices.optionsPerTarget &&
        optionSelect("one", "Choice", picking.optionId, (id) => setChoiceOption(id))}
      {options.length > 0 &&
        choices.optionsPerTarget &&
        picking.selected.map((targetId) =>
          optionSelect(
            targetId,
            `For ${targets.find((target) => target.id === targetId)?.label ?? "this target"}`,
            picking.targetOptions?.[targetId] ?? picking.optionId,
            (id) => setChoiceOption(id, targetId)
          )
        )}
      {choices.bindsWeapon && (
        <label className="action-damage-type">
          <span>
            {choices.bindsWeapon.ammunition === "only"
              ? "Ammunition"
              : choices.bindsWeapon.ammunition === "also"
                ? "Weapon or ammunition"
                : "Weapon"}
          </span>
          {weapons.length > 0 ? (
            <Select value={picking.itemId ?? weapons[0]!.id} onChange={(event) => setBoundItem(event.target.value)}>
              {weapons.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          ) : (
            <span>
              {choices.bindsWeapon.ammunition === "only"
                ? "No ammunition is carried."
                : "No weapon it can be used on is carried."}
            </span>
          )}
        </label>
      )}
      {choices.pickItem && (
        <label className="action-damage-type">
          <span>Item</span>
          <Select value={picking.itemId ?? ""} onChange={(event) => setBoundItem(event.target.value || undefined)}>
            <option value="">None</option>
            {carried
              .filter((row) => row.quantity > 0)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </Select>
        </label>
      )}
      {choices.object && objects.length > 0 && (
        <label className="action-damage-type">
          <span>Object</span>
          <Select
            value={picking.objectItemId ?? ""}
            onChange={(event) => setObjectItem(event.target.value === "" ? undefined : event.target.value)}
          >
            <option value="">Worn armor, else weapon in hand</option>
            {objects.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        </label>
      )}
    </>
  );
}

/**
 * The creatures a cast's shaping names among its targets: who Careful Spell or Sculpt Spells protects (up to its
 * count), and Heightened Spell's one target when the spell has several. Picked from the chosen targets, or from who the
 * placed area covers of the creatures this viewer can see. The server checks the picks.
 */
function ShapingPicks({
  picking,
  group,
  rows
}: Readonly<{
  picking: TargetingSession;
  group: string;
  rows: ReadonlyArray<Pick<TargetRow, "id" | "label">>;
}>) {
  const picks = (picking.shaping ?? []).filter(
    (entry) => SHAPING_CREATURE_PICKS.has(entry.id) && !(entry.id === "heightened-spell" && picking.mode === "single")
  );
  if (picks.length === 0) return null;
  const others = rows.filter((row) => row.id !== picking.attackerId);
  return (
    <>
      {picks.map((entry) => {
        const offer = picking.action.shaping?.options.find((candidate) => candidate.id === entry.id);
        const name = offer?.name ?? entry.id;
        const one = entry.id === "heightened-spell";
        const creatures = offer?.creatures;
        const limit = one
          ? 1
          : creatures?.plusLevel && picking.slotLevel !== undefined
            ? 1 + picking.slotLevel
            : (creatures?.count ?? 1);
        const chosen = entry.creatureIds ?? [];
        const flip = (id: string) =>
          setShapingCreatures(
            entry.id,
            one ? [id] : chosen.includes(id) ? chosen.filter((picked) => picked !== id) : [...chosen, id]
          );
        return (
          <fieldset key={entry.id} className="action-shaping">
            <legend>{one ? `${name} · its one target` : `${name} protects · up to ${limit}`}</legend>
            {others.length === 0 ? (
              <p className="action-targeting-hint">
                {picking.mode === "template" ? "Place the area first." : "Choose the targets first."}
              </p>
            ) : (
              <ul className="action-target-list">
                {others.map((row) => (
                  <li key={row.id}>
                    <label className={`action-target${chosen.includes(row.id) ? " is-picked" : ""}`}>
                      <input
                        type={one ? "radio" : "checkbox"}
                        name={`${group}-${entry.id}`}
                        checked={chosen.includes(row.id)}
                        disabled={!one && !chosen.includes(row.id) && chosen.length >= limit}
                        onChange={() => flip(row.id)}
                      />
                      <span className="action-target-name">{row.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        );
      })}
    </>
  );
}

/** A target's avatar as its token shows it: initials, and the number it carries among its kind. */
function TargetAvatar({ target }: Readonly<{ target: TargetRow }>) {
  return (
    <span className={`target-avatar ${target.kind}`} aria-hidden="true">
      {target.initials}
      {target.number !== undefined && <span className="target-avatar-number">{target.number}</span>}
    </span>
  );
}
