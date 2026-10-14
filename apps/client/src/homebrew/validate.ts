/**
 * Why publishing is blocked — **every outstanding requirement, each as an instruction.**
 *
 * ## Drafts still show no errors at all
 *
 * This is the whole reason this file exists instead of a `required` asterisk. A draft is
 * GM-only and is *allowed* to be invalid — that is what the state is for. So while
 * drafting there is no asterisk, no red border and no per-field message. The requirements
 * surface in exactly one place: beneath the button they block.
 *
 * That is a different thing from `FieldDef.validate`, which DOES fire inline: a
 * malformed dice formula is the field being wrong *now*, not a requirement not yet met.
 * Keeping the two apart is what makes "drafts may be invalid, publish requires validity"
 * legible instead of a red-asterisk hunt.
 *
 * ## What changed: a list, and it is the SERVER'S list
 *
 * This used to return the FIRST unmet requirement, from a hand-written subset of what the
 * server actually demands. Both halves were wrong, and together they are the whole of the
 * "homebrew items cannot be published" report:
 *
 *  - **The subset.** The checks here were a DESCRIPTION of nine server schemas, maintained by
 *    memory. For equipment it was looser than the schema, so Publish enabled on a body the store
 *    refused. The GM met the refusal as a 409 whose first Zod issue rendered "Fill in range." — on
 *    a mace. `publishIssues` now runs `HOMEBREW_BODY_SCHEMAS`, the very map the publish gate's
 *    tier 1 and the store's read-back parse use. Drift is not policed; it is impossible.
 *  - **The one sentence.** Fixing "Fill in range." earned "Fill in long range.", which earned
 *    another — a serial dead-end with no way to see how deep it went. Everything outstanding is
 *    listed at once, so "three things left" is a fact on screen rather than a discovery.
 *
 * This is NOT the client becoming a second rules engine (the sin documented at length below, and
 * the reason `brokenCatalog` refuses to answer questions it cannot). Running one shared parser
 * decides nothing: the server re-runs it, authoritatively, and its answer still wins.
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
 * The five sentence shapes the readiness pass deleted at source do not come back.
 */

import { featurePicks, HOMEBREW_BODY_SCHEMAS } from "@vtt/content-srd-5.2.1/schemas";
import { forStorage } from "./defaults";
import { getAt } from "./paths";
// One vocabulary, one place it is spelled: the gating list's kinds come from the form
// that offers them, so a condition added there is checked here without a second table.
import { modifierLabel, triggerKindOf } from "./RiderEditor";
import { isDiceFormula, namesOwnRecord, type Draft, type SchemaContext } from "./schema";
import { fieldAt } from "./schemas";
import { TYPE_WORDS, typeLabel, type HomebrewType } from "./types";

export type BlockedReason = Readonly<{
  text: string;
  sectionId?: string;
  /**
   * The dotted path this requirement is about, when it has one. Used for ONE thing: keeping the
   * hand-written sentence and the schema's own issue about the same field from both appearing.
   * The hand-written one always wins — "Pick this class's primary ability." beats "Fill in primary
   * abilities.", and the schema is there to catch what nobody wrote a sentence for.
   */
  path?: string;
}>;

const blank = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

const need = (draft: Draft, path: string, text: string, sectionId: string): BlockedReason | null =>
  blank(getAt(draft, path)) ? { text, sectionId, path } : null;

/** Every non-null check, in declaration order. Order IS the priority: name before anything, then
    the fields without which the record cannot be built at all — so the head of the list is the
    sentence this function used to return on its own, and the tail is what it used to hide. */
const all = (...checks: ReadonlyArray<BlockedReason | null>): readonly BlockedReason[] =>
  checks.filter((check): check is BlockedReason => check !== null);

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

