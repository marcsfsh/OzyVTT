import { Fragment, useState } from "react";
import {
  resolveSpellcasting,
  type ActorDefinition,
  type ContentSpellSummary,
  type GmActor,
  type PlayerActor
} from "@vtt/domain";
import { cantripTierAt } from "@vtt/content-srd-5.2.1/schemas";
import { spellAttackBonus, spellSaveDc } from "@vtt/rules-5e";
import { SpellCard, useSpellReference } from "./spells";
import { ordinal, signed, titleCase } from "./format";
import type { SheetEdit } from "./useSheetEdit";
import type { SheetRolls } from "./useSheetRolls";

type SheetSpell = Readonly<{ id: string; name: string; level: number; actionId?: string | null }>;

/**
 * The damage a spell deals when cast at `level`: the single source for both the displayed effect
 * and the rolled formula. Uses the SRD upcast row for that slot if any, and a cantrip's row for the
 * character's level (the server's built action reads the same rows), else the base damage. For
 * target scaling (N darts/rays/beams) the formula repeats the die `targetCount` times so the full
 * amount is rolled.
 */
function spellEffectAt(
  content: ContentSpellSummary | undefined,
  baseLevel: number,
  level: number,
  characterLevel = 1
): { label: string | null; formula: string | null } {
  const scaled =
    baseLevel === 0
      ? cantripTierAt(content?.cantripScaling ?? [], characterLevel)
      : level > baseLevel
        ? content?.castingOptions.find((option) => option.level === level)
        : undefined;
  const die = scaled?.damageRoll ?? content?.damageRoll ?? null;
  const targets = scaled?.targetCount ?? null;
  if (die && targets && targets > 1)
    return { label: `${targets}× ${die}`, formula: Array.from({ length: targets }, () => die).join(" + ") };
  if (die) return { label: die, formula: die };
  if (targets) return { label: `${targets} targets`, formula: null };
  return { label: null, formula: null };
}

/**
 * Per-spell "Cast at" control: a slot-level dropdown (remaining/total per level; empty levels
 * disabled) and a Cast button. The parent owns the slot-spend and roll emits. Leveled spells only;
 * returns null when no slot at or above the spell's level exists.
 */
function SpellCastControls({
  spell,
  content,
  slotLevels,
  slotMaxByLevel,
  liveRemaining,
  busy,
  onCastSlot,
  onCastCantrip
}: Readonly<{
  spell: Readonly<{ id: string; name: string; level: number }>;
  content: ContentSpellSummary | undefined;
  slotLevels: readonly number[];
  slotMaxByLevel: ReadonlyMap<number, number>;
  liveRemaining: ReadonlyMap<number, number>;
  busy: boolean;
  onCastSlot: (level: number) => void;
  onCastCantrip: () => void;
}>) {
  const isCantrip = spell.level === 0;
  const options = isCantrip ? [] : slotLevels.filter((level) => level >= spell.level);
  const [castLevel, setCastLevel] = useState(options[0] ?? spell.level);
  const level = options.includes(castLevel) ? castLevel : (options[0] ?? spell.level);
  const remainingAt = (slot: number) => liveRemaining.get(slot) ?? slotMaxByLevel.get(slot) ?? 0;
  // The effect at the selected level, from the same helper the Cast button rolls. Three grid cells
  // (helper · slot · Cast) that align across rows.
  const { label: effect } = spellEffectAt(content, spell.level, level);
  const canCast = isCantrip || (options.length > 0 && remainingAt(level) > 0);
  return (
    <>
      <span
        className="sheet-cast-effect"
        aria-hidden={effect ? undefined : true}
        title={effect ? `Effect at ${isCantrip ? "your level" : ordinal(level)}` : undefined}
      >
        {effect ?? ""}
      </span>
      {isCantrip ? (
        <span className="sheet-cast-slot at-will">At will</span>
      ) : options.length > 0 ? (
        <select
          className="sheet-cast-select"
          aria-label={`Cast ${spell.name} at level`}
          value={level}
          disabled={busy}
          onChange={(event) => setCastLevel(Number(event.target.value))}
        >
          {options.map((slot) => (
            <option key={slot} value={slot} disabled={remainingAt(slot) === 0}>
              {ordinal(slot)} · {remainingAt(slot)}/{slotMaxByLevel.get(slot) ?? 0}
              {slot > spell.level ? " · upcast" : ""}
            </option>
          ))}
        </select>
      ) : (
        <span className="sheet-cast-slot">no slots</span>
      )}
      <button
        type="button"
        className="sheet-cast-btn"
        disabled={busy || !canCast}
        onClick={() => (isCantrip ? onCastCantrip() : onCastSlot(level))}
      >
        Cast
      </button>
    </>
  );
}

/**
 * The spells section: casting stats per casting class, slot pips, prepared toggles and, for a
 * player character, a "Cast at" control per spell. Casting spends the slot, then routes a spell that
 * targets a creature through the structured flow on the caster's turn, or rolls its SRD damage.
 */
