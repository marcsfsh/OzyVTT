/**
 * Why publishing is blocked: every outstanding requirement, each as an imperative sentence.
 *
 * Drafts show no per-field errors (a draft may be incomplete); requirements surface only beneath
 * the Publish button. `FieldDef.validate` is different and fires inline, because it means the value
 * is wrong now.
 *
 * `publishIssues` runs `HOMEBREW_BODY_SCHEMAS`, the same schemas the server's publish gate uses,
 * so the checklist cannot be looser than the store. The server still re-validates and its answer wins.
 *
 * Copy template: `"{Imperative}."`. The sentence never names its section; `sectionId` drives a
 * separate jump control that does.
 */

import { featurePicks, HOMEBREW_BODY_SCHEMAS } from "@vtt/content-srd-5.2.1/schemas";
import { forStorage } from "./defaults";
import { getAt } from "./paths";
// The gating vocabulary comes from the form that offers it, so new conditions are checked here too.
import { modifierLabel } from "./riders/modifiers";
import { triggerKindOf } from "./riders/triggers";
import { isDiceFormula, namesOwnRecord, type Draft, type SchemaContext } from "./schema";
import { fieldAt } from "./schemas";
import { TYPE_WORDS, typeLabel, type HomebrewType } from "./types";

export type BlockedReason = Readonly<{
  text: string;
  sectionId?: string;
  /** The dotted path this requirement is about, used only to drop a schema issue about the same
      field. The hand-written sentence always wins. */
  path?: string;
}>;

const blank = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

const need = (draft: Draft, path: string, text: string, sectionId: string): BlockedReason | null =>
  blank(getAt(draft, path)) ? { text, sectionId, path } : null;

/** Non-null checks in declaration order; order is priority (name first, then what the record
    cannot be built without). */
const all = (...checks: ReadonlyArray<BlockedReason | null>): readonly BlockedReason[] =>
  checks.filter((check): check is BlockedReason => check !== null);

/** The first present-but-unparseable `{ formula }` in a rider bag. Blocks publish as well as
    showing inline, because an unparseable formula deals zero damage. */
function badFormula(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = badFormula(entry);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const formula = record.formula;
  if (typeof formula === "string" && formula.trim() !== "" && !isDiceFormula(formula)) return formula;
  for (const nested of Object.values(record)) {
    const found = badFormula(nested);
    if (found) return found;
  }
  return null;
}

/**
 * Structural rules for a rider's gating list, wherever a modifier lives:
 * 1. At most one "Only when…" (moment) line: a rider fires at one moment.
 * 2. An "Only for…" (filter) line needs a moment, or it never matches.
 * These are about a row's siblings, so they can't be a field-level `validate`.
 */
function badGating(draft: Draft, sectionId: string): BlockedReason | null {
  let found: BlockedReason | null = null;
  const walk = (value: unknown): void => {
    if (found) return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const when = record.when;
    if (Array.isArray(when)) {
      const kinds = when.map((entry) => triggerKindOf((entry as { type?: unknown })?.type));
      const name = modifierLabel(record.type);
      if (kinds.filter((kind) => kind === "moment").length > 1) {
        found = { text: `Leave "${name}" one "Only when…" line. A modifier fires at only one moment.`, sectionId };
        return;
      }
      if (kinds.includes("filter") && !kinds.includes("moment")) {
        found = {
          text: `Add an "Only when…" line to "${name}". An "Only for…" line has nothing to narrow on its own.`,
          sectionId
        };
        return;
      }
    }
    for (const nested of Object.values(record)) walk(nested);
  };
  walk(draft);
  return found;
}

/** Every `FeatureRecord` on a record: the list at `features` or `traits`, or the single object at
    `feature` (feats). */
function featuresOf(draft: Draft): Array<Record<string, unknown>> {
  if (Array.isArray(draft.features)) return draft.features as Array<Record<string, unknown>>;
  if (Array.isArray(draft.traits)) return draft.traits as Array<Record<string, unknown>>;
  const one = draft.feature;
  return one && typeof one === "object" && !Array.isArray(one) ? [one as Record<string, unknown>] : [];
}

/**
 * A class feature that asks a choice but sits on no level row. Class features are granted only
 * from `levelTable[].features[]`, so the pick has zero capacity while the wizard still demands an
 * answer, making the character impossible to create. `FeatureEditor` prevents this; this catches
 * records from pack imports or SRD copies.
 */
