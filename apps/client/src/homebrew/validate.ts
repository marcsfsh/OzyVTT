/**
 * Why publishing is blocked — **the first unmet requirement, as an instruction.**
 *
 * ## Drafts show no errors at all
 *
 * This is the whole reason this file exists instead of a `required` asterisk. A draft is
 * GM-only and is *allowed* to be invalid — that is what the state is for. So while
 * drafting there is no asterisk, no red border, no per-field message and no "ready to
 * publish" checklist. The requirement surfaces exactly once, as one sentence, beneath
 * the button it blocks.
 *
 * That is a different thing from `FieldDef.validate`, which DOES fire inline: a
 * malformed dice formula is the field being wrong *now*, not a requirement not yet met.
 * Keeping the two apart is what makes "drafts may be invalid, publish requires validity"
 * legible instead of a red-asterisk hunt.
 *
 * ## One copy template
 *
 * > **`"{Imperative}."`** — and the section is a CONTROL, never a second copy of the word.
 *
 * The sentence used to name its own section while `RecordDetail` rendered a jump button
 * labelled with that same section immediately after it, so every blocker printed its
 * section name twice — worst case, a feat's *"Say what this feat does"* followed by a
 * control reading *"The feat itself"* after the sentence had already said it. The two
 * halves were written independently and neither knew about the other. The `sectionId`
 * still rides on every reason — it is what the jump control needs — but the WORD belongs
 * to the control alone. Say the thing once.
 *
 * Never a boolean, never a list. Shaped exactly like the character builder's
 * `stepBlockedReason`, which buys "progress means done, not visited" and "state a
 * constraint once per group" for free — and the five sentence shapes the readiness pass
 * deleted at source do not come back.
 */

import { getAt } from "./paths";
import { isDiceFormula, namesOwnRecord, type Draft, type SchemaContext } from "./schema";
import { TYPE_WORDS, typeLabel, type HomebrewType } from "./types";

export type BlockedReason = Readonly<{ text: string; sectionId?: string }>;

const blank = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

const need = (draft: Draft, path: string, text: string, sectionId: string): BlockedReason | null =>
  blank(getAt(draft, path)) ? { text, sectionId } : null;

/** The first non-null of a list of checks. Order IS the priority: name before anything,
    then the fields without which the record cannot be built at all. */
const first = (...checks: ReadonlyArray<BlockedReason | null>): BlockedReason | null =>
  checks.find((check) => check !== null) ?? null;

/** Every `{ formula }` in a rider bag that is present and unparseable. Reported as a
    publish blocker AS WELL AS inline, because a formula the engine cannot read is
    silently zero damage — the failure a GM would otherwise discover mid-combat. */
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

/** Every `FeatureRecord` on a record, whichever key its type stores them under: a list at
    `features` (class, subclass, background), `traits` (species), or the ONE object at
    `feature` (a feat — `FeatReferenceSchema` is singular there). */
function featuresOf(draft: Draft): Array<Record<string, unknown>> {
  if (Array.isArray(draft.features)) return draft.features as Array<Record<string, unknown>>;
  if (Array.isArray(draft.traits)) return draft.traits as Array<Record<string, unknown>>;
  const one = draft.feature;
  return one && typeof one === "object" && !Array.isArray(one) ? [one as Record<string, unknown>] : [];
}

/**
 * A class feature that asks a choice but sits on no level row.
 *
 * The server grants class features from `levelTable[].features[]` and nowhere else, so
 * this feature's pick capacity is `choose × 0` — while the wizard reads `feature.level`,
 * offers the pick and refuses to Create until it is answered. The result is a character
 * that cannot be created and an error naming a feature id.
 *
 * `FeatureEditor` makes the state unauthorable, so this is the backstop for the one path
 * it does not own: a record that arrived from a pack import or an SRD copy already in
 * this shape. A feature with no choice is merely inert, and is not blocked.
 */
