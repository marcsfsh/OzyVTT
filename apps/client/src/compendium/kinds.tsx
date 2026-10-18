import type { ReactNode } from "react";
import type { HomebrewTableColumns } from "@vtt/api-contract";
import type { ContentCompendium, ContentCompendiumKind } from "@vtt/domain";
import { IconBag, IconHome, IconList, IconSparkle, IconStar, IconUser } from "@vtt/ui";
import { CodexIcon } from "../codex/icons";
import { formatChallenge } from "../encounter/format";
import { HOMEBREW_TYPES, TYPE_WORDS, type HomebrewType } from "../homebrew/types";

/**
 * The nine kinds the Compendium lists, and what each kind's table shows: its own columns, the two facts a phone's row
 * keeps, and the filters that matter for it. One description serves the GM's tables and the players', so both read a
 * spell by its level and school and a monster by its CR.
 */

export type Kind = HomebrewType;
export const KINDS: readonly Kind[] = HOMEBREW_TYPES;
/** The kinds a player's Compendium lists. No monsters: the bestiary is the GM's. Spell lists have no page of their own. */
export const PLAYER_KINDS: readonly ContentCompendiumKind[] = [
  "class",
  "subclass",
  "species",
  "background",
  "feat",
  "spell",
  "equipment"
];

export const kindLabel = (kind: Kind) => TYPE_WORDS[kind].label;
export const kindPlural = (kind: Kind) => TYPE_WORDS[kind].plural;

export function KindIcon({ kind }: Readonly<{ kind: Kind }>): ReactNode {
  switch (kind) {
    case "class":
      return <CodexIcon iconId="banner" className="cp-kind-icon" />;
    case "subclass":
      return <CodexIcon iconId="flag" className="cp-kind-icon" />;
    case "species":
      return <IconUser className="cp-kind-icon" />;
    case "background":
      return <IconHome className="cp-kind-icon" />;
    case "feat":
      return <IconStar className="cp-kind-icon" />;
    case "spell":
      return <IconSparkle className="cp-kind-icon" />;
    case "spell-list":
      return <IconList className="cp-kind-icon" />;
    case "equipment":
      return <IconBag className="cp-kind-icon" />;
    case "monster":
      return <CodexIcon iconId="paw" className="cp-kind-icon" />;
  }
}

const title = (slug: string) =>
  slug
    .split("-")
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");

/** Names the tables cannot hold: a spell list's, a subclass's class, a background's feat. */
export type Names = Readonly<{
  list: (id: string) => string | null;
  record: (id: string) => string | null;
}>;
export const NO_NAMES: Names = { list: () => null, record: () => null };

/** A list id's name: the one the caller knows, or the SRD class it is named after. Never a homebrew id spelled out. */
export const listName = (names: Names, id: string) => names.list(id) ?? (id.startsWith("hb-") ? null : title(id));
const recordName = (names: Names, id: string | null | undefined) =>
  id ? (names.record(id) ?? (id.startsWith("hb-") ? "A homebrew record" : title(id))) : "None";

/** One column of a kind's table: what it says, and what it sorts by. */
export type KindColumn = Readonly<{
  key: string;
  label: string;
  text: (columns: HomebrewTableColumns, names: Names) => string;
  sort: (columns: HomebrewTableColumns, names: Names) => number | string;
  /** Numbers read right-aligned in tabular figures. */
  numeric?: boolean;
}>;

const LEVEL_WORD = (level: number | null | undefined) =>
  level === null || level === undefined ? "None" : level === 0 ? "Cantrip" : String(level);
const CASTER_WORD: Readonly<Record<string, string>> = {
  full: "Full",
  half: "Half",
  third: "Third",
  pact: "Pact",
  none: "None"
};
const lists = (columns: HomebrewTableColumns, names: Names) =>
  (columns.lists ?? [])
    .map((id) => listName(names, id))
    .filter((name): name is string => Boolean(name))
    .sort()
    .join(", ") || "None";
const attunementWords = (columns: HomebrewTableColumns, names: Names) => {
  const attunement = columns.attunement;
  if (!attunement?.required) return "None";
  if (attunement.restrictedTo.length === 0) return "Required";
  return attunement.restrictedTo.map((id) => recordName(names, id)).join(", ");
};