function ungrantedChoice(draft: Draft): BlockedReason | null {
  const table = Array.isArray(draft.levelTable) ? (draft.levelTable as Array<Record<string, unknown>>) : [];
  if (table.length === 0) return null;
  const granted = new Set<string>();
  for (const row of table)
    for (const id of Array.isArray(row.features) ? (row.features as string[]) : []) granted.add(id);
  for (const entry of featuresOf(draft)) {
    if (draftPicksOf(entry).length === 0 || typeof entry.id !== "string" || granted.has(entry.id)) continue;
    return {
      text: `Give "${entry.name || "an unnamed feature"}" a level. It asks the player to choose, and a choice granted at no level makes the character impossible to create.`,
      sectionId: "features"
    };
  }
  return null;
}

/** Every pick a draft feature asks for, via the server's own `featurePicks` accessor. */
const draftPicksOf = (entry: Record<string, unknown> | undefined): ReadonlyArray<Record<string, unknown>> =>
  entry ? featurePicks(entry as { choice?: Record<string, unknown>; choices?: Record<string, unknown>[] }) : [];

/** A choice whose `fromCatalog` resolves to nothing would be silently skipped at build time.
    Self-derived slugs (`namesOwnRecord`) are skipped: only the server can count which drafts name
    this record, and its answer arrives in `doc.validity`. */
function brokenCatalog(draft: Draft, ctx: SchemaContext, sectionId: string): BlockedReason | null {
  for (const entry of featuresOf(draft)) {
    // Every pick, not just the first.
    for (const choice of draftPicksOf(entry)) {
      const slug = typeof choice?.fromCatalog === "string" ? choice.fromCatalog : "";
      if (!slug || namesOwnRecord(slug, ctx.recordId)) continue;
      const result = ctx.resolveCatalog(slug);
      if ("error" in result) {
        return {
          text: `Fix the catalog for "${entry.name || "an unnamed feature"}". It matches nothing, so the choice would be skipped.`,
          sectionId
        };
      }
    }
  }
  return null;
}

/** An item whose card is drawn from typed data ("1d8 slashing", "+2 AC", or a magic item's
    mechanics) is not a blank card and needs no prose. `EquipmentReferenceSchema.description` is
    nullable and SRD weapons and armour carry `null`, so requiring it would block duplicated SRD items. */
const hasDerivedCard = (draft: Draft): boolean => {
  const weapon = draft.weapon as Record<string, unknown> | null | undefined;
  const armor = draft.armor as Record<string, unknown> | null | undefined;
  if (weapon && !blank(weapon.damageDice)) return true;
  if (armor && typeof armor.acBase === "number") return true;
  if (draft.isMagic !== true) return false;
  const nonEmpty = (value: unknown) => Array.isArray(value) && value.length > 0;
  const grants = draft.grants as Record<string, unknown> | undefined;
  return (
    nonEmpty(draft.modifiers) ||
    nonEmpty(draft.casts) ||
    nonEmpty(draft.grantsFeatIds) ||
    nonEmpty(draft.actions) ||
    nonEmpty(draft.effects) ||
    !!draft.uses ||
    (!!grants && Object.values(grants).some(nonEmpty))
  );
};

/** The field each player-facing pick card is built from (a `summary`, or an item's `description`).
    A creature's browse row has no prose field, so it has no entry. */
const SHOWN_TO_PLAYERS: Partial<
  Record<HomebrewType, Readonly<{ path: string; text: string; unless?: (draft: Draft) => boolean }>>
> = {
  class: { path: "summary", text: "Write the one-line summary. It's the whole card a player picks this class from." },
  species: {
    path: "summary",
    text: "Write the one-line summary. It's the whole card a player picks this species from."
  },
  background: {
    path: "summary",
    text: "Write the one-line summary. It's the whole card a player picks this background from."
  },
  feat: { path: "summary", text: "Write the one-line summary. It's the whole card a player picks this feat from." },
  equipment: {
    path: "description",
    text: "Describe this item. With no weapon or armour numbers, the description is the whole card the inventory shows.",
    unless: hasDerivedCard
  }
};

/** Requirements this side states better than the schema, in priority order: copy a Zod message
    can't produce, or rules no schema expresses. Plain "schema requires this key" belongs to
    `schemaIssues` and must not be restated here. */