/**
 * The two structural rules a rider's gating list has to keep, checked wherever a modifier
 * lives — an item, a class feature, a species trait, a feat — because the vocabulary is
 * one vocabulary and both carriers author into it.
 *
 *   1. **One moment per rider.** A rider fires at one moment, not two. Two *Only when…*
 *      lines describe two different riders and the engine would have to pick.
 *   2. **A filter needs a moment.** An *Only for…* line with no *Only when…* is an
 *      authoring mistake rather than "always" — it means the GM narrowed a rider that
 *      never sees a target, so it would quietly never match.
 *
 * Blockers rather than inline errors, for the reason this whole file exists: a draft is
 * allowed to be invalid, and the sentence surfaces once, at the button it blocks. Neither
 * rule could be a field-level `validate` in any case — both are about a row's SIBLINGS,
 * and `validate` is handed the row.
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
        found = { text: `Leave “${name}” one “Only when…” line — a modifier fires at one moment, not two.`, sectionId };
        return;
      }
      if (kinds.includes("filter") && !kinds.includes("moment")) {
        found = { text: `Add an “Only when…” line to “${name}” — an “Only for…” line has nothing to narrow on its own.`, sectionId };
        return;
      }
    }
    for (const nested of Object.values(record)) walk(nested);
  };
  walk(draft);
  return found;
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
    if (draftPicksOf(entry).length === 0 || typeof entry.id !== "string" || granted.has(entry.id)) continue;
    return {
      text: `Give “${entry.name || "an unnamed feature"}” a level. It asks the player to choose, and a choice granted at no level makes the character impossible to create.`,
      sectionId: "features"
    };
  }
  return null;
}

/** Every pick a draft feature asks for, whichever spelling holds it — `featurePicks`, the
    server's own accessor, so this file and `character-build.ts` read the pair identically. */
