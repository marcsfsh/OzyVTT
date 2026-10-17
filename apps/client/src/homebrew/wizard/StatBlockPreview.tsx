/** A homebrew monster as a stat block, in the SRD 5.2.1's order and words: the lines the sheet prints for it in a
    fight (its type line, AC, HP, speeds, abilities with saves, senses, languages, CR, traits and actions). */

import { experienceForChallenge } from "@vtt/rules-5e";
import { RichText } from "../../encounter/RichText";
import {
  ABILITY_IDS,
  challengeOf,
  modifierOf,
  proficiencyOf,
  scoresOf,
  signed,
  speedsOf,
  statblockOf
} from "./monster-build";
import { actionsOf, activationOf, type MonsterAction } from "./monster-actions";
import type { PreviewProps } from "./types";

const title = (slug: string) =>
  slug
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");

const list = (values: unknown) =>
  Array.isArray(values) && values.length > 0 ? values.map((value) => title(String(value))).join(", ") : null;

function Line({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <p className="hb-sb-line">
      <strong>{label}</strong> {children}
    </p>
  );
}

function Entries({ heading, actions }: Readonly<{ heading: string; actions: readonly MonsterAction[] }>) {
  if (actions.length === 0) return null;
  return (
    <section className="hb-sb-section">
      <h5 className="hb-sb-heading">{heading}</h5>
      {actions.map((action, index) => (
        <p key={`${String(action.id)}-${index}`} className="hb-sb-entry">
          <strong>{typeof action.name === "string" && action.name ? action.name : "Unnamed"}.</strong>{" "}
          <RichText text={typeof action.description === "string" ? action.description : ""} />
        </p>
      ))}
    </section>
  );
}

