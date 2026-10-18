import type { HomebrewContentType, HomebrewReference, HomebrewTableColumns, HomebrewTableRow } from "@vtt/api-contract";
import {
  loadBackgrounds,
  loadClasses,
  loadEquipment,
  loadFeats,
  loadMonsterDefinitions,
  loadSpecies,
  loadSpells,
  loadSubclasses
} from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";
import { statblockFacts } from "./statblock-facts.js";
import type { HomebrewBody } from "./homebrew-store.js";

/**
 * The GM's library reads that are not one record: a kind's table columns, the SRD's rows beside the homebrew ones,
 * the names behind the ids a body mentions, and text search. GM only; nothing here reaches a player.
 */

type Loose = Record<string, unknown>;
const asObject = (value: unknown): Loose | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : null;
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const integer = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
const strings = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : null;

/** How a class or subclass casts, from its spellcasting header; "none" when it has none. */
function casterTypeOf(body: Loose): HomebrewTableColumns["casterType"] {
  const spellcasting = asObject(body.spellcasting);
  if (!spellcasting) return "none";
  const progression = spellcasting.multiclassProgression;
  return progression === "full" || progression === "half" || progression === "third" || progression === "pact"
    ? progression
    : null;
}

/**
 * A kind's own columns, read defensively from a body that may be a half-made draft: a value the body does not hold is
 * null. The same reading serves SRD records, so one table holds both.
 */
export function columnsOf(type: HomebrewContentType, raw: unknown): HomebrewTableColumns {
  const body = asObject(raw) ?? {};
  switch (type) {
    case "spell":
      return {
        level: integer(body.level),
        school: text(body.school),
        castingTime: text(body.castingTime),
        range: text(asObject(body.range)?.text),
        lists: strings(body.classes)
      };
    case "monster": {
      const facts = statblockFacts(body as unknown as ActorDefinition);
      return {
        challengeRating: facts.challengeRating,
        size: text(body.size),
        creatureType: facts.creatureType,
        armorClass: integer(body.armorClass),
        hitPoints: integer(asObject(body.hitPoints)?.maximum)
      };
    }
    case "equipment": {
      const attunement = asObject(body.attunement);
      return {
        itemKind: text(body.category),
        rarity: text(body.rarity),
        attunement: attunement
          ? { required: attunement.required === true, restrictedTo: strings(attunement.restrictedTo) ?? [] }
          : null
      };
    }
    case "class":
      return {
        hitDie: text(body.hitDie),
        primaryAbilities: strings(body.primaryAbilities),
        casterType: casterTypeOf(body)
      };
    case "subclass":
      return { classId: text(body.classId), casterType: casterTypeOf(body) };
    case "species":
      return { size: strings(body.sizes)?.[0] ?? null, speedFeet: integer(body.speedFeet) };
    case "background":
      return { originFeatId: text(body.originFeatId) };
    case "feat":
      return { category: text(body.category), prerequisiteLevel: integer(asObject(body.prerequisite)?.level) };
    case "spell-list":
      return { spellCount: strings(body.add)?.length ?? 0 };
  }
}

/** One SRD record as the table lists it, and as an id-to-name entry. */
type SrdRecord = Readonly<{ id: string; name: string; body: unknown }>;

/** The bundled records of a kind; spell lists have none. Read once, since the bundle never changes at runtime. */
const srdByKind = new Map<HomebrewContentType, readonly SrdRecord[]>();
export function srdRecordsOf(kind: HomebrewContentType): readonly SrdRecord[] {
  const known = srdByKind.get(kind);
  if (known) return known;
  const loaded: readonly SrdRecord[] = (() => {
    switch (kind) {
      case "class":
        return loadClasses();
      case "subclass":
        return loadSubclasses();
      case "species":
        return loadSpecies();
      case "background":
        return loadBackgrounds();
      case "feat":
        return loadFeats();
      case "spell":
        return loadSpells();
      case "equipment":
        return loadEquipment();
      case "monster":
        return loadMonsterDefinitions().flatMap((definition) =>
          definition.source.externalId ? [{ ...definition, id: definition.source.externalId }] : []
        );
      case "spell-list":
        return [];
    }
  })().map((record) => ({ id: record.id, name: record.name, body: record }));
  srdByKind.set(kind, loaded);
  return loaded;
}

