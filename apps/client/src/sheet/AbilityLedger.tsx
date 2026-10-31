import type { ReactNode } from "react";
import { withArticle, type ActorDefinition, type ActorDerivedSheet } from "@vtt/domain";
import type { Ability } from "@vtt/rules-5e";
import { signed } from "../encounter/format";
import { modeLabel } from "../encounter/roll-mode-notes";
import { RollModeNotes, RollModeTag } from "../encounter/RollModeTag";
import { abilityRows } from "./ChecksTab";
import { ABILITY_WORDS, exhaustionLevel, type SheetActor } from "./sheet-model";
import type { SheetRolls } from "./useSheetRolls";

/**
 * The six abilities as rows, like the left edge of a paper sheet (ADR-0047): the name with its score under it and the
 * check's modifier, one button that rolls the check; then the saving throw, a second button with its proficiency
 * square. A save the character owes now (`owed`) takes its ability's Save cell, so the tap answers it.
 */
export function AbilityLedger({
  actor,
  definition,
  derived,
  rolls,
  owed,
  top
}: Readonly<{
  actor: SheetActor;
  definition: ActorDefinition;
  derived: ActorDerivedSheet | null;
  rolls: SheetRolls;
  owed?: (ability: Ability) => ReactNode;
  /** What comes before the rows: the Death Saving Throws while dying, and the saves owed. */
  top?: ReactNode;
}>) {
  const exhaustion = exhaustionLevel(actor);
  return (
    <section className="cs-card cs-ledger" aria-label="Abilities">
      <span className="cs-eyebrow">Abilities</span>
      {top}
      {exhaustion > 0 && (
        <p className="cs-sub is-caution">
          Every d20 Test here includes the -{2 * exhaustion} from Exhaustion {exhaustion}.
        </p>
      )}
      <RollModeNotes derived={derived} />
      <div className="cs-ledger-head" aria-hidden="true">
        <span className="cs-eyebrow">Ability</span>
        <span className="cs-eyebrow">Check</span>
        <span className="cs-eyebrow">Save</span>
      </div>
      <ul className="cs-ledger-rows">
        {abilityRows(definition, derived).map(({ ability, score, row, check, proficient, save, fromItems, fails }) => {
          const checkName = `${ABILITY_WORDS[ability]} check`;
          const saveName = `${ABILITY_WORDS[ability]} saving throw`;
          const answer = owed?.(ability);
          return (
            <li key={ability} className="cs-ledger-row">
              <button
                type="button"
                className="cs-ledger-check"
                disabled={rolls.rolling}
                aria-label={`Roll ${withArticle(checkName)}, ${signed(check)}${modeLabel(row?.checkMode)}`}
                onClick={() => void rolls.rollCheck({ ability }, checkName)}
              >
                <span className="cs-ledger-name">
                  <span className="cs-ledger-word">{ABILITY_WORDS[ability]}</span>
                  <span className="cs-ledger-score">{score}</span>
                </span>
                <RollModeTag mode={row?.checkMode} />
                <strong className="cs-ledger-mod">{signed(check)}</strong>
              </button>
              {answer ? (
                <span className="cs-ledger-owed">{answer}</span>
              ) : (
                <button
                  type="button"
                  className={`cs-ledger-save${proficient ? " is-proficient" : ""}${fails ? " is-failing" : ""}`}
                  disabled={rolls.rolling}
                  aria-label={`Roll ${withArticle(saveName)}, ${signed(save)}${proficient ? ", proficient" : ""}${fromItems !== 0 ? `, ${signed(fromItems)} from equipment` : ""}${fails ? ", fails automatically" : modeLabel(row?.saveMode)}`}
                  onClick={() => void rolls.rollSave(ability)}
                >
                  <span className={`cs-tier${proficient ? " is-proficient" : ""}`} aria-hidden="true" />
                  {fails ? (
                    <span className="roll-mode-tag is-disadvantage" aria-hidden="true">
                      Fails
                    </span>
                  ) : (
                    <RollModeTag mode={row?.saveMode} />
                  )}
                  <strong className="cs-ledger-savev">{signed(save)}</strong>
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