function ungrantedChoice(draft: Draft): BlockedReason | null {
  const table = Array.isArray(draft.levelTable) ? (draft.levelTable as Array<Record<string, unknown>>) : [];
  if (table.length === 0) return null;
  const granted = new Set<string>();
  for (const row of table) for (const id of Array.isArray(row.features) ? (row.features as string[]) : []) granted.add(id);
  for (const entry of featuresOf(draft)) {
    if (!entry?.choice || typeof entry.id !== "string" || granted.has(entry.id)) continue;
    return {
      text: `Give “${entry.name || "an unnamed feature"}” a level. It asks the player to choose, and a choice granted at no level makes the character impossible to create.`,
      sectionId: "features"
    };
  }
  return null;
}

/**
 * A slug DERIVED FROM THE RECORD'S OWN ID — `<own id>-subclasses`, `<own id>-lineages`.
 *
 * These two families, and only these two, are the ones the merged catalogs cannot answer:
 * they name the record being edited, which is a draft, and a draft is in no merged
 * catalog. The server has a carve-out for exactly this pair and answers them from
 * AUTHORSHIP — a subclass that EXISTS satisfies its class, whatever state it is in
 * (`homebrew-validate.ts`, `SelfCatalog`). The client cannot ask that question: a
 * `HomebrewRecordSummary` carries no `classId`, so there is no way here to count which
 * drafts name this class.
 *
 * So it does not guess. Re-implementing half the server's rule is how the client became
 * STRICTER than the server and disabled Publish on a record the server would have
 * accepted — duplicate SRD Fighter, and the copy's re-pointed `fighter-subclasses` read
 * as broken forever. The server's answer arrives in `doc.validity` and renders through
 * `serverBlockedReason`, in the same one sentence slot, with a better sentence than this
 * function could write. Every OTHER slug is still checked here, where the answer is local
 * and instant. (CLAUDE.md rule 2: the client is never a second rules engine.)
 *
 * The predicate itself lives in `schema.ts` beside `SchemaContext`, because
 * `FeatureEditor` has to recognise the same pair to keep its inline readout from calling
 * them broken either.
 */

/** A choice whose `fromCatalog` resolves to nothing would be silently skipped at build
    time, which is the single hardest homebrew failure to diagnose from the outside. */
function brokenCatalog(draft: Draft, ctx: SchemaContext, sectionId: string): BlockedReason | null {
  for (const entry of featuresOf(draft)) {
    const choice = entry?.choice as Record<string, unknown> | undefined;
    const slug = typeof choice?.fromCatalog === "string" ? choice.fromCatalog : "";
    if (!slug || namesOwnRecord(slug, ctx.recordId)) continue;
    const result = ctx.resolveCatalog(slug);
    if ("error" in result) {
      return {
        text: `Fix the catalog for “${entry.name || "an unnamed feature"}” — it matches nothing, so the choice would be skipped.`,
        sectionId
      };
    }
  }
  return null;
}

/**
 * The one field the PLAYER-FACING pick grid actually renders, per type.
 *
 * The gate used to demand primary abilities and saving throws — numbers the player never
 * reads off a card — and never demanded the line the card is made of, so a class could
 * publish in four field interactions and arrive in the builder as a titled card with a
 * blank body. `CharacterBuilder` builds species / background / class cards as
 * `description: entry.summary`, and a feat card as `featSummary()`, so on those four an
 * empty `summary` IS the empty card. An item's card is its `description`
 * (`ContentEquipmentSummary`); a creature's browse row (`ContentMonsterSummary`) carries
 * no prose field at all, which is why there is no entry for it here rather than an
 * invented one.
 *
 * Second in priority, right behind the name, because it is the second thing the record
 * needs to be worth picking.
 */
const SHOWN_TO_PLAYERS: Partial<Record<HomebrewType, Readonly<{ path: string; text: string }>>> = {
  class: { path: "summary", text: "Write the one-line summary — it's the whole card a player picks this class from." },
  species: { path: "summary", text: "Write the one-line summary — it's the whole card a player picks this species from." },
  background: { path: "summary", text: "Write the one-line summary — it's the whole card a player picks this background from." },
  feat: { path: "summary", text: "Write the one-line summary — it's the whole card a player picks this feat from." },
  equipment: { path: "description", text: "Describe this item — the description is what the inventory shows." }
};