function localIssues(type: HomebrewType, draft: Draft, ctx: SchemaContext): readonly BlockedReason[] {
  const word = typeLabel(type);
  const named = need(draft, "name", `Give this ${word} a name.`, "basics");
  // A nameless record gets this one instruction and nothing else.
  if (named) return [named];

  const shown = SHOWN_TO_PLAYERS[type];
  const blankCard = shown && !shown.unless?.(draft) ? need(draft, shown.path, shown.text, "basics") : null;

  const formula = badFormula(draft);
  const formulaBlocker: BlockedReason | null = formula
    ? { text: `Fix the damage formula "${formula}". It isn't a dice roll the game can make.`, sectionId: "features" }
    : null;

  switch (type) {
    case "class": {
      const spellcasting = draft.spellcasting as Record<string, unknown> | null | undefined;
      const listId = typeof spellcasting?.spellListId === "string" ? spellcasting.spellListId : "";
      return all(
        blankCard,
        need(draft, "hitDie", "Choose a hit die.", "progression"),
        need(draft, "primaryAbilities", "Pick this class's primary ability.", "progression"),
        need(draft, "savingThrows", "Pick the two saving throws this class is proficient in.", "progression"),
        need(draft, "skillChoices.from", "Pick which skills this class can choose from.", "proficiencies"),
        spellcasting && !listId
          ? { text: "Choose a spell list. A caster with no list can't be built.", sectionId: "progression" }
          : null,
        formulaBlocker,
        // Before `brokenCatalog`: a skipped choice still builds, an ungranted one cannot.
        ungrantedChoice(draft),
        brokenCatalog(draft, ctx, "features"),
        badGating(draft, "features")
      );
    }

    case "subclass":
      return all(
        blankCard,
        // Don't end the sentence on the section title ("Belongs to"); the jump control shows it.
        need(draft, "classId", "Choose the class this subclass is for.", "belongs-to"),
        (draft.spellcasting as Record<string, unknown> | null | undefined) &&
          blank(getAt(draft, "spellcasting.spellListId"))
          ? {
              text: "Choose a spell list. A subclass caster falls back to the class list, which for a homebrew class is empty.",
              sectionId: "belongs-to"
            }
          : null,
        formulaBlocker,
        brokenCatalog(draft, ctx, "features"),
        badGating(draft, "features")
      );

    case "species":
      return all(
        blankCard,
        need(draft, "speedFeet", "Give this species a walking speed.", "body"),
        need(draft, "sizes", "Choose at least one size.", "body"),
        formulaBlocker,
        brokenCatalog(draft, ctx, "traits"),
        badGating(draft, "traits")
      );

    case "background":
      return all(
        blankCard,
        need(draft, "originFeatId", "Choose the feat this background grants.", "origin"),
        formulaBlocker,
        brokenCatalog(draft, ctx, "features"),
        badGating(draft, "features")
      );

    case "feat":
      return all(
        blankCard,
        // The section is titled "Category", so the sentence avoids that word.
        need(draft, "category", "Say what kind of feat this is. Nothing offers one without it.", "category"),
        // `feature`, singular. Its name is printed beside the pick, so it must be set.
        need(draft, "feature.name", "Say what this feat does.", "feature"),
        formulaBlocker,
        brokenCatalog(draft, ctx, "feature"),
        badGating(draft, "feature")
      );

    case "spell":
      return all(
        blankCard,
        need(draft, "description", "Describe what this spell does.", "basics"),
        need(draft, "school", "Give this spell a school.", "casting"),
        need(draft, "castingTime", "Say how long this spell takes to cast.", "casting"),
        need(draft, "duration", "Give this spell a duration.", "casting"),
        typeof getAt(draft, "damage.roll") === "string" && !isDiceFormula(String(getAt(draft, "damage.roll")))
          ? { text: `Fix the damage formula "${getAt(draft, "damage.roll")}".`, sectionId: "effect" }
          : null,
        !blank(getAt(draft, "damage.roll")) && blank(getAt(draft, "damage.types"))
          ? { text: "Give this spell a damage type.", sectionId: "effect" }
          : null
      );

    case "spell-list": {
      const add = Array.isArray(draft.add) ? draft.add : [];
      const basedOn = Array.isArray(draft.basedOn) ? draft.basedOn : [];
      return all(
        blankCard,
        add.length === 0 && basedOn.length === 0
          ? {
              text: "Add at least one spell to this list. A class using an empty list can't be created.",
              sectionId: "contents"
            }
          : null
      );
    }

    case "equipment": {
      const weapon = draft.weapon as Record<string, unknown> | null | undefined;
      const casts = Array.isArray(draft.casts) ? (draft.casts as Array<Record<string, unknown>>) : [];
      return all(
        blankCard,
        need(draft, "category", "Give this item a category.", "basics"),
        // The editor seeds the whole weapon block on first touch, so the remaining hole is empty
        // dice: an attack that rolls nothing.
        weapon && blank(weapon.damageDice)
          ? {
              text: "Give this weapon its damage, or clear the whole Weapon section. A weapon with no dice rolls nothing.",
              sectionId: "weapon",
              path: "weapon.damageDice"
            }
          : null,
        weapon && !blank(weapon.damageDice) && blank(weapon.damageType)
          ? { text: "Give this item a damage type.", sectionId: "weapon", path: "weapon.damageType" }
          : null,
        weapon &&
          typeof weapon.damageDice === "string" &&
          weapon.damageDice.trim() !== "" &&
          !isDiceFormula(weapon.damageDice)
          ? { text: `Fix the damage formula "${weapon.damageDice}".`, sectionId: "weapon" }
          : null,
        casts.some((cast) => blank(cast.spellId))
          ? { text: "Choose which spell this item casts, or take the empty row off.", sectionId: "magic" }
          : null,
        // `appliesTo` is both-or-neither: label and bases are required together.
        !blank(getAt(draft, "appliesTo.label")) && blank(getAt(draft, "appliesTo.baseIds"))
          ? {
              text: 'List the bases this item can be, or clear its "applies to" line.',
              sectionId: "magic",
              path: "appliesTo.baseIds"
            }
          : null,
        blank(getAt(draft, "appliesTo.label")) && !blank(getAt(draft, "appliesTo.baseIds"))
          ? {
              text: 'Give the "applies to" choice its printed wording, or clear the base list.',
              sectionId: "magic",
              path: "appliesTo.label"
            }
          : null,
        // Attunement is what springs a curse and the boundary the hiding rule needs.
        draft.cursed === true && getAt(draft, "attunement.required") !== true
          ? {
              text: "Make this item require attunement. Attuning is what springs a curse and what reveals it.",
              sectionId: "magic"
            }
          : null,
        draft.isMagic === true &&
          !!draft.uses &&
          blank(getAt(draft, "uses.limit")) &&
          blank(getAt(draft, "uses.scaling"))
          ? { text: "Say how many charges this item has, or turn charges off.", sectionId: "magic" }
          : null,
        formulaBlocker,
        badGating(draft, "magic")
      );
    }

    case "monster": {
      // Challenge rating lives in the `open5e.srd-2024` extension, where the bestiary reads it.
      const statblock = (draft.extensions as Record<string, Record<string, unknown>> | undefined)?.["open5e.srd-2024"];
      return all(
        blankCard,
        typeof statblock?.challengeRating !== "number"
          ? { text: "Give this creature a challenge rating.", sectionId: "identity" }
          : null,
        need(draft, "armorClass", "Give this creature an armour class.", "defences"),
        need(draft, "hitPoints.maximum", "Give this creature hit points.", "defences"),
        typeof getAt(draft, "hitPoints.formula") === "string" &&
          String(getAt(draft, "hitPoints.formula")).trim() !== "" &&
          !isDiceFormula(String(getAt(draft, "hitPoints.formula")))
          ? { text: `Fix the hit-point formula "${getAt(draft, "hitPoints.formula")}".`, sectionId: "defences" }
          : null,
        formulaBlocker
      );
    }

    default:
      return all(blankCard);
  }
}

