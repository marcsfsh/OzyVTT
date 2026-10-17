import { useState, type ReactNode } from "react";
import type { ActorDefinition, ActorDerivedSheet, ContentActionSummary } from "@vtt/domain";
import { Button, IconLevelUp } from "@vtt/ui";
import { RichText } from "../encounter/RichText";
import type { SrdExtension } from "../encounter/sheet-extension";
import type { SheetActor } from "./sheet-model";
import { UseList, type Pool } from "./Uses";

/** A feature the level page records as a pick of something else, which the sheet shows as that pick. */
const PLACEHOLDERS = /-subclass$|^ability-score-improvement$/;

type Entry = Readonly<{ key: string; name: string; description: string }>;
type Group = Readonly<{ key: string; title: string; entries: readonly Entry[] }>;

/** The features grouped by where they come from: each class, its subclass, the species, then the feats. A sheet
 *  without a build record lists its traits as one group. */
function featureGroups(definition: ActorDefinition, extension: SrdExtension): Group[] {
  const traits = extension.traits ?? [];
  const character = definition.character;
  const features = character?.features ?? [];
  if (!character || features.length === 0)
    return traits.length > 0
      ? [{ key: "traits", title: "Traits", entries: traits.map((trait) => ({ key: trait.name, ...trait })) }]
      : [];
  const groups = new Map<string, { title: string; entries: Entry[] }>();
  const titleOf = (kind: string, sourceId: string) => {
    if (kind === "class") {
      const klass = character.classes.find((entry) => entry.id === sourceId);
      return klass ? `${klass.name} ${klass.level}` : sourceId;
    }
    if (kind === "subclass")
      return character.classes.find((entry) => entry.subclass?.id === sourceId)?.subclass?.name ?? sourceId;
    if (kind === "species") return character.race?.name ?? "Species";
    return "Other";
  };
  // The traits follow the features in order, then the feats.
  features.forEach((feature, index) => {
    const trait = traits[index];
    if (!trait || PLACEHOLDERS.test(feature.id)) return;
    const key = `${feature.kind}:${feature.sourceId}`;
    const group = groups.get(key) ?? { title: titleOf(feature.kind, feature.sourceId), entries: [] };
    group.entries.push({ key: feature.id, name: trait.name, description: trait.description });
    groups.set(key, group);
  });
  const feats = (character.feats ?? []).map((feat) => ({
    key: feat.id,
    name: feat.name,
    description: feat.description ?? ""
  }));
  if (feats.length > 0) groups.set("feats", { title: "Feats", entries: feats });
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
}

/** A feature's first sentence, its one line. */
const firstSentence = (text: string) => text.split(/(?<=[.!?])\s/)[0] ?? text;

/** One feature: its name and one line, and its full text a tap away. */
function FeatureRow({ entry }: Readonly<{ entry: Entry }>) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`cs-feature${open ? " is-open" : ""}`}>
      <button type="button" className="cs-feature-head interactive" aria-expanded={open} onClick={() => setOpen(!open)}>
        <strong className="cs-feature-name">{entry.name}</strong>
        {!open && <span className="cs-feature-line">{firstSentence(entry.description)}</span>}
      </button>
      {open && (
        <p className="cs-feature-text">
          <RichText text={entry.description} />
        </p>
      )}
    </li>
  );
}

/**
 * The Features tab: the uses first (their boxes, when they come back, and Use), the Weapon Mastery picks, then every
 * feature grouped by where it comes from, one line each with the full text a tap away. It ends with what the next level
 * brings and the way to it, when the table's builder lets this caller level the character.
 */
export function FeaturesTab({
  actor,
  role,
  definition,
  extension,
  derived,
  pools,
  serverActions,
  onUse,
  next
}: Readonly<{
  actor: SheetActor;
  role: "gm" | "player";
  definition: ActorDefinition;
  extension: SrdExtension;
  derived: ActorDerivedSheet | null;
  pools: readonly Pool[];
  serverActions: readonly ContentActionSummary[];
  /** Uses a pool's own action through the server, which applies what it does (Second Wind's healing). */
  onUse: (actionId: string) => void;
  /** What the next level brings and the way to it, when the caller may level the character. */
  next?: ReactNode;
}>) {
  const masteries = derived?.weaponMasteries ?? [];
  const groups = featureGroups(definition, extension);
  // A pool whose action does something on its own (a heal, an attack, an effect) is used through that action.
  const acting = new Map<string, string>();
  for (const pool of pools) {
    const own = definition.actions.find((action) => (action.uses?.pool ?? action.id) === pool.id);
    const row = serverActions.find((action) => (action.usesPool ?? action.id) === pool.id);
    const does = own
      ? own.healing !== undefined ||
        own.attack !== undefined ||
        own.save !== undefined ||
        own.damage.length > 0 ||
        own.grants !== undefined
      : row !== undefined &&
        (row.healing != null || row.attackBonus !== null || row.saveAbility !== null || row.damage.length > 0);
    const id = own?.id ?? row?.id;
    if (does && id) acting.set(pool.id, id);
  }
  // The monster's own actions, which have no uses to count but say what it can do.
  const monsterActions = actor.kind === "player-character" ? [] : definition.actions;
  return (
    <div className="cs-features">
      {pools.length > 0 && (
        <section className="cs-group" aria-label="Uses">
          <span className="cs-eyebrow">Uses</span>
          <UseList
            actorId={actor.id}
            role={role}
            pools={pools}
            spent={actor.actionUses ?? {}}
            acting={acting}
            onUse={onUse}
          />
        </section>
      )}
      {masteries.length > 0 && (
        <section className="cs-group" aria-label="Weapon Mastery">
          <span className="cs-eyebrow">Weapon Mastery</span>
          <ul className="cs-feature-list">
            {masteries.map((pick) => (
              <FeatureRow
                key={pick.weaponId}
                entry={{
                  key: pick.weaponId,
                  name: `${pick.weaponName} · ${pick.mastery.name}`,
                  description: pick.mastery.description
                }}
              />
            ))}
          </ul>
        </section>
      )}
      {groups.map((group) => (
        <section key={group.key} className="cs-group" aria-label={group.title}>
          <span className="cs-eyebrow">{group.title}</span>
          <ul className="cs-feature-list">
            {group.entries.map((entry) => (
              <FeatureRow key={entry.key} entry={entry} />
            ))}
          </ul>
        </section>
      ))}
      {monsterActions.length > 0 && (
        <section className="cs-group" aria-label="Actions">
          <span className="cs-eyebrow">Actions</span>
          <ul className="cs-feature-list">
            {monsterActions.map((action) => (
              <FeatureRow
                key={action.id}
                entry={{ key: action.id, name: action.name, description: action.description }}
              />
            ))}
          </ul>
        </section>
      )}
      {groups.length === 0 && masteries.length === 0 && pools.length === 0 && monsterActions.length === 0 && (
        <p className="cs-note">No features are recorded for {actor.name}.</p>
      )}
      {next}
    </div>
  );
}

/** The close of the Features tab: what the next level brings and the button that opens the level page. */
export function NextLevel({
  level,
  lines,
  onLevelUp
}: Readonly<{ level: number; lines: readonly string[]; onLevelUp: () => void }>) {
  return (
    <section className="cs-card cs-next" aria-label={`Level ${level}`}>
      <span className="cs-eyebrow">At level {level}</span>
      {lines.length > 0 ? (
        <ul className="cs-next-lines">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <Button variant="primary" onClick={onLevelUp}>
        <IconLevelUp /> Level up to {level}
      </Button>
    </section>
  );
}
