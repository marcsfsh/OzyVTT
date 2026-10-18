import type { ActorDefinition, ActorDerivedSheet } from "@vtt/domain";
import { GmOnlyTag } from "@vtt/ui";
import { titleCase } from "../encounter/format";
import type { SrdExtension } from "../encounter/sheet-extension";
import type { SheetActor } from "./sheet-model";

const words = (slug: string) => slug.split("-").map(titleCase).join(" ");

/** "Light, Medium and Heavy armor" from the stored slugs; "None" for an empty list, absent when never recorded. */
function listed(values: readonly string[] | undefined, noun = ""): string | null {
  if (values === undefined) return null;
  if (values.length === 0) return "None";
  const named = values.map(words);
  const joined = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return noun ? `${joined} ${noun}` : joined;
}

/** "Light and Medium armor, Shields": Shields read as their own word. */
function armorTraining(values: readonly string[] | undefined): string | null {
  if (values === undefined) return null;
  const armor = values.filter((value) => value !== "shields");
  const parts = [
    armor.length > 0 ? listed(armor, "armor") : null,
    values.includes("shields") ? "Shields" : null
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : "None";
}

/**
 * Who the character is beyond the numbers: species and size, background, languages, armor and weapon training, tools
 * and senses. The GM also reads the character's notes, which never reach a player.
 */
export function NotesTab({
  actor,
  role,
  definition,
  extension,
  derived
}: Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  definition: ActorDefinition | null;
  extension: SrdExtension;
  derived: ActorDerivedSheet | null;
}>) {
  const character = definition?.character;
  const proficiencies = definition?.proficiencies;
  const species = character?.race ? (character.race.subrace?.name ?? character.race.name) : null;
  const size = definition ? titleCase(definition.size) : actor.size ? titleCase(actor.size) : null;
  const rows: Array<[string, string]> = [];
  if (species || size) rows.push(["Species and size", [species, size].filter(Boolean).join(" · ")]);
  if (character?.background) rows.push(["Background", character.background.name]);
  const languages = listed(proficiencies?.languages) ?? extension.languages ?? null;
  if (languages) rows.push(["Languages", languages]);
  const armor = armorTraining(proficiencies?.armor);
  if (armor) rows.push(["Armor training", armor]);
  const weapons = listed(proficiencies?.weapons, "weapons");
  if (weapons) rows.push(["Weapons", weapons]);
  const tools = derived?.tools?.map((tool) => tool.name) ?? proficiencies?.tools?.map(words);
  if (tools && tools.length > 0) rows.push(["Tools", tools.join(", ")]);
  if (extension.senses && extension.senses.length > 0) rows.push(["Senses", extension.senses.join(", ")]);
  // Notes never reach a player's projection, so only the GM's copy has them.
  const notes = role === "gm" && "notes" in actor ? (actor.notes ?? null) : null;
  return (
    <div className="cs-notes">
      {rows.length > 0 ? (
        <dl className="cs-facts">
          {rows.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="cs-note">Nothing is recorded here for {actor.name} yet.</p>
      )}
      {role === "gm" && (
        <section className="cs-gm-notes" aria-label="Notes">
          <span className="cs-section-head">
            <span className="cs-eyebrow">Notes</span>
            <GmOnlyTag />
          </span>
          <p className="cs-gm-notes-text">{notes && notes.trim() ? notes : "None"}</p>
        </section>
      )}
    </div>
  );
}