/** One validity issue (server or shared schema) in the standard sentence shape. The label and
    section come from the form schema via the issue's `path`. `missing` marks a value the body does
    not have at all, which reads as "Fill in" rather than as the schema's wording. */
export function issueReason(
  type: HomebrewType,
  issue: { path: ReadonlyArray<string | number>; message: string; missing?: boolean } | undefined,
  lookup: (
    path: ReadonlyArray<string | number>
  ) => Readonly<{ label: string; sectionId: string; sectionTitle: string }> | null = (path) => fieldAt(type, path)
): BlockedReason | null {
  if (!issue) return null;
  const dotted = issue.path.filter((segment) => typeof segment === "string").join(".");
  const found = lookup(issue.path);
  if (!found) {
    // No field owns this path (whole-record rule, extension bag); pass the message through.
    return { text: issue.message, path: dotted || undefined };
  }
  // Zod messages lack terminal punctuation; the template adds it once.
  const detail = issue.message.replace(/[.\s]+$/, "");
  return {
    text: issue.missing
      ? `Fill in ${found.label}.`
      : `Fix ${found.label}: ${detail.charAt(0).toLowerCase()}${detail.slice(1)}.`,
    sectionId: found.sectionId,
    path: dotted || undefined
  };
}

/** The first entry of `publishIssues`. */
export function publishBlockedReason(
  type: HomebrewType,
  draft: Draft,
  ctx: SchemaContext,
  recordId = ctx.recordId
): BlockedReason | null {
  return publishIssues(type, draft, ctx, recordId)[0] ?? null;
}

