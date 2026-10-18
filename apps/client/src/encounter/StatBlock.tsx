import type { ReactNode } from "react";
import { experienceForChallenge } from "@vtt/rules-5e";
import { RichText } from "./RichText";
import { formatChallenge } from "./format";
import {
  ABILITY_IDS,
  challengeOf,
  modifierOf,
  proficiencyOf,
  scoresOf,
  signed,
  speedsOf,
  statblockOf
} from "../homebrew/wizard/monster-build";
import { actionsOf, activationOf, type MonsterAction } from "../homebrew/wizard/monster-actions";
import "./stat-block.css";

/** A monster as a record holds it: an SRD stat block and a homebrew one have the same shape. */
export type StatBlockRecord = Readonly<Record<string, unknown>>;

const title = (slug: string) =>
  slug
    .split("-")
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");

/** A defence list: the record's own slugs, or the line the SRD bag prints. */
function defences(record: StatBlockRecord, key: string): string | null {
  const own = record[key];
  if (Array.isArray(own) && own.length > 0) return own.map((value) => title(String(value))).join(", ");
  const printed = statblockOf(record)[key];
  return typeof printed === "string" && printed.trim() ? printed : null;
}

function Line({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <p className="sb-line">
      <strong>{label}</strong> {children}
    </p>
  );
}

function Entries({
  heading,
  intro,
  actions
}: Readonly<{ heading: string; intro?: string; actions: readonly MonsterAction[] }>) {
  if (actions.length === 0 && !intro) return null;
  return (
    <section className="sb-section">
      <h5 className="sb-heading">{heading}</h5>
      {intro && <p className="sb-entry">{intro}</p>}
      {actions.map((action, index) => (
        <p key={`${String(action.id)}-${index}`} className="sb-entry">
          <strong>{typeof action.name === "string" && action.name ? action.name : "Unnamed"}.</strong>{" "}
          <RichText text={typeof action.description === "string" ? action.description : ""} />
        </p>
      ))}
    </section>
  );
}

/**
 * A monster's stat block in SRD 5.2.1 order and words: the one the GM reads in the bestiary, and the one the
 * Compendium shows for a homebrew or SRD monster while it is written.
 */
export function StatBlock({ monster, className }: Readonly<{ monster: StatBlockRecord; className?: string }>) {
  const bag = statblockOf(monster);
  const scores = scoresOf(monster);
  const proficiency = proficiencyOf(monster);
  const saves = (bag.savingThrows as Partial<Record<string, number | null>> | undefined) ?? {};
  const rating = challengeOf(monster);
  const speeds = speedsOf(monster);
  const hitPoints = monster.hitPoints as { maximum?: number; formula?: string } | undefined;
  const initiative = typeof monster.initiativeBonus === "number" ? monster.initiativeBonus : modifierOf(scores.dex);
  const actions = actionsOf(monster);
  const legendary = monster.legendary as { actionsPerRound?: number } | undefined;
  const name = typeof monster.name === "string" && monster.name.trim() ? monster.name : "Untitled monster";
  const skills = Object.entries((bag.skills as Record<string, number> | undefined) ?? {});
  const senses = [
    ...(Array.isArray(bag.senses)
      ? (bag.senses as string[]).map((sense) => title(sense.split(" ")[0]!) + sense.slice(sense.indexOf(" ")))
      : []),
    ...(typeof bag.passivePerception === "number" ? [`Passive Perception ${bag.passivePerception}`] : [])
  ];
  const otherSpeeds = (["fly", "swim", "climb", "burrow"] as const)
    .filter((mode) => typeof speeds[mode] === "number" && speeds[mode]! > 0)
    .map((mode) => `${title(mode)} ${speeds[mode]} ft.${mode === "fly" && speeds.hover ? " (hover)" : ""}`);
  const traits = Array.isArray(bag.traits) ? (bag.traits as Array<{ name: string; description: string }>) : [];
  const typeLine = `${title(typeof monster.size === "string" ? monster.size : "medium")} ${
    typeof bag.type === "string" ? title(bag.type) : "Being"
  }${typeof bag.alignment === "string" && bag.alignment ? `, ${title(bag.alignment)}` : ""}`;
  const immunities = [defences(monster, "damageImmunities"), defences(monster, "conditionImmunities")].filter(Boolean);
  const experience = rating === null ? null : experienceForChallenge(rating);

  return (
    <article className={className ? `sb ${className}` : "sb"} aria-label={`${name} stat block`}>
      <header className="sb-head">
        <h4 className="sb-name">{name}</h4>
        <p className="sb-type">{typeLine}</p>
      </header>
      <div className="sb-block">
        <Line label="AC">
          {typeof monster.armorClass === "number" ? monster.armorClass : "None"}
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
      <dl className="sb-abilities">
        {ABILITY_IDS.map((ability) => {
          const modifier = modifierOf(scores[ability]);
          const save = saves[ability] ?? modifier;
          return (
            <div key={ability} className="sb-ability">
              <dt>{ability.toUpperCase()}</dt>
              <dd>
                <span className="sb-score tabular">{scores[ability]}</span>
                <span className="sb-mods tabular">
                  {signed(modifier)} · save {signed(save)}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="sb-block">
        {skills.length > 0 && (
          <Line label="Skills">{skills.map(([skill, total]) => `${title(skill)} ${signed(total)}`).join(", ")}</Line>
        )}
        {defences(monster, "damageVulnerabilities") && (
          <Line label="Vulnerabilities">{defences(monster, "damageVulnerabilities")}</Line>
        )}
        {defences(monster, "damageResistances") && (
          <Line label="Resistances">{defences(monster, "damageResistances")}</Line>
        )}
        {immunities.length > 0 && <Line label="Immunities">{immunities.join("; ")}</Line>}
        {senses.length > 0 && <Line label="Senses">{senses.join("; ")}</Line>}
        <Line label="Languages">{typeof bag.languages === "string" && bag.languages ? bag.languages : "None"}</Line>
        <Line label="CR">
          {rating === null
            ? "None"
            : `${formatChallenge(rating)} (XP ${experience?.toLocaleString("en") ?? "None"}; PB ${signed(proficiency)})`}
        </Line>
      </div>
      {traits.length > 0 && (
        <section className="sb-section">
          <h5 className="sb-heading">Traits</h5>
          {traits.map((trait, index) => (
            <p key={`${trait.name}-${index}`} className="sb-entry">
              <strong>{trait.name || "Unnamed"}.</strong> <RichText text={trait.description} />
            </p>
          ))}
        </section>
      )}
      <Entries heading="Actions" actions={actions.filter((action) => activationOf(action) === "action")} />
      <Entries heading="Bonus Actions" actions={actions.filter((action) => activationOf(action) === "bonus-action")} />
      <Entries heading="Reactions" actions={actions.filter((action) => activationOf(action) === "reaction")} />
      {legendary?.actionsPerRound !== undefined && (
        <Entries
          heading="Legendary Actions"
          intro={`Legendary Action Uses: ${legendary.actionsPerRound}. Immediately after another turn, it can expend a use to take one of these actions. It regains all expended uses at the start of each of its turns.`}
          actions={actions.filter((action) => activationOf(action) === "legendary")}
        />
      )}
    </article>
  );
}
