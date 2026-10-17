import { useEffect, useId, useRef } from "react";
import type { AbilityId } from "@vtt/domain";
import { Button, Select, Stepper } from "@vtt/ui";
import { useSkillCatalog } from "../content/catalogs";
import { ABILITY_WORDS } from "../dice/roll-call-words";
import { useRollPreference } from "../dice/roll-preference";
import { FaceEntry } from "./RollControls";
import { plainActionName } from "./format";
import type { TargetRow } from "../table/targetRows";
import { InFooter } from "../table/footerSlot";
import {
  clearTargeting,
  setCheckSkill,
  setChosenAbility,
  setDamageType,
  setTargetDarts,
  setTargetingSpend,
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
  onInvalidFace,
  insideNow
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
}>) {
  const { mayType } = useRollPreference();
  // On a phone the panel under the map is short, so the picker scrolls up to show its first rows.
  const groupRef = useRef<HTMLDivElement | null>(null);
  const actionId = picking.action.id;
  useEffect(() => {
    const phone = window.matchMedia?.("(max-width: 979px)").matches ?? false;
    groupRef.current?.scrollIntoView({ block: phone ? "start" : "nearest" });
  }, [actionId]);
  const skillCatalog = useSkillCatalog();
  const group = useId();
  const ready = targetingReady(picking);
  const skillName = (id: string) => skillCatalog.items.find((skill) => skill.id === id)?.name ?? id;
  const darts = picking.darts;
  const assigned = darts ? Object.values(darts.counts).reduce((sum, count) => sum + count, 0) : 0;
  // The level or "Cantrip" the list shows in brackets is noise once the action is chosen.
  const name = plainActionName(picking.action.name);
  const where = onMap ? " on the map or in the list" : "";
  return (
    <div className="action-targeting" role="group" aria-label={`Targets for ${name}`} ref={groupRef}>
      {picking.mode === "none" ? (
        <p className="action-targeting-head">
          <strong>{name}</strong> · choose the skill, then Roll.
        </p>
      ) : picking.mode === "template" ? (
        <>
          <p className="action-targeting-head">
            <strong>{name}</strong> · {picking.action.area?.sizeFeet}-foot {picking.action.area?.shape}
          </p>
          <p className="action-targeting-hint">
            {picking.template?.placed
              ? "Drag again to move it. Every creature inside is caught when you roll."
              : "Drag on the map to place it. Every creature inside is caught when you roll."}
          </p>
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
          </p>
          <ul className="action-target-list scroll-y">
            {targets.map((target) => (
              <li key={target.id}>
                <label className={`action-target${picking.selected.includes(target.id) ? " is-picked" : ""}`}>
                  <input
                    type={picking.mode === "single" ? "radio" : "checkbox"}
                    name={group}
                    checked={picking.selected.includes(target.id)}
                    onChange={() => toggleTarget(target.id)}
                  />
                  {target.initials !== undefined && <TargetAvatar target={target as TargetRow} />}
                  <span className="action-target-name">{target.label}</span>
                  {target.detail && <span className="action-target-detail">{target.detail}</span>}
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
      {/* An action whose user picks its cost (Lay on Hands): how much of the pool goes into it. The server refuses
          more than is left. */}
      {picking.action.useCost === "chosen" && (
        <Stepper
          label="Points to spend"
          value={picking.spend ?? 1}
          onChange={setTargetingSpend}
          min={1}
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
      {/* On a phone Cancel and Roll go to the bar under the thumb. */}
      <InFooter>
        <div className="action-targeting-buttons">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => clearTargeting()}>
            Cancel
          </Button>
          <button type="button" className="encounter-primary" disabled={busy || !ready} onClick={() => onRoll()}>
            Roll {name}
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

/** A target's avatar as its token shows it: initials, and the number it carries among its kind. */
function TargetAvatar({ target }: Readonly<{ target: TargetRow }>) {
  return (
    <span className={`target-avatar ${target.kind}`} aria-hidden="true">
      {target.initials}
      {target.number !== undefined && <span className="target-avatar-number">{target.number}</span>}
    </span>
  );
}
