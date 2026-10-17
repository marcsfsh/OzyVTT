import type { ActorDefinition, ActorDerivedSheet, DerivedDefence } from "@vtt/domain";
import { ABILITIES, abilityModifier as modifierOf } from "@vtt/rules-5e";
import { signed } from "./format";
import type { SrdExtension } from "./sheet-extension";
import type { SheetRolls } from "./useSheetRolls";

const titleCase = (type: string) => `${type[0]?.toUpperCase() ?? ""}${type.slice(1)}`;

/** A defence row as the engine applies it: each type, and what grants it when that isn't the stat block. */
function defenceText(rows: readonly DerivedDefence[]): string {
  return rows.map((row) => (row.source ? `${titleCase(row.type)} (${row.source})` : titleCase(row.type))).join(", ");
}

/** The six scores with their check rolls, and the stat block's senses, languages and defences. */
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
  const { rolling, rollD20 } = rolls;
  // The typed lists the damage pipeline applies, items and species traits included. The stat block's
  // prose is shown only where there is nothing typed, as for an imported monster with prose alone.
  const defence = (typed: readonly DerivedDefence[] | undefined, prose: string | null | undefined) =>
    typed && typed.length > 0 ? defenceText(typed) : prose;
  const vulnerabilities = defence(derived?.defences.vulnerabilities, extension.damageVulnerabilities);
  const resistances = defence(derived?.defences.resistances, extension.damageResistances);
  const immunities = defence(derived?.defences.immunities, extension.damageImmunities);
  const derivedAbility = (ability: (typeof ABILITIES)[number]) =>
    derived?.abilities.find((row) => row.ability === ability) ?? null;
  return (
    <>
      <div className="sheet-abilities">
        {ABILITIES.map((ability) => {
          const score = definition.abilityScores[ability];
          // The server's numbers when it has answered; its own arithmetic only until then. The
          // difference is item `check-bonus` riders, which the client cannot see (rule 2).
          const row = derivedAbility(ability);
          const mod = row?.check ?? modifierOf(score);
          return (
            <div key={ability} className="sheet-ability">
              <span>{ability.toUpperCase()}</span>
              <strong>{score}</strong>
              <div className="sheet-ability-rolls">
                <button
                  type="button"
                  disabled={rolling}
                  title={`Roll a ${ability.toUpperCase()} check`}
                  onClick={() => void rollD20(mod, "check", `${ability.toUpperCase()} check`)}
                >
                  {signed(mod)}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <dl className="sheet-meta">
        {extension.senses && extension.senses.length > 0 && (
          <div>
            <dt>Senses</dt>
            <dd>
              {extension.senses.join(", ")}
              {extension.passivePerception ? `; passive Perception ${extension.passivePerception}` : ""}
            </dd>
          </div>
        )}
        {!extension.senses?.length && extension.passivePerception ? (
          <div>
            <dt>Senses</dt>
            <dd>passive Perception {extension.passivePerception}</dd>
          </div>
        ) : null}
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
