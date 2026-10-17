import { useId } from "react";
import type { AbilityId } from "@vtt/domain";
import { Button, Select, Stepper } from "@vtt/ui";
import { useSkillCatalog } from "../content/catalogs";
import { ABILITY_WORDS } from "../dice/roll-call-words";
import { useRollPreference } from "../dice/roll-preference";
import { FaceEntry } from "./RollControls";
import {
  clearTargeting,
  setCheckSkill,
  setChosenAbility,
  setDamageType,
  setTargetDarts,
  targetingReady,
  toggleTarget,
  type TargetingSession
} from "./targeting";

/**
 * Choosing who an action targets: one (radio) or several (checkboxes), or, for an area, where to drag
 * the template on the map; the skill a check action is made with (Search, Influence) and the ability a
 * cast chooses (Hex). Back drops the action; Roll sends it to the server, which throws the attack's d20,
 * or the face a physical die shows is typed in its place while the table lets this browser type.
 */
export function ActionTargetPicker({
  picking,
  targets,
  onMap = false,
  busy,
  onRoll,
  onInvalidFace
}: Readonly<{
  picking: TargetingSession;
  targets: ReadonlyArray<{ id: string; label: string }>;
  /** The GM can also pick by clicking tokens on the map, so the heading says so. */
  onMap?: boolean;
  busy: boolean;
  /** `face` is a typed attack d20. */
  onRoll: (face?: number) => void;
  onInvalidFace?: (message: string) => void;
}>) {
  const { mayType } = useRollPreference();
  const skillCatalog = useSkillCatalog();
  const group = useId();
  const ready = targetingReady(picking);
  const skillName = (id: string) => skillCatalog.items.find((skill) => skill.id === id)?.name ?? id;
  const darts = picking.darts;
  const assigned = darts ? Object.values(darts.counts).reduce((sum, count) => sum + count, 0) : 0;
  return (
    <div className="action-targeting" role="group" aria-label={`Targets for ${picking.action.name}`}>
      {picking.mode === "none" ? (
        <p className="action-targeting-head">
          <strong>{picking.action.name}</strong> - choose the skill, then Roll.
        </p>
      ) : picking.mode === "template" ? (
        <p className="action-targeting-head">
          <strong>{picking.action.name}</strong> - drag the {picking.action.area?.sizeFeet}-ft{" "}
          {picking.action.area?.shape} on the map
          {picking.template?.placed ? " (placed - Roll to resolve)" : ", then Roll"}. Everyone under it is caught
          automatically.
        </p>
      ) : (
        <>
          <p className="action-targeting-head">
            <strong>{picking.action.name}</strong> -{" "}
            {picking.mode === "single" ? "choose one target" : "choose targets"}
            {onMap ? (picking.mode === "single" ? " (or click a token)" : " (or click tokens)") : ""}
            {darts
              ? `. ${darts.total} darts: ${assigned >= darts.total ? "all assigned" : `${darts.total - Math.min(assigned, darts.total)} left, which go round the chosen targets in order`}.`
              : ""}
          </p>
          <ul className="action-target-list scroll-y">
            {targets.map((target) => (
              <li key={target.id}>
                <label className="action-target">
                  <input
                    type={picking.mode === "single" ? "radio" : "checkbox"}
                    name={group}
                    checked={picking.selected.includes(target.id)}
                    onChange={() => toggleTarget(target.id)}
                  />
                  <span>{target.label}</span>
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
                {skillName(skill.id)} ({ABILITY_WORDS[skill.ability]})
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
      <div className="action-targeting-buttons">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => clearTargeting()}>
          Back
        </Button>
        <button type="button" className="encounter-primary" disabled={busy || !ready} onClick={() => onRoll()}>
          Roll {picking.action.name}
        </button>
      </div>
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