export const HOMEBREW_KINDS: readonly HomebrewContentType[] = [
  "class",
  "subclass",
  "species",
  "background",
  "feat",
  "spell",
  "equipment",
  "monster",
  "spell-list"
];

/** Every SRD record across the kinds. */
export function srdRecordCount(): number {
  return HOMEBREW_KINDS.reduce((total, kind) => total + srdRecordsOf(kind).length, 0);
}

/** The SRD's rows of a kind, as the GM's table lists them beside homebrew. */
export function srdTableRows(kind: HomebrewContentType): HomebrewTableRow[] {
  return srdRecordsOf(kind).map((record) => ({
    id: record.id,
    kind,
    name: record.name,
    source: "srd",
    packId: null,
    state: "published",
    archived: false,
    inCatalogs: true,
    pendingChanges: false,
    issueCount: 0,
    audience: "everyone",
    characterIds: [],
    basedOn: null,
    createdAt: null,
    updatedAt: null,
    usageCount: null,
    columns: columnsOf(kind, record.body)
  }));
}

/** The names behind ids: every SRD record, then every homebrew record (drafts and archived ones too, for the GM). */
export type NameIndex = ReadonlyMap<string, HomebrewReference>;
let srdNames: Map<string, HomebrewReference> | undefined;
export function nameIndexOf(
  homebrew: ReadonlyArray<Readonly<{ id: string; type: HomebrewContentType; name: string }>>
) {
  srdNames ??= new Map(
    HOMEBREW_KINDS.flatMap((kind) =>
      srdRecordsOf(kind).map(
        (record) => [record.id, { type: kind, name: record.name, source: "srd" as const }] as const
      )
    )
  );
  const index = new Map(srdNames);
  for (const row of homebrew) index.set(row.id, { type: row.type, name: row.name, source: "homebrew" });
  return index as NameIndex;
}

/** Every other record a body names by id, with its name, so an editor never shows an id where it can show a name. */
export function referencesOf(body: unknown, ownId: string, index: NameIndex): Record<string, HomebrewReference> {
  const found: Record<string, HomebrewReference> = {};
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      if (node === ownId || found[node]) return;
      const named = index.get(node);
      if (named) found[node] = named;
      return;
    }
    if (Array.isArray(node)) for (const child of node) walk(child);
    else if (node && typeof node === "object") for (const value of Object.values(node)) walk(value);
  };
  walk(body);
  return found;
}

const MATCH_WIDTH = 200;
/** The line holding a match, cut to 200 characters around it. */
function lineAround(value: string, at: number, length: number): string {
  const start = value.lastIndexOf("\n", at) + 1;
  const end = value.indexOf("\n", at);
  const line = value.slice(start, end < 0 ? undefined : end);
  if (line.length <= MATCH_WIDTH) return line.trim();
  const offset = at - start;
  const from = Math.max(0, Math.min(offset - Math.floor((MATCH_WIDTH - length) / 2), line.length - MATCH_WIDTH));
  return line.slice(from, from + MATCH_WIDTH).trim();
}

/** Where a query appears in a body: each text that holds it, by path, with its line. Case is ignored. */
export function matchesIn(
  body: HomebrewBody,
  query: string,
  limit = 3
): Array<{ path: Array<string | number>; line: string }> {
  const needle = query.toLowerCase();
  const matches: Array<{ path: Array<string | number>; line: string }> = [];
  const walk = (node: unknown, path: Array<string | number>) => {
    if (matches.length >= limit) return;
    if (typeof node === "string") {
      const at = node.toLowerCase().indexOf(needle);
      if (at >= 0) matches.push({ path, line: lineAround(node, at, needle.length) });
      return;
    }
    if (Array.isArray(node)) node.forEach((child, index) => walk(child, [...path, index]));
    else if (node && typeof node === "object")
      for (const [key, value] of Object.entries(node)) {
        // Ids and slugs are not text a GM reads.
        if (key === "id" || key === "source" || key === "type") continue;
        walk(value, [...path, key]);
      }
  };
  walk(body, []);
  return matches;
}