const draftPicksOf = (entry: Record<string, unknown> | undefined): ReadonlyArray<Record<string, unknown>> =>
  entry ? featurePicks(entry as { choice?: Record<string, unknown>; choices?: Record<string, unknown>[] }) : [];

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
    // EVERY pick, not just the first: a plural feature's second block can name a broken
    // catalog as easily as a singular's one block can.
    for (const choice of draftPicksOf(entry)) {
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
/**
 * A weapon's card is "1d8 slashing" and a shield's is "+2 AC" — both drawn from the typed
 * block, not from prose. So an item with one of those does NOT have a blank card and must
 * not be held back for a description it never printed.
 *
 * This is the item half of a mistake this file has already made once and documents at
 * length above: **the client became stricter than the server.** `EquipmentReferenceSchema`
 * declares `description` `.nullable()`, and every one of the ~50 SRD weapons and ~13
 * armour pieces carries `description: null` — `loadEquipment` maps them in from the weapon
 * and armour bundles, which have no prose field at all. So "duplicate Longsword", the
 * route the create modal itself offers as an equal starting point, landed on a record
 * whose Publish was disabled before the GM had touched anything, for a requirement the
 * store does not have. Exactly the shape of the class-duplicate defect, one type over.
 *
 * The MECHANICS clause below is the same rule reaching one step further, and it was found
 * by driving the product rather than by reading it: a Ring of Protection whose entire point
 * is `+1 armour class` was refused until the GM restated that mechanic in English. Its card
 * is not blank — it says "+1 armour class" — and demanding prose that duplicates a field on
 * the same screen is exactly the clerical work this editor exists to remove. Worse, the two
 * can then disagree, and the prose is the half nothing enforces.
 *
 * The requirement survives where it is real: an item with no weapon, no armour and no
 * mechanics IS a blank card, and every piece of SRD gear already has prose.
 */
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

const SHOWN_TO_PLAYERS: Partial<Record<HomebrewType, Readonly<{ path: string; text: string; unless?: (draft: Draft) => boolean }>>> = {
  class: { path: "summary", text: "Write the one-line summary — it's the whole card a player picks this class from." },
  species: { path: "summary", text: "Write the one-line summary — it's the whole card a player picks this species from." },
  background: { path: "summary", text: "Write the one-line summary — it's the whole card a player picks this background from." },
  feat: { path: "summary", text: "Write the one-line summary — it's the whole card a player picks this feat from." },
  equipment: {
    path: "description",
    text: "Describe this item — with no weapon or armour numbers, the description is the whole card the inventory shows.",
    unless: hasDerivedCard
  }
};

/**
 * The requirements this side can state BETTER than the schema can, in priority order.
 *
 * Everything here either (a) has copy a Zod message could never produce ("it's the whole card a
 * player picks this class from"), or (b) is a rule no schema expresses — a rider gated on a filter
 * with no moment, a choice granted at no level, a `fromCatalog` slug that resolves to nothing.
 * Anything that is merely "the schema requires this key" belongs to `schemaIssues` and must NOT be
 * restated here: two sentences about one field is the duplication the `path` dedupe exists to stop.
 */
function localIssues(type: HomebrewType, draft: Draft, ctx: SchemaContext): readonly BlockedReason[] {
  const word = typeLabel(type);
  const named = need(draft, "name", `Give this ${word} a name.`, "basics");
  // The name is the record's identity everywhere — the rail, the pickers, the checklist's own
  // sentences — so a nameless record gets one instruction and nothing else. Every other message
  // would be noise beside "this thing has no name yet".
  if (named) return [named];

  const shown = SHOWN_TO_PLAYERS[type];
  const blankCard = shown && !shown.unless?.(draft) ? need(draft, shown.path, shown.text, "basics") : null;

  const formula = badFormula(draft);
  const formulaBlocker: BlockedReason | null = formula
    ? { text: `Fix the damage formula “${formula}” — it isn't a dice roll the game can make.`, sectionId: "features" }
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
        // Before `brokenCatalog`: a skipped choice still builds a character, an ungranted
        // one cannot be built at all.
        ungrantedChoice(draft),
        brokenCatalog(draft, ctx, "features"),
        badGating(draft, "features")
      );
    }

    case "subclass":
      return all(
        blankCard,
        // NOT "…belongs to", which is the section's own title: the sentence printed
        // "Say which class this subclass belongs to." and the jump control rendered
        // "Belongs to ›" immediately beside it, so the last two words were said twice.
        // Every other type was corrected in the readiness pass; this one was missed. The
        // sentence says the thing, the section is a control — and the way to keep that
        // true is never to end an imperative on the words its section is named after.
        need(draft, "classId", "Choose the class this subclass is for.", "belongs-to"),
        (draft.spellcasting as Record<string, unknown> | null | undefined) && blank(getAt(draft, "spellcasting.spellListId"))
          ? { text: "Choose a spell list. A subclass caster falls back to the class list, which for a homebrew class is empty.", sectionId: "belongs-to" }
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
        // Same rule, same trap: the section IS titled "Category", so the sentence must
        // not be "Choose a category." followed by a control reading Category.
        need(draft, "category", "Say what kind of feat this is. Nothing offers one without it.", "category"),
        // `feature`, singular: a feat IS one `FeatureRecord`. Its NAME is what the wizard
        // prints beside the pick, so an unnamed one is a blank line on the card.
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
          ? { text: `Fix the damage formula “${getAt(draft, "damage.roll")}”.`, sectionId: "effect" }
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
          ? { text: "Add at least one spell to this list — a class using an empty list can't be created.", sectionId: "contents" }
          : null
      );
    }

    case "equipment": {
      const weapon = draft.weapon as Record<string, unknown> | null | undefined;
      const casts = Array.isArray(draft.casts) ? (draft.casts as Array<Record<string, unknown>>) : [];
      return all(
        blankCard,
        need(draft, "category", "Give this item a category.", "basics"),
        // The weapon block is all-or-nothing on the server (five required keys) and the editor now
        // seeds all five the moment one is touched — so the only half-authored weapon left is one
        // with no dice, and that is a real hole rather than a schema artefact: `weaponAction` reads
        // `damageDice` and an empty one is an attack that rolls nothing.
        weapon && blank(weapon.damageDice)
          ? { text: "Give this weapon its damage, or clear the whole Weapon section — a weapon with no dice rolls nothing.", sectionId: "weapon", path: "weapon.damageDice" }
          : null,
        weapon && !blank(weapon.damageDice) && blank(weapon.damageType)
          ? { text: "Give this item a damage type.", sectionId: "weapon", path: "weapon.damageType" }
          : null,
        weapon && typeof weapon.damageDice === "string" && weapon.damageDice.trim() !== "" && !isDiceFormula(weapon.damageDice)
          ? { text: `Fix the damage formula “${weapon.damageDice}”.`, sectionId: "weapon" }
          : null,
        casts.some((cast) => blank(cast.spellId))
          ? { text: "Choose which spell this item casts, or take the empty row off.", sectionId: "magic" }
          : null,
        // C9's template pair is both-or-neither: a label with no bases is a choice with no options,
        // and bases with no label is a chooser with no sentence to show. The schema requires both
        // inside the object, so catching it here is what keeps the server's refusal from being the
        // GM's first hint.
        !blank(getAt(draft, "appliesTo.label")) && blank(getAt(draft, "appliesTo.baseIds"))
          ? { text: "List the bases this item can be, or clear its “applies to” line.", sectionId: "magic", path: "appliesTo.baseIds" }
          : null,
        blank(getAt(draft, "appliesTo.label")) && !blank(getAt(draft, "appliesTo.baseIds"))
          ? { text: "Give the “applies to” choice its printed wording, or clear the base list.", sectionId: "magic", path: "appliesTo.label" }
          : null,
        // `cursed` without attunement is a curse you take off by taking the hat off —
        // and attunement is both what springs it and the boundary the hiding rule needs.
        draft.cursed === true && getAt(draft, "attunement.required") !== true
          ? { text: "Make this item require attunement — attuning is what springs a curse and what reveals it.", sectionId: "magic" }
          : null,
        draft.isMagic === true && !!draft.uses && blank(getAt(draft, "uses.limit")) && blank(getAt(draft, "uses.scaling"))
          ? { text: "Say how many charges this item has, or turn charges off.", sectionId: "magic" }
          : null,
        formulaBlocker,
        badGating(draft, "magic")
      );
    }

    case "monster": {
      // Challenge rating lives in the `open5e.srd-2024` extension bag, which is where the
      // bestiary reads it from — not at the top level of an `ActorDefinition`.
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
          ? { text: `Fix the hit-point formula “${getAt(draft, "hitPoints.formula")}”.`, sectionId: "defences" }
          : null,
        formulaBlocker
      );
    }

    default:
      return all(blankCard);
  }
}