export function StatBlockPreview({ draft }: PreviewProps) {
  const bag = statblockOf(draft);
  const scores = scoresOf(draft);
  const proficiency = proficiencyOf(draft);
  const saves = (bag.savingThrows as Partial<Record<string, number>> | undefined) ?? {};
  const rating = challengeOf(draft);
  const speeds = speedsOf(draft);
  const hitPoints = draft.hitPoints as { maximum?: number; formula?: string } | undefined;
  const initiative = typeof draft.initiativeBonus === "number" ? draft.initiativeBonus : modifierOf(scores.dex);
  const actions = actionsOf(draft);
  const legendary = draft.legendary as { actionsPerRound?: number } | undefined;
  const name = typeof draft.name === "string" && draft.name.trim() ? draft.name : "Untitled monster";
  const skills = Object.entries((bag.skills as Record<string, number> | undefined) ?? {});
  const senses = [
    ...(Array.isArray(bag.senses) ? (bag.senses as string[]) : []),
    ...(typeof bag.passivePerception === "number" ? [`Passive Perception ${bag.passivePerception}`] : [])
  ];
  const otherSpeeds = (["fly", "swim", "climb", "burrow"] as const)
    .filter((mode) => typeof speeds[mode] === "number" && speeds[mode]! > 0)
    .map((mode) => `${mode} ${speeds[mode]} ft.${mode === "fly" && speeds.hover ? " (hover)" : ""}`);
  const traits = Array.isArray(bag.traits) ? (bag.traits as Array<{ name: string; description: string }>) : [];
  const typeLine = `${title(typeof draft.size === "string" ? draft.size : "medium")} ${
    typeof bag.type === "string" ? bag.type : "creature"
  }${typeof bag.alignment === "string" && bag.alignment ? `, ${bag.alignment}` : ""}`;

  return (
    <article className="hb-sb" aria-label={`${name} stat block`}>
      <h4 className="hb-wiz-card-name">{name}</h4>
      <p className="hb-sb-type">{typeLine}</p>
      <div className="hb-sb-block">
        <Line label="AC">
          {typeof draft.armorClass === "number" ? draft.armorClass : "None"}
          {typeof bag.armorDetail === "string" && bag.armorDetail ? ` (${bag.armorDetail})` : ""}
        </Line>
        <Line label="Initiative">
          {signed(initiative)} ({10 + initiative})
        </Line>
        <Line label="HP">
          {hitPoints?.maximum ?? "None"}
          {hitPoints?.formula ? ` (${hitPoints.formula})` : ""}
        </Line>
        <Line label="Speed">{[`${speeds.walk ?? 0} ft.`, ...otherSpeeds].join(", ")}</Line>
      </div>
      <table className="hb-sb-abilities">
        <thead>
          <tr>
            <th scope="col">
              <span className="nh-sr-only">Ability</span>
            </th>
            <th scope="col">Score</th>
            <th scope="col">Mod</th>
            <th scope="col">Save</th>
          </tr>
        </thead>
        <tbody>
          {ABILITY_IDS.map((ability) => (
            <tr key={ability}>
              <th scope="row">{ability.toUpperCase()}</th>
              <td className="tabular">{scores[ability]}</td>
              <td className="tabular">{signed(modifierOf(scores[ability]))}</td>
              <td className="tabular">{signed(saves[ability] ?? modifierOf(scores[ability]))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hb-sb-block">
        {skills.length > 0 && (
          <Line label="Skills">{skills.map(([skill, total]) => `${title(skill)} ${signed(total)}`).join(", ")}</Line>
        )}
        {list(draft.damageVulnerabilities) && <Line label="Vulnerabilities">{list(draft.damageVulnerabilities)}</Line>}
        {list(draft.damageResistances) && <Line label="Resistances">{list(draft.damageResistances)}</Line>}
        {(list(draft.damageImmunities) || list(draft.conditionImmunities)) && (
          <Line label="Immunities">
            {[list(draft.damageImmunities), list(draft.conditionImmunities)].filter(Boolean).join("; ")}
          </Line>
        )}
        {senses.length > 0 && <Line label="Senses">{senses.join(", ")}</Line>}
        <Line label="Languages">{typeof bag.languages === "string" && bag.languages ? bag.languages : "None"}</Line>
        <Line label="CR">
          {rating === null
            ? "None"
            : `${rating === 0.125 ? "1/8" : rating === 0.25 ? "1/4" : rating === 0.5 ? "1/2" : rating} (XP ${
                experienceForChallenge(rating)?.toLocaleString("en") ?? "None"
              }; PB ${signed(proficiency)})`}
        </Line>
      </div>
      {traits.length > 0 && (
        <section className="hb-sb-section">
          <h5 className="hb-sb-heading">Traits</h5>
          {traits.map((trait, index) => (
            <p key={`${trait.name}-${index}`} className="hb-sb-entry">
              <strong>{trait.name || "Unnamed"}.</strong> <RichText text={trait.description} />
            </p>
          ))}
        </section>
      )}
      <Entries heading="Actions" actions={actions.filter((action) => activationOf(action) === "action")} />
      <Entries heading="Bonus actions" actions={actions.filter((action) => activationOf(action) === "bonus-action")} />
      <Entries heading="Reactions" actions={actions.filter((action) => activationOf(action) === "reaction")} />
      {legendary?.actionsPerRound !== undefined && (
        <section className="hb-sb-section">
          <h5 className="hb-sb-heading">Legendary actions</h5>
          <p className="hb-sb-entry">
            Legendary Action Uses: {legendary.actionsPerRound}. Immediately after another creature&rsquo;s turn, it can
            expend a use to take one of these actions. It regains all expended uses at the start of each of its turns.
          </p>
          {actions
            .filter((action) => activationOf(action) === "legendary")
            .map((action, index) => (
              <p key={`${String(action.id)}-${index}`} className="hb-sb-entry">
                <strong>{typeof action.name === "string" && action.name ? action.name : "Unnamed"}.</strong>{" "}
                <RichText text={typeof action.description === "string" ? action.description : ""} />
              </p>
            ))}
        </section>
      )}
    </article>
  );
}