export const KIND_COLUMNS: Readonly<Record<Kind, readonly KindColumn[]>> = {
  spell: [
    {
      key: "level",
      label: "Level",
      text: (columns) => LEVEL_WORD(columns.level),
      sort: (columns) => columns.level ?? 99,
      numeric: true
    },
    {
      key: "school",
      label: "School",
      text: (columns) => (columns.school ? title(columns.school) : "None"),
      sort: (columns) => columns.school ?? ""
    },
    {
      key: "castingTime",
      label: "Casting time",
      text: (columns) => (columns.castingTime ? title(columns.castingTime) : "None"),
      sort: (columns) => columns.castingTime ?? ""
    },
    {
      key: "range",
      label: "Range",
      text: (columns) => columns.range ?? "None",
      sort: (columns) => columns.range ?? ""
    },
    { key: "lists", label: "Lists", text: lists, sort: lists }
  ],
  monster: [
    {
      key: "challengeRating",
      label: "CR",
      text: (columns) => (columns.challengeRating == null ? "None" : formatChallenge(columns.challengeRating)),
      sort: (columns) => columns.challengeRating ?? -1,
      numeric: true
    },
    {
      key: "sizeType",
      label: "Size and type",
      text: (columns) =>
        [columns.size ? title(columns.size) : null, columns.creatureType ? title(columns.creatureType) : null]
          .filter(Boolean)
          .join(" ") || "None",
      sort: (columns) => `${columns.size ?? ""} ${columns.creatureType ?? ""}`
    },
    {
      key: "armorClass",
      label: "AC",
      text: (columns) => (columns.armorClass == null ? "None" : String(columns.armorClass)),
      sort: (columns) => columns.armorClass ?? -1,
      numeric: true
    },
    {
      key: "hitPoints",
      label: "HP",
      text: (columns) => (columns.hitPoints == null ? "None" : String(columns.hitPoints)),
      sort: (columns) => columns.hitPoints ?? -1,
      numeric: true
    }
  ],
  equipment: [
    {
      key: "rarity",
      label: "Rarity",
      text: (columns) => (columns.rarity ? title(columns.rarity) : "None"),
      sort: (columns) => RARITY_ORDER.indexOf(columns.rarity ?? "") + 1
    },
    { key: "attunement", label: "Attunement", text: attunementWords, sort: attunementWords },
    {
      key: "itemKind",
      label: "Kind",
      text: (columns) => (columns.itemKind ? title(columns.itemKind) : "None"),
      sort: (columns) => columns.itemKind ?? ""
    }
  ],
  class: [
    {
      key: "hitDie",
      label: "Hit Die",
      text: (columns) => columns.hitDie ?? "None",
      sort: (columns) => Number((columns.hitDie ?? "d0").slice(1))
    },
    {
      key: "primary",
      label: "Primary",
      text: (columns) => (columns.primaryAbilities ?? []).map((ability) => ability.toUpperCase()).join(", ") || "None",
      sort: (columns) => (columns.primaryAbilities ?? []).join(",")
    },
    {
      key: "caster",
      label: "Caster",
      text: (columns) => CASTER_WORD[columns.casterType ?? "none"] ?? "None",
      sort: (columns) => ["full", "half", "third", "pact", "none"].indexOf(columns.casterType ?? "none")
    }
  ],
  subclass: [
    {
      key: "class",
      label: "Class",
      text: (columns, names) => recordName(names, columns.classId),
      sort: (columns, names) => recordName(names, columns.classId)
    },
    {
      key: "caster",
      label: "Caster",
      text: (columns) => CASTER_WORD[columns.casterType ?? "none"] ?? "None",
      sort: (columns) => columns.casterType ?? "none"
    }
  ],
  species: [
    {
      key: "size",
      label: "Size",
      text: (columns) => (columns.size ? title(columns.size) : "None"),
      sort: (columns) => SIZE_ORDER.indexOf(columns.size ?? "")
    },
    {
      key: "speed",
      label: "Speed",
      text: (columns) => (columns.speedFeet == null ? "None" : `${columns.speedFeet} ft.`),
      sort: (columns) => columns.speedFeet ?? 0,
      numeric: true
    }
  ],
  background: [
    {
      key: "feat",
      label: "Feat",
      text: (columns, names) => recordName(names, columns.originFeatId),
      sort: (columns, names) => recordName(names, columns.originFeatId)
    }
  ],
  feat: [
    {
      key: "category",
      label: "Category",
      text: (columns) => (columns.category ? title(columns.category) : "None"),
      sort: (columns) => columns.category ?? ""
    },
    {
      key: "prerequisite",
      label: "Prerequisite",
      text: (columns) => (columns.prerequisiteLevel ? `Level ${columns.prerequisiteLevel}+` : "None"),
      sort: (columns) => columns.prerequisiteLevel ?? 0
    }
  ],
  "spell-list": [
    {
      key: "spells",
      label: "Spells",
      text: (columns) => (columns.spellCount == null ? "None" : String(columns.spellCount)),
      sort: (columns) => columns.spellCount ?? 0,
      numeric: true
    }
  ]
};