/**
 * ONE validity issue — the server's, or the shared schema's — in the SAME sentence shape.
 *
 * The raw Zod message is `"Required"`: a word with no subject, no location and no instruction,
 * which is exactly the shape this file exists to delete. Every issue carries a machine-addressable
 * `path`, so the label and the section come from the form schema and the sentence comes out like
 * every other one.
 */
export function issueReason(
  type: HomebrewType,
  issue: { path: ReadonlyArray<string | number>; message: string } | undefined,
  lookup: (path: ReadonlyArray<string | number>) => Readonly<{ label: string; sectionId: string; sectionTitle: string }> | null = (path) => fieldAt(type, path)
): BlockedReason | null {
  if (!issue) return null;
  const dotted = issue.path.filter((segment) => typeof segment === "string").join(".");
  const found = lookup(issue.path);
  if (!found) {
    // No field owns this path (a whole-record rule, an extension bag). Pass the message through —
    // those ARE written as instructions — rather than inventing one.
    return { text: issue.message, path: dotted || undefined };
  }
  const required = /required/i.test(issue.message);
  // Zod messages arrive without terminal punctuation; the template supplies it exactly once.
  const detail = issue.message.replace(/[.\s]+$/, "");
  // No section name in the words — `sectionId` rides along and the jump control says it once.
  return {
    text: required
      ? `Fill in ${found.label}.`
      : `Fix ${found.label} — ${detail.charAt(0).toLowerCase()}${detail.slice(1)}.`,
    sectionId: found.sectionId,
    path: dotted || undefined
  };
}

/** Kept as the head of `publishIssues`: the caller that wants one sentence still gets the same
    one, chosen by the same priority order, without knowing a list exists. */
export function publishBlockedReason(type: HomebrewType, draft: Draft, ctx: SchemaContext, recordId = ctx.recordId): BlockedReason | null {
  return publishIssues(type, draft, ctx, recordId)[0] ?? null;
}