export function publishBlockedReason(type: HomebrewType, draft: Draft, ctx: SchemaContext): BlockedReason | null {
  const word = typeLabel(type);
  const named = need(draft, "name", `Give this ${word} a name.`, "basics");
  if (named) return named;

  const shown = SHOWN_TO_PLAYERS[type];
  const blankCard = shown ? need(draft, shown.path, shown.text, "basics") : null;
  if (blankCard) return blankCard;

  const formula = badFormula(draft);
  const formulaBlocker: BlockedReason | null = formula
    ? { text: `Fix the damage formula “${formula}” — it isn't a dice roll the game can make.`, sectionId: "features" }
    : null;

  switch (type) {
    case "class": {
      const spellcasting = draft.spellcasting as Record<string, unknown> | null | undefined;
      const listId = typeof spellcasting?.spellListId === "string" ? spellcasting.spellListId : "";
      return first(
        need(draft, "hitDie", "Choose a hit die.", "progression"),
        need(draft, "primaryAbilities", "Pick this class's primary ability.", "progression"),
        need(draft, "savingThrows", "Pick the two saving throws this class is proficient in.", "progression"),
        need(draft, "skillChoices.from", "Pick which skills this class can choose from.", "proficiencies"),
        spellcasting && !listId
          ? { text: "Choose a spell list. A caster with no list can't be built.", sectionId: "progression" }
          : null,
        formulaBlocker,
        // Before `brokenCatalog`: a skipped choice still builds a character, an ungranted
        // one cannot be built at all.
        ungrantedChoice(draft),
        brokenCatalog(draft, ctx, "features")
      );
    }

    case "subclass":
      return first(
        need(draft, "classId", "Say which class this subclass belongs to.", "belongs-to"),
        (draft.spellcasting as Record<string, unknown> | null | undefined) && blank(getAt(draft, "spellcasting.spellListId"))
          ? { text: "Choose a spell list. A subclass caster falls back to the class list, which for a homebrew class is empty.", sectionId: "belongs-to" }
          : null,
        formulaBlocker,
        brokenCatalog(draft, ctx, "features")
      );

    case "species":
      return first(
        need(draft, "speedFeet", "Give this species a walking speed.", "body"),
        need(draft, "sizes", "Choose at least one size.", "body"),
        formulaBlocker,
        brokenCatalog(draft, ctx, "traits")
      );

    case "background":
      return first(
        need(draft, "originFeatId", "Choose the feat this background grants.", "origin"),
        formulaBlocker,
        brokenCatalog(draft, ctx, "features")
      );

    case "feat":
      return first(
        need(draft, "category", "Choose a category. Nothing offers a feat with no category.", "category"),
        // `feature`, singular: a feat IS one `FeatureRecord`. Its NAME is what the wizard
        // prints beside the pick, so an unnamed one is a blank line on the card.
        need(draft, "feature.name", "Say what this feat does.", "feature"),
        formulaBlocker,
        brokenCatalog(draft, ctx, "feature")
      );

    case "spell":
      return first(
        need(draft, "description", "Describe what this spell does.", "basics"),
        need(draft, "school", "Give this spell a school.", "casting"),
        need(draft, "castingTime", "Say how long this spell takes to cast.", "casting"),
        need(draft, "duration", "Give this spell a duration.", "casting"),
        typeof getAt(draft, "damage.roll") === "string" && !isDiceFormula(String(getAt(draft, "damage.roll")))
          ? { text: `Fix the damage formula “${getAt(draft, "damage.roll")}”.`, sectionId: "effect" }
          : null,
        !blank(getAt(draft, "damage.roll")) && blank(getAt(draft, "damage.types"))
          ? { text: "Give this spell a damage type.", sectionId: "effect" }
          : null
      );

    case "spell-list": {
      const add = Array.isArray(draft.add) ? draft.add : [];
      const basedOn = Array.isArray(draft.basedOn) ? draft.basedOn : [];
      return add.length === 0 && basedOn.length === 0
        ? { text: "Add at least one spell to this list — a class using an empty list can't be created.", sectionId: "contents" }
        : null;
    }

    case "equipment": {
      const weapon = draft.weapon as Record<string, unknown> | null | undefined;
      const casts = draft.casts as Record<string, unknown> | null | undefined;
      return first(
        need(draft, "category", "Choose a category.", "basics"),
        weapon && !blank(weapon.damageDice) && blank(weapon.damageType)
          ? { text: "Give this item a damage type.", sectionId: "weapon" }
          : null,
        weapon && typeof weapon.damageDice === "string" && weapon.damageDice.trim() !== "" && !isDiceFormula(weapon.damageDice)
          ? { text: `Fix the damage formula “${weapon.damageDice}”.`, sectionId: "weapon" }
          : null,
        draft.castsSpell === true && blank(casts?.spellId)
          ? { text: "Choose which spell this item casts.", sectionId: "magic" }
          : null,
        draft.isMagic === true && !!draft.uses && blank(getAt(draft, "uses.limit")) && blank(getAt(draft, "uses.scaling"))
          ? { text: "Say how many charges this item has, or turn charges off.", sectionId: "magic" }
          : null,
        formulaBlocker
      );
    }

    case "monster": {
      // Challenge rating lives in the `open5e.srd-2024` extension bag, which is where the
      // bestiary reads it from — not at the top level of an `ActorDefinition`.
      const statblock = (draft.extensions as Record<string, Record<string, unknown>> | undefined)?.["open5e.srd-2024"];
      return first(
        typeof statblock?.challengeRating !== "number"
          ? { text: "Give this creature a challenge rating.", sectionId: "identity" }
          : null,
        need(draft, "armorClass", "Give this creature an armour class.", "defences"),
        need(draft, "hitPoints.maximum", "Give this creature hit points.", "defences"),
        typeof getAt(draft, "hitPoints.formula") === "string" &&
        String(getAt(draft, "hitPoints.formula")).trim() !== "" &&
        !isDiceFormula(String(getAt(draft, "hitPoints.formula")))
          ? { text: `Fix the hit-point formula “${getAt(draft, "hitPoints.formula")}”.`, sectionId: "defences" }
          : null,
        formulaBlocker
      );
    }

    default:
      return null;
  }
}

