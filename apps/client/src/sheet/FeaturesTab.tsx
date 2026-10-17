import { useState, type ReactNode } from "react";
import type { ActorDefinition, ActorDerivedSheet, ContentActionSummary } from "@vtt/domain";
import { Button, IconLevelUp } from "@vtt/ui";
import { RichText } from "../encounter/RichText";
import type { SrdExtension } from "../encounter/sheet-extension";
import type { SheetActor } from "./sheet-model";
import { UseList, type Pool } from "./Uses";

/** What a use costs on a turn, in the SRD's words. */
const ACTIVATION_WORDS: Readonly<Record<string, string>> = {
  action: "Action",
  "bonus-action": "Bonus Action",
  reaction: "Reaction",
  other: "No action"
};

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
  // A subclass's features read with its class's: "Wizard 7 · Evoker".
  const classOf = (kind: string, sourceId: string) =>
    kind === "class"
      ? character.classes.find((entry) => entry.id === sourceId)
      : kind === "subclass"
        ? character.classes.find((entry) => entry.subclass?.id === sourceId)
        : undefined;
  const groupOf = (kind: string, sourceId: string): readonly [string, string] => {
    const klass = classOf(kind, sourceId);
    if (klass)
      return [`class:${klass.id}`, `${klass.name} ${klass.level}${klass.subclass ? ` · ${klass.subclass.name}` : ""}`];
    if (kind === "species") return ["species", character.race?.name ?? "Species"];
    return [`${kind}:${sourceId}`, "Other"];
  };
  // The traits follow the features in order, then the feats.
  features.forEach((feature, index) => {
    const trait = traits[index];
    if (!trait || PLACEHOLDERS.test(feature.id)) return;
    const [key, title] = groupOf(feature.kind, feature.sourceId);
    const group = groups.get(key) ?? { title, entries: [] };
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

/** The Weapon Mastery picks as tiles, each weapon kind with its property; a tap shows what the property does. */
function MasteryBlock({ masteries }: Readonly<{ masteries: NonNullable<ActorDerivedSheet["weaponMasteries"]> }>) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = masteries.find((pick) => pick.weaponId === open);
  return (
    <section className="cs-group" aria-label="Weapon Mastery">
      <span className="cs-section-head">
        <span className="cs-eyebrow">Weapon Mastery · {masteries.length}</span>
        <span className="cs-sub">Change after a Long Rest</span>
      </span>
      <div className="cs-masteries">
        {masteries.map((pick) => (
          <button
            key={pick.weaponId}
            type="button"
            className={`cs-mastery interactive${open === pick.weaponId ? " is-on" : ""}`}
            aria-expanded={open === pick.weaponId}
            onClick={() => setOpen((current) => (current === pick.weaponId ? null : pick.weaponId))}
          >
            <strong className="cs-mastery-weapon">{pick.weaponName}</strong>
            <span className="cs-mastery-name">{pick.mastery.name}</span>
          </button>
        ))}
      </div>
      {shown && (
        <p className="cs-feature-text">
          <strong>{shown.mastery.name}.</strong> {shown.mastery.description}
        </p>
      )}
    </section>
  );
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
  const acting = new Map<string, string>();
  for (const pool of pools) {
    const own = definition.actions.find((action) => (action.uses?.pool ?? action.id) === pool.id);
    const row = serverActions.find((action) => (action.usesPool ?? action.id) === pool.id);
    // A pool whose action does something on its own (a heal, an attack, a spell, an effect) is used through it.
    const does = own
      ? own.healing !== undefined ||
        own.attack !== undefined ||
        own.save !== undefined ||
        own.damage.length > 0 ||
        own.grants !== undefined ||
        own.spellId !== undefined
      : row !== undefined &&
        (row.healing != null || row.attackBonus !== null || row.saveAbility !== null || row.damage.length > 0);
    const id = own?.id ?? row?.id;
    if (does && id) acting.set(pool.id, id);
  }
  // What each use costs on a turn, said beside its name.
  const costs = new Map<string, string>();
  for (const pool of pools) {
    const row = serverActions.find((action) => (action.usesPool ?? action.id) === pool.id);
    const word = row ? ACTIVATION_WORDS[row.activation] : undefined;
    if (word) costs.set(pool.id, word);
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
      {masteries.length > 0 && <MasteryBlock masteries={masteries} />}
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