export function SheetSpells({
  actor,
  definition,
  busy,
  edit,
  rolls,
  onFeedback,
  routeSpell,
  spellSaveDcBonus = 0
}: Readonly<{
  actor: GmActor | PlayerActor;
  definition: ActorDefinition;
  busy: boolean;
  edit: SheetEdit;
  rolls: SheetRolls;
  onFeedback: (text: string) => void;
  /** Hands a spell to the structured flow; false when it has no server-resolvable action now. */
  routeSpell: (spell: SheetSpell) => boolean;
  /** The server's sum of standing spell-save-DC riders (an item, a feat), which the cast DC includes. */
  spellSaveDcBonus?: number;
}>) {
  const { rollFlat } = rolls;
  const spellcasting = definition.spellcasting;
  const character = definition.character;
  // Cantrips scale with the character's total level, not any one class's.
  const characterLevel = Math.max(
    1,
    (character?.classes ?? []).reduce((sum, entry) => sum + entry.level, 0)
  );
  // SRD spell reference (session-cached): base and upcast damage for the "Cast at" control.
  const spellRef = useSpellReference();
  const [openSpell, setOpenSpell] = useState<ContentSpellSummary | null>(null);
  if (!spellcasting) return null;
  const preparedIds = new Set<string>(actor.preparedSpellIds ?? []);
  const liveSlotRemaining = new Map<number, number>(
    (actor.spellSlots ?? []).map((slot) => [slot.level, slot.remaining])
  );
  const pact = actor.pactSlots ?? null;
  // `resolveSpellcasting` applies the resolution order (per-class entry by classId, the lone-entry
  // shortcut, then top-level fields), so a multiclass caster gets one row per casting class.
  const casterEntries = spellcasting.classes ?? [];
  const casterRows = (casterEntries.length > 0 ? casterEntries.map((entry) => entry.classId) : [undefined]).flatMap(
    (classId) => {
      const resolved = resolveSpellcasting(spellcasting, classId);
      if (!resolved) return [];
      const dc =
        (resolved.saveDc ?? spellSaveDc(definition.abilityScores[resolved.ability], definition.proficiencyBonus)) +
        spellSaveDcBonus;
      const attack =
        resolved.attackBonus ??
        spellAttackBonus(definition.abilityScores[resolved.ability], definition.proficiencyBonus);
      const name = classId
        ? (character?.classes?.find((entry) => entry.id === classId)?.name ?? titleCase(classId))
        : null;
      return [{ key: classId ?? "primary", name, ability: resolved.ability, dc, attack }];
    }
  );
  // "Cast at" support: SRD spells by id, and the character's slot pools by level.
  const spellIndex = new Map(spellRef.map((entry) => [entry.id, entry]));
  const slotMaxByLevel = new Map<number, number>((spellcasting.slots ?? []).map((slot) => [slot.level, slot.max]));
  const slotLevels = [...slotMaxByLevel.entries()]
    .filter(([, max]) => max > 0)
    .map(([level]) => level)
    .sort((a, b) => a - b);
  // Cast a leveled spell at a chosen level: spend the slot, then roll the SRD upcast damage for a
  // damaging spell. Both are server-checked.
  const castSpell = (spell: SheetSpell, level: number) => {
    const max = slotMaxByLevel.get(level) ?? 0;
    const rem = liveSlotRemaining.get(level) ?? max;
    if (max <= 0 || rem <= 0) {
      onFeedback(`No ${ordinal(level)}-level slots remain.`);
      return;
    }
    const content = spellIndex.get(spell.id);
    // Same helper as the displayed effect, so the roll matches what is shown.
    const { formula } = spellEffectAt(content, spell.level, level);
    const types = content && content.damageTypes.length ? ` ${content.damageTypes.join("/")}` : "";
    void edit("character:set-slot", { actorId: actor.id, level, remaining: rem - 1 }).then((result) => {
      if (!result.ok) return;
      // The slot is spent; on your turn a spell that targets a creature goes through the structured flow.
      // A utility spell stays a plain note. Known limitation: an upcast spell resolves at its base dice
      // here; the GM can adjust the parked damage.
      if (routeSpell(spell)) return;
      // Digital rolls the damage; manual prompts for the physical total.
      if (formula) void rollFlat(formula, "damage", `${spell.name} at ${ordinal(level)}${types}`);
      else onFeedback(`Cast ${spell.name} at ${ordinal(level)} - spent a ${ordinal(level)}-level slot.`);
    });
  };
  // Cantrips cost no slot: roll a damaging cantrip's die, or note a utility cast.
  const castCantrip = (spell: SheetSpell) => {
    // A cantrip that targets a creature routes through the structured flow on your turn.
    if (routeSpell(spell)) return;
    const content = spellIndex.get(spell.id);
    const { formula } = spellEffectAt(content, spell.level, spell.level, characterLevel);
    if (formula)
      void rollFlat(
        formula,
        "damage",
        `${spell.name}${content && content.damageTypes.length ? ` ${content.damageTypes.join("/")}` : ""}`
      );
    else onFeedback(`Cast ${spell.name}.`);
  };
  return (
    <>
      <section className="sheet-section">
        <h3>Spells</h3>
        <div className="sheet-spellcast-fields">
          {casterRows.map((row) => (
            <Fragment key={row.key}>
              <div className="sheet-spellcast-field">
                <span>{row.name ? `${row.name} caster` : "Caster"}</span>
                <strong>{row.ability.toUpperCase()}</strong>
              </div>
              <div className="sheet-spellcast-field">
                <span>Save DC</span>
                <strong>{row.dc}</strong>
              </div>
              <div className="sheet-spellcast-field">
                <span>Spell atk</span>
                <strong>{signed(row.attack)}</strong>
              </div>
            </Fragment>
          ))}
        </div>
        {(() => {
          type Spell = (typeof spellcasting.spells)[number];
          const groups = new Map<number, Spell[]>();
          for (const spell of spellcasting.spells) {
            const list = groups.get(spell.level) ?? [];
            list.push(spell);
            groups.set(spell.level, list);
          }
          return [...groups.keys()]
            .sort((a, b) => a - b)
            .map((level) => {
              const spells = [...groups.get(level)!].sort((a, b) => a.name.localeCompare(b.name));
              const max = slotMaxByLevel.get(level) ?? 0;
              const remaining = liveSlotRemaining.get(level) ?? max;
              return (
                <div key={level} className="sheet-spell-group">
                  <div className="sheet-spell-group-head">
                    <h4>{level === 0 ? "Cantrips" : `${ordinal(level)} Level`}</h4>
                    {level > 0 && max > 0 && (
                      <div
                        className="sheet-slot-pips"
                        role="group"
                        aria-label={`Level ${level} spell slots (${remaining} of ${max} left)`}
                      >
                        {Array.from({ length: max }, (_, index) => (
                          <button
                            key={index}
                            type="button"
                            className={`sheet-pip${index < remaining ? " filled" : ""}`}
                            disabled={busy}
                            aria-label={`${index < remaining ? "Spend" : "Restore"} a level ${level} slot`}
                            onClick={() => {
                              void edit("character:set-slot", {
                                actorId: actor.id,
                                level,
                                remaining: index < remaining ? index : index + 1
                              });
                            }}
                          />
                        ))}
                        <span className="sheet-slot-count">
                          {remaining}/{max}
                        </span>
                      </div>
                    )}
                  </div>
                  <ul className={`sheet-spell-list${actor.kind === "player-character" ? " castable" : ""}`}>
                    {spells.map((spell) => {
                      const isPrepared = preparedIds.has(spell.id) || spell.alwaysPrepared;
                      const toggleable = spell.level > 0 && !spell.alwaysPrepared;
                      return (
                        <li key={spell.id}>
                          {spell.level === 0 ? (
                            <span className="sheet-prep-tag cantrip">Cantrip</span>
                          ) : toggleable ? (
                            <button
                              type="button"
                              className={`sheet-prep-tag toggle${isPrepared ? " on" : ""}`}
                              disabled={busy}
                              title={isPrepared ? "Prepared - tap to unprepare" : "Not prepared - tap to prepare"}
                              onClick={() => {
                                void edit("character:set-prepared", {
                                  actorId: actor.id,
                                  spellId: spell.id,
                                  prepared: !isPrepared
                                });
                              }}
                            >
                              {isPrepared ? "Prepared" : "Prepare"}
                            </button>
                          ) : (
                            <span
                              className="sheet-prep-tag always"
                              title="Always prepared — doesn't count against your prepared limit"
                            >
                              Always
                            </span>
                          )}
                          {spellIndex.get(spell.id) ? (
                            <button
                              type="button"
                              className="sheet-spell-name sheet-spell-link"
                              title={`Show the ${spell.name} rules`}
                              onClick={() => setOpenSpell(spellIndex.get(spell.id) ?? null)}
                            >
                              {spell.name}
                            </button>
                          ) : (
                            <span className="sheet-spell-name">{spell.name}</span>
                          )}
                          {actor.kind === "player-character" && (
                            <SpellCastControls
                              spell={spell}
                              content={spellIndex.get(spell.id)}
                              slotLevels={slotLevels}
                              slotMaxByLevel={slotMaxByLevel}
                              liveRemaining={liveSlotRemaining}
                              busy={busy}
                              onCastSlot={(castLevel) => castSpell(spell, castLevel)}
                              onCastCantrip={() => castCantrip(spell)}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            });
        })()}
        {pact ? (
          <p className="sheet-entry">
            Pact Magic: {ordinal(pact.level)}-level slots, {pact.remaining} remaining.
          </p>
        ) : null}
      </section>
      {openSpell && <SpellCard spell={openSpell} onClose={() => setOpenSpell(null)} />}
    </>
  );
}
