import type { RefObject } from "react";
import type { ActorDefinition, ContentActionSummary, GmActor, PlayerActor } from "@vtt/domain";
import { abilityModifier as modifierOf, weaponAbilityModifierFrom } from "@vtt/rules-5e";
import { usesScopeLabel } from "./action-summary";
import { PlayerActionRunner } from "./PlayerActionRunner";
import { RichText } from "./RichText";
import { signed } from "./format";
import { sameName } from "./sheet-names";
import type { SheetRolls } from "./useSheetRolls";

type DefinitionAction = ActorDefinition["actions"][number];

/** The required keys of an `ActorAction`, so a derived action can be handed to targeting with the
    server's id and nothing invented. The numbers are display only; the resolver reads the id. */
const EMPTY_ACTION = {
  id: "",
  name: "",
  activation: "action" as const,
  description: "",
  damage: [] as Array<{ formula: string; type: string }>
};

/**
 * The actions section: equipped weapons, the stat block's actions, actions an equipped item adds,
 * and spell actions by level. On a player's own turn every attack goes through the structured flow
 * (`routeAttack`); with the inline preference the runner here owns the server-resolvable actions.
 */
export function SheetActions({
  actor,
  definition,
  serverActions,
  rolls,
  structuredAttacks,
  inline,
  runnerRef,
  routeAttack,
  structuredActionFor,
  onLooseUse
}: Readonly<{
  actor: GmActor | PlayerActor;
  definition: ActorDefinition;
  serverActions: readonly ContentActionSummary[];
  rolls: SheetRolls;
  /** True on the player's own turn in a fight: attacks resolve on the server and are no loose rolls. */
  structuredAttacks: boolean;
  /** The runner for the inline preference, with the fight it resolves in. */
  inline: Readonly<{
    revision: number;
    playerDamageMode: "proposal" | "direct";
    targets: readonly { actorId: string; name: string }[];
  }> | null;
  runnerRef: RefObject<HTMLDivElement | null>;
  routeAttack: (action: DefinitionAction) => void;
  structuredActionFor: (opts: { actionId?: string; name?: string }) => DefinitionAction | null;
  /** Outside the fight: uses an item's action through the server, which rolls it and spends its charges. */
  onLooseUse: ((actionId: string) => void) | null;
}>) {
  const { rolling, rollD20, rollFlat } = rolls;
  const spellcasting = definition.spellcasting;
  const inventory = actor.inventory ?? [];
  // Equipped weapons become rollable attacks on the sheet: to-hit = ability mod + PB, damage = weapon
  // die + ability mod. The ability comes from `weaponAbilityModifierFrom`, the server's own function
  // (finesse, and thrown weapons using Strength), so the preview matches the roll.
  const equippedWeaponActions =
    actor.kind === "player-character"
      ? inventory
          .filter((item) => item.equipped && item.weapon && item.quantity > 0)
          .map((item) => {
            const weapon = item.weapon!;
            const abilityMod = weaponAbilityModifierFrom(
              weapon.properties ?? [],
              weapon.rangeFeet,
              modifierOf(definition.abilityScores.str),
              modifierOf(definition.abilityScores.dex)
            );
            const toHit = abilityMod + definition.proficiencyBonus;
            // A fixed amount (a Blowgun's 1) takes no modifier, as on the server.
            const damageFormula =
              abilityMod === 0 || !/d/i.test(weapon.damageDice)
                ? weapon.damageDice
                : `${weapon.damageDice} ${abilityMod > 0 ? "+" : "-"} ${Math.abs(abilityMod)}`;
            // Riders apply only while active: equipped, and attuned when the item requires it. An unattuned
            // magic weapon swings as mundane. Same rule as the server.
            const active =
              item.magic?.isMagic === true && (item.magic.attunementRequired !== true || item.attuned === true);
            return {
              id: `equip-${item.id}`,
              name: item.name,
              toHit,
              damageFormula,
              damageType: weapon.damageType,
              rangeFeet: weapon.rangeFeet,
              active
            };
          })
      : [];
  /** Actions the loadout adds beyond the stat block (a wand's charge, an amulet's cast). */
  const derivedActions = serverActions.filter(
    (row) => !definition.actions.some((candidate) => candidate.id === row.id)
  );
  /** Derived rows that are not equipped-weapon entries, matched out by name so no action is drawn
      twice. */
  const itemActions = derivedActions.filter((row) => !equippedWeaponActions.some((wa) => sameName(wa.name, row.name)));
  /** The server's own derived action for this weapon, matched by name (the only key an inventory
      row and its derived action share). */
  const serverActionFor = (name: string): ContentActionSummary | null => {
    const found = serverActions.find((candidate) => sameName(candidate.name, name));
    // Only the derived ones; definition actions are found by `structuredActionFor`.
    return found && !definition.actions.some((candidate) => candidate.id === found.id) ? found : null;
  };
  if (definition.actions.length === 0 && equippedWeaponActions.length === 0 && itemActions.length === 0) return null;
  const inlineRunner = inline !== null;
  return (
    <section className="sheet-section">
      <h3>Actions</h3>
      {(() => {
        type ActionT = (typeof definition.actions)[number];
        const renderAction = (action: ActionT) => {
          const atk = action.attack;
          // Outside a fight a heal is used here (Second Wind, Lay on Hands), and the server moves the hit points.
          const looseHeal = onLooseUse !== null && action.healing !== undefined && !atk;
          return (
            <div key={action.id} className="sheet-entry">
              <p>
                <strong>{action.name}.</strong> <RichText text={action.description} />
              </p>
              {(atk || action.damage.length > 0 || looseHeal) && (
                <div className="sheet-roll-row">
                  {looseHeal && (
                    <button
                      type="button"
                      className="sheet-roll-chip"
                      disabled={rolling}
                      onClick={() => onLooseUse(action.id)}
                    >
                      Use
                    </button>
                  )}
                  {atk && (
                    <button
                      type="button"
                      className="sheet-roll-chip"
                      disabled={rolling}
                      onClick={() => {
                        if (structuredAttacks) routeAttack(action);
                        else void rollD20(atk.bonus, "attack", `${action.name} to hit`);
                      }}
                    >
                      {signed(atk.bonus)} to hit
                    </button>
                  )}
                  {action.damage.map((part, index) => (
                    <button
                      type="button"
                      key={index}
                      className="sheet-roll-chip"
                      disabled={rolling}
                      onClick={() => void rollFlat(part.formula, "damage", `${action.name} damage`)}
                    >
                      {part.formula}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        };
        // Weapon/other actions first, then cantrip actions. A leveled spell's actions are cast from the Spells
        // section, which chooses the slot, so they are not offered here as well.
        const spellLevelByActionId = new Map<string, number>(
          (spellcasting?.spells ?? []).flatMap((spell) =>
            [spell.actionId, spell.freeActionId].flatMap((id) => (id ? [[id, spell.level] as const] : []))
          )
        );
        const weaponActions = definition.actions.filter((action) => !spellLevelByActionId.has(action.id));
        const spellGroups = new Map<number, ActionT[]>();
        for (const action of definition.actions) {
          const level = spellLevelByActionId.get(action.id);
          if (level === 0) {
            const list = spellGroups.get(level) ?? [];
            list.push(action);
            spellGroups.set(level, list);
          }
        }
        const hasSpellActions = spellGroups.size > 0;
        // With the inline-picker preference on the player's turn, the runner owns the server-resolvable
        // actions here, so the loose chips below are hidden to avoid offering an action twice.
        return (
          <>
            {inline && (
              <div ref={runnerRef}>
                <PlayerActionRunner
                  actorId={actor.id}
                  definition={definition}
                  extraActions={derivedActions}
                  revision={inline.revision}
                  inspired={"heroicInspiration" in actor && actor.heroicInspiration === true}
                  playerDamageMode={inline.playerDamageMode}
                  targets={inline.targets}
                  effectTags={actor.effects.flatMap((effect) => effect.tags)}
                />
              </div>
            )}
            {(equippedWeaponActions.length > 0 || (!inlineRunner && weaponActions.length > 0)) && (
              <div className="sheet-action-group">
                {(inlineRunner ? equippedWeaponActions.length > 0 : hasSpellActions) && (
                  <h4 className="sheet-action-head">{inlineRunner ? "Equipped weapons" : "Weapon & other"}</h4>
                )}
                {equippedWeaponActions.map((wa) => {
                  /* Prefer the server's derived numbers, which include item riders in `attackBonus` and
                     `damage[]`. The client's own arithmetic is only a fallback when the server derived nothing. */
                  const srv = serverActionFor(wa.name);
                  const toHit = srv?.attackBonus ?? wa.toHit;
                  const damage =
                    srv && srv.damage.length > 0 ? srv.damage : [{ formula: wa.damageFormula, type: wa.damageType }];
                  return (
                    <div key={wa.id} className="sheet-entry">
                      <p>
                        <strong>{wa.name}.</strong>{" "}
                        <span className="sheet-weapon-meta">
                          Equipped weapon · {wa.damageType}
                          {wa.rangeFeet != null ? ` · range ${wa.rangeFeet} ft` : ""}
                          {wa.active ? " · Magic" : ""}
                        </span>
                      </p>
                      <div className="sheet-roll-row">
                        <button
                          type="button"
                          className="sheet-roll-chip"
                          disabled={rolling}
                          onClick={() => {
                            const structured = structuredAttacks ? structuredActionFor({ name: wa.name }) : null;
                            if (structured) {
                              routeAttack(structured);
                              return;
                            }
                            // Only the id travels; the roll, riders and damage are resolved server-side.
                            if (srv) {
                              routeAttack({
                                ...EMPTY_ACTION,
                                id: srv.id,
                                name: srv.name,
                                attack: { bonus: toHit },
                                damage: [...damage]
                              });
                              return;
                            }
                            void rollD20(toHit, "attack", `${wa.name} to hit`);
                          }}
                        >
                          {signed(toHit)} to hit
                        </button>
                        {damage.map((part, index) => (
                          <button
                            type="button"
                            key={index}
                            className="sheet-roll-chip"
                            disabled={rolling}
                            onClick={() => void rollFlat(part.formula, "damage", `${wa.name} damage`)}
                          >
                            {part.formula}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {!inlineRunner && weaponActions.map(renderAction)}
              </div>
            )}
            {/* Actions an equipped item added, which exist nowhere in the stat block. On the player's own
                  turn the runner owns them (`inlineRunner`). */}
            {!inlineRunner && itemActions.length > 0 && (
              <div className="sheet-action-group">
                <h4 className="sheet-action-head">From your items</h4>
                {itemActions.map((row) => {
                  // Shown only while the counts are this sheet's to see (always for your own character).
                  const spent = actor.actionUses?.[row.usesPool ?? row.id];
                  const left =
                    row.usesLimit !== null && spent !== undefined ? Math.max(0, row.usesLimit - spent) : null;
                  return (
                    <div key={row.id} className="sheet-entry">
                      <p>
                        <strong>{row.name}.</strong> <RichText text={row.description} />
                        {row.usesLimit !== null && (
                          <span className="sheet-weapon-meta">
                            {" "}
                            · {left !== null ? `${left} of ` : ""}
                            {row.usesLimit} {row.usesLimit === 1 ? "charge" : "charges"}
                            {left !== null ? " left" : ""}
                            {row.usesPer ? ` per ${usesScopeLabel(row.usesPer)}` : ""}
                          </span>
                        )}
                      </p>
                      {(row.attackBonus !== null || row.damage.length > 0 || onLooseUse) && (
                        <div className="sheet-roll-row">
                          {onLooseUse && row.attackBonus === null && (
                            <button
                              type="button"
                              className="sheet-roll-chip"
                              disabled={rolling || left === 0}
                              onClick={() => onLooseUse(row.id)}
                            >
                              Use
                            </button>
                          )}
                          {row.attackBonus !== null && (
                            <button
                              type="button"
                              className="sheet-roll-chip"
                              disabled={rolling || (onLooseUse !== null && left === 0)}
                              onClick={() => {
                                if (structuredAttacks)
                                  routeAttack({
                                    ...EMPTY_ACTION,
                                    id: row.id,
                                    name: row.name,
                                    attack: { bonus: row.attackBonus! },
                                    damage: [...row.damage]
                                  });
                                else if (onLooseUse) onLooseUse(row.id);
                                else void rollD20(row.attackBonus!, "attack", `${row.name} to hit`);
                              }}
                            >
                              {signed(row.attackBonus)} to hit
                            </button>
                          )}
                          {row.damage.map((part, index) => (
                            <button
                              type="button"
                              key={index}
                              className="sheet-roll-chip"
                              disabled={rolling}
                              onClick={() => void rollFlat(part.formula, "damage", `${row.name} damage`)}
                            >
                              {part.formula}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {!inlineRunner && hasSpellActions && (
              <div className="sheet-action-group">
                <h4 className="sheet-action-head">Spell actions</h4>
                {[...spellGroups.keys()]
                  .sort((left, right) => left - right)
                  .map((level) => (
                    <div key={level} className="sheet-action-subgroup">
                      <h5 className="sheet-action-subhead">{level === 0 ? "Cantrips" : `Level ${level}`}</h5>
                      {spellGroups.get(level)!.map(renderAction)}
                    </div>
                  ))}
              </div>
            )}
          </>
        );
      })()}
    </section>
  );
}