/**
 * The SERVER's first validity issue, in the SAME sentence shape.
 *
 * A stored record can be invalid for a reason the client cannot know (its own schema is
 * the server's), and the raw Zod message for that is `"Required"` — a word with no
 * subject, no location and no instruction, which is exactly the shape §7 exists to
 * delete. The issue carries a machine-addressable `path`, so the label and the section
 * come from the schema and the sentence comes out the same as every other one.
 */
export function serverBlockedReason(
  type: HomebrewType,
  issue: { path: ReadonlyArray<string | number>; message: string } | undefined,
  lookup: (path: ReadonlyArray<string | number>) => Readonly<{ label: string; sectionId: string; sectionTitle: string }> | null
): BlockedReason | null {
  if (!issue) return null;
  const found = lookup(issue.path);
  if (!found) {
    // No field owns this path (a whole-record rule, an extension bag). Pass the server's
    // own sentence through — those ARE written as instructions — rather than inventing one.
    return { text: issue.message };
  }
  const required = /required/i.test(issue.message);
  // Zod messages arrive without terminal punctuation; the template supplies it exactly once.
  const detail = issue.message.replace(/[.\s]+$/, "");
  // No section name in the words — `sectionId` rides along and the jump control says it once.
  return {
    text: required
      ? `Fill in ${found.label}.`
      : `Fix ${found.label} — ${detail.charAt(0).toLowerCase()}${detail.slice(1)}.`,
    sectionId: found.sectionId
  };
}

/** "Another class is also called Frost Warden." — annotated, never blocked (rule 1).
    The name is the identity the GM sees; ids are the system's problem. */
export function duplicateNameNote(type: HomebrewType, name: string, ctx: SchemaContext): string | null {
  const trimmed = name.trim().toLowerCase();
  if (trimmed === "") return null;
  const clash = ctx.siblings.some((sibling) => sibling.id !== ctx.recordId && sibling.name.trim().toLowerCase() === trimmed);
  if (!clash) return null;
  const word = TYPE_WORDS[type]?.label ?? type;
  return `Another ${word} is also called ${name.trim()}.`;
}
