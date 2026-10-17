import type { ActorDefinition, ActorDerivedSheet, DerivedDefence } from "@vtt/domain";
import { ABILITIES, abilityModifier as modifierOf } from "@vtt/rules-5e";
import { signed } from "./format";
import { modeLabel } from "./roll-mode-notes";
import { RollModeNotes, RollModeTag } from "./RollModeTag";
import type { SrdExtension } from "./sheet-extension";
import type { SheetRolls } from "./useSheetRolls";
import { withArticle } from "@vtt/domain";

const titleCase = (type: string) => `${type[0]?.toUpperCase() ?? ""}${type.slice(1)}`;
const ABILITY_WORDS = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
} as const;

/** A defence row as the engine applies it: each type, and what grants it when that isn't the stat block. */
function defenceText(rows: readonly DerivedDefence[]): string {
  return rows.map((row) => (row.source ? `${titleCase(row.type)} (${row.source})` : titleCase(row.type))).join(", ");
}

/** The six scores with their check rolls, why any roll has Advantage or Disadvantage, and the stat block's senses,
 *  languages and defences. */
export function SheetAbilities({
  definition,
  extension,
  derived,
  rolls
}: Readonly<{
  definition: ActorDefinition;
  extension: SrdExtension;
  derived: ActorDerivedSheet | null;
  rolls: SheetRolls;
}>) {
  const { rolling, rollCheck } = rolls;
  // The typed lists the damage pipeline applies, items and species traits included. The stat block's
  // prose is shown only where there is nothing typed, as for an imported monster with prose alone.
  const defence = (typed: readonly DerivedDefence[] | undefined, prose: string | null | undefined) =>
    typed && typed.length > 0 ? defenceText(typed) : prose;
  const vulnerabilities = defence(derived?.defences.vulnerabilities, extension.damageVulnerabilities);
  const resistances = defence(derived?.defences.resistances, extension.damageResistances);
  const immunities = defence(derived?.defences.immunities, extension.damageImmunities);
  const derivedAbility = (ability: (typeof ABILITIES)[number]) =>
    derived?.abilities.find((row) => row.ability === ability) ?? null;
  // The server's score when it has answered (conditions and items included); the stat block's until then.
  const passivePerception = derived?.passivePerception ?? extension.passivePerception ?? null;
  return (
    <>
      <div className="sheet-abilities">
        {ABILITIES.map((ability) => {
          const score = definition.abilityScores[ability];
          // The server's numbers when it has answered; the bare modifier only until then. The roll itself is the
          // server's either way.
          const row = derivedAbility(ability);
          const mod = row?.check ?? modifierOf(score);
          const name = `${ABILITY_WORDS[ability]} check`;
          return (
            <div key={ability} className="sheet-ability">
              <span>{ability.toUpperCase()}</span>
              <strong>{score}</strong>
              <div className="sheet-ability-rolls">
                <button
                  type="button"
                  disabled={rolling}
                  aria-label={`Roll ${withArticle(name)}, ${signed(mod)}${modeLabel(row?.checkMode)}`}
                  onClick={() => void rollCheck({ ability }, name)}
                >
                  {signed(mod)}
                  <RollModeTag mode={row?.checkMode} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <RollModeNotes derived={derived} />
      <dl className="sheet-meta">
        {extension.senses && extension.senses.length > 0 && (
          <div>
            <dt>Senses</dt>
            <dd>{extension.senses.join(", ")}</dd>
          </div>
        )}
        {passivePerception !== null && (
          <div>
            <dt>Passive Perception</dt>
            <dd>{passivePerception}</dd>
          </div>
        )}
        {extension.languages && (
          <div>
            <dt>Languages</dt>
            <dd>{extension.languages}</dd>
          </div>
        )}
        {vulnerabilities && (
          <div>
            <dt>Vulnerabilities</dt>
            <dd>{vulnerabilities}</dd>
          </div>
        )}
        {resistances && (
          <div>
            <dt>Resistances</dt>
            <dd>{resistances}</dd>
          </div>
        )}
        {immunities && (
          <div>
            <dt>Immunities</dt>
            <dd>{immunities}</dd>
          </div>
        )}
        {extension.conditionImmunities && (
          <div>
            <dt>Condition immunities</dt>
            <dd>{extension.conditionImmunities}</dd>
          </div>
        )}
        <div>
          <dt>Proficiency</dt>
          <dd>{signed(definition.proficiencyBonus)}</dd>
        </div>
      </dl>
    </>
  );
}