const RARITY_ORDER = ["common", "uncommon", "rare", "very-rare", "legendary", "artifact", "varies"];
const SIZE_ORDER = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

/** The two facts a phone keeps on each row, as the kind's first columns say them. */
export function phoneFacts(kind: Kind, columns: HomebrewTableColumns, names: Names): string {
  switch (kind) {
    case "spell":
      return [
        columns.level === 0 ? "Cantrip" : columns.level != null ? `Level ${columns.level}` : null,
        columns.school ? title(columns.school) : null,
        columns.castingTime ? title(columns.castingTime) : null
      ]
        .filter(Boolean)
        .join(" · ");
    case "monster":
      return [
        columns.challengeRating == null ? null : `CR ${formatChallenge(columns.challengeRating)}`,
        KIND_COLUMNS.monster[1]!.text(columns, names)
      ]
        .filter(Boolean)
        .join(" · ");
    default:
      return KIND_COLUMNS[kind]
        .slice(0, 2)
        .map((column) => column.text(columns, names))
        .filter((value) => value !== "None")
        .join(" · ");
  }
}

/** A filter that belongs to one kind: Level for spells, CR for monsters. Its options come from the rows. */
export type KindFilter = Readonly<{
  key: string;
  label: string;
  /** The value a row has for it, or null when it has none. */
  value: (columns: HomebrewTableColumns) => string | null;
  /** How a value reads in the filter. */
  word: (value: string) => string;
  /** The order the values list in. */
  order?: (left: string, right: string) => number;
}>;

const numeric = (left: string, right: string) => Number(left) - Number(right);
export const KIND_FILTERS: Readonly<Record<Kind, readonly KindFilter[]>> = {
  spell: [
    {
      key: "level",
      label: "Level",
      value: (columns) => (columns.level == null ? null : String(columns.level)),
      word: (value) => (value === "0" ? "Cantrip" : value),
      order: numeric
    },
    { key: "school", label: "School", value: (columns) => columns.school ?? null, word: title }
  ],
  monster: [
    {
      key: "cr",
      label: "CR",
      value: (columns) => (columns.challengeRating == null ? null : String(columns.challengeRating)),
      word: (value) => formatChallenge(Number(value)),
      order: numeric
    },
    { key: "size", label: "Size", value: (columns) => columns.size ?? null, word: title },
    { key: "type", label: "Type", value: (columns) => columns.creatureType ?? null, word: title }
  ],
  equipment: [
    { key: "rarity", label: "Rarity", value: (columns) => columns.rarity ?? null, word: title },
    { key: "itemKind", label: "Kind", value: (columns) => columns.itemKind ?? null, word: title }
  ],
  class: [
    {
      key: "caster",
      label: "Caster",
      value: (columns) => columns.casterType ?? "none",
      word: (value) => CASTER_WORD[value] ?? title(value)
    }
  ],
  subclass: [{ key: "class", label: "Class", value: (columns) => columns.classId ?? null, word: title }],
  species: [{ key: "size", label: "Size", value: (columns) => columns.size ?? null, word: title }],
  background: [],
  feat: [{ key: "category", label: "Category", value: (columns) => columns.category ?? null, word: title }],
  "spell-list": []
};

/** A player's catalog row as the same columns the GM's table reads, so one set of columns serves both. */
export function columnsOfEntry(entry: ContentCompendium, index: number): HomebrewTableColumns {
  switch (entry.kind) {
    case "spell": {
      const row = entry.rows[index]!;
      return {
        level: row.level,
        school: row.school,
        castingTime: row.castingTime,
        range: row.rangeText,
        lists: [...row.classes]
      };
    }
    case "equipment": {
      const row = entry.rows[index]!;
      return {
        itemKind: row.category,
        rarity: row.rarity,
        attunement: row.attunement
          ? { required: row.attunement.required, restrictedTo: [...row.attunement.restrictedTo] }
          : null
      };
    }
    case "class": {
      const row = entry.rows[index]!;
      return {
        hitDie: row.hitDie,
        primaryAbilities: [...row.primaryAbilities],
        casterType: row.spellcasting?.progression ?? "none"
      };
    }
    case "subclass": {
      const row = entry.rows[index]!;
      return { classId: row.classId, casterType: row.spellcasting?.progression ?? null };
    }
    case "species": {
      const row = entry.rows[index]!;
      return { size: row.sizes[0] ?? null, speedFeet: row.speedFeet };
    }
    case "background":
      return { originFeatId: entry.rows[index]!.originFeatId };
    case "feat": {
      const row = entry.rows[index]!;
      return { category: row.category, prerequisiteLevel: row.prerequisiteLevel };
    }
  }
}