/**
 * The BODY the store would hold, built from the draft exactly as the save path builds it.
 *
 * Three transformations, and each one matters to the answer: `forStorage` drops the `rowId` keys
 * `RowEditor` mints (the rider unions are `.strict()`, so one would fail the whole record); the
 * record's `id` is forced to the row key, which is what `normalizeBody` does server-side and what
 * every id-shaped schema check reads; and a creature's `source.externalId` is forced to the same
 * id, because that is the identity the bestiary and `Actor.definitionId` key on.
 *
 * Get this wrong and the checklist answers about a body that never existed — which is worse than
 * the subset it replaces, because it would be confidently wrong.
 */
export function bodyForPublish(type: HomebrewType, draft: Draft, recordId: string): Record<string, unknown> {
  const body: Record<string, unknown> = { ...forStorage(draft), id: recordId };
  // The row owns the type; a `type` key inside an equipment body is an unrecognised key to a
  // `.strict()` schema, which is why the store strips it on the way in.
  delete body.type;
  if (type === "monster") {
    const source = body.source && typeof body.source === "object" && !Array.isArray(body.source) ? (body.source as Record<string, unknown>) : {};
    body.source = { ...source, externalId: recordId };
  }
  return body;
}

/**
 * **What the record's OWN schema says — the same schema the server's publish gate runs.**
 *
 * `HOMEBREW_BODY_SCHEMAS` is the map `homebrew-validate.ts` uses for tier 1 and `homebrew-store.ts`
 * uses to read a body back. Running it here is what makes the button and the store agree by
 * construction rather than by maintenance, and it is the fix for the reported defect: a homebrew
 * item whose weapon block was half-written enabled Publish and then took a 409.
 *
 * A blank record is UNNAMED and therefore short-circuits before this runs, so the GM never meets
 * twenty schema issues for a record they just created.
 */
function schemaIssues(type: HomebrewType, draft: Draft, recordId: string): readonly BlockedReason[] {
  const schema = HOMEBREW_BODY_SCHEMAS[type];
  if (!schema) return [];
  const parsed = schema.safeParse(bodyForPublish(type, draft, recordId)) as {
    success: boolean;
    error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
  };
  if (parsed.success) return [];
  const out: BlockedReason[] = [];
  for (const issue of parsed.error?.issues ?? []) {
    const path = issue.path.map((key) => (typeof key === "number" ? key : String(key)));
    // `id` is forced by the store, never authored, so an id complaint is about the record's
    // identity rather than about anything on screen — `homebrewIdProblem` (server tier 2) says it
    // far better, and it is the one that reaches the GM.
    if (path[0] === "id") continue;
    const reason = issueReason(type, { path, message: issue.message });
    if (reason) out.push(reason);
  }
  return out;
}

/** A schema issue about a field a hand-written sentence already covers is dropped: the sentence is
    always the better one, and two lines about `weapon.damageType` reads as two problems. */
const coveredBy = (owned: ReadonlySet<string>, path: string | undefined): boolean =>
  path !== undefined && [...owned].some((prefix) => path === prefix || path.startsWith(`${prefix}.`));

/**
 * EVERYTHING outstanding, in priority order: the sentences this side writes better, then whatever
 * the record's own schema still refuses.
 *
 * `RecordDetail` renders the lot. That is D19's "full checklist" and the end of the serial
 * dead-end — a GM fixing one line can see how many are left, which is the difference between
 * finishing and giving up.
 */
export function publishIssues(type: HomebrewType, draft: Draft, ctx: SchemaContext, recordId = ctx.recordId): readonly BlockedReason[] {
  const local = localIssues(type, draft, ctx);
  // An unnamed record says one thing and nothing else; running the schema over it would bury that.
  if (local.length === 1 && local[0].path === "name") return local;
  const owned = new Set(local.map((reason) => reason.path).filter((path): path is string => !!path));
  return [...local, ...schemaIssues(type, draft, recordId).filter((issue) => !coveredBy(owned, issue.path))];
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