/** The body the store would hold, built as the save path builds it: `forStorage` drops editor-only
    row ids, `id` is forced to the record id (as `normalizeBody` does server-side), and a creature's
    `source.externalId` is forced to the same id (the bestiary's identity key). */
export function bodyForPublish(type: HomebrewType, draft: Draft, recordId: string): Record<string, unknown> {
  const body: Record<string, unknown> = { ...forStorage(draft), id: recordId };
  // The row owns the type; a `type` key would fail the `.strict()` body schemas.
  delete body.type;
  if (type === "monster") {
    const source =
      body.source && typeof body.source === "object" && !Array.isArray(body.source)
        ? (body.source as Record<string, unknown>)
        : {};
    body.source = { ...source, externalId: recordId };
  }
  return body;
}

/** Issues from the record's own schema, the same `HOMEBREW_BODY_SCHEMAS` entry the server's publish
    gate and store read-back use. Unnamed records short-circuit before this runs. */
function schemaIssues(type: HomebrewType, draft: Draft, recordId: string): readonly BlockedReason[] {
  const schema = HOMEBREW_BODY_SCHEMAS[type];
  if (!schema) return [];
  const body = bodyForPublish(type, draft, recordId);
  const parsed = schema.safeParse(body) as {
    success: boolean;
    error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
  };
  if (parsed.success) return [];
  const out: BlockedReason[] = [];
  for (const issue of parsed.error?.issues ?? []) {
    const path = issue.path.map((key) => (typeof key === "number" ? key : String(key)));
    // `id` is forced by the store; the server's identity check reports id problems better.
    if (path[0] === "id") continue;
    const missing = path.length > 0 && getAt(body, path.join(".")) === undefined;
    const reason = issueReason(type, { path, message: issue.message, missing });
    if (reason) out.push(reason);
  }
  return out;
}

/** Drop a schema issue about a field a hand-written sentence already covers. */
const coveredBy = (owned: ReadonlySet<string>, path: string | undefined): boolean =>
  path !== undefined && [...owned].some((prefix) => path === prefix || path.startsWith(`${prefix}.`));

/** Everything outstanding, in priority order: the hand-written sentences, then whatever the
    record's own schema still refuses. */
export function publishIssues(
  type: HomebrewType,
  draft: Draft,
  ctx: SchemaContext,
  recordId = ctx.recordId
): readonly BlockedReason[] {
  const local = localIssues(type, draft, ctx);
  // An unnamed record shows only that.
  if (local.length === 1 && local[0].path === "name") return local;
  const owned = new Set(local.map((reason) => reason.path).filter((path): path is string => !!path));
  return [...local, ...schemaIssues(type, draft, recordId).filter((issue) => !coveredBy(owned, issue.path))];
}

/** "Another class is also called Frost Warden." Annotated, never blocking. */
export function duplicateNameNote(type: HomebrewType, name: string, ctx: SchemaContext): string | null {
  const trimmed = name.trim().toLowerCase();
  if (trimmed === "") return null;
  const clash = ctx.siblings.some(
    (sibling) => sibling.id !== ctx.recordId && sibling.name.trim().toLowerCase() === trimmed
  );
  if (!clash) return null;
  const word = TYPE_WORDS[type]?.label ?? type;
  return `Another ${word} is also called ${name.trim()}.`;
}
