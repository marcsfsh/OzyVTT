import type { BuilderPolicy, GameState, SpellChoices } from "@vtt/domain";
import type { RandomSource } from "@vtt/rules-5e";
import { catalogIdOf, type Actor, type ActorDefinition, type CharacterChoice, type Currency } from "@vtt/schemas";
import { checkPlan } from "./ability-checks.js";
import { rebuildActorDefinition } from "./actor-roster.js";
import { GameAccessDeniedError, type Initiator } from "./authorization.js";
import { buildCharacterDefinition } from "./character-build.js";
import { rollSettledCheck } from "./check-rolls.js";
import { classSpellOptions, computeServerOffers } from "./character-offers.js";
import { withOneUsedUp } from "./consumables.js";
import type { ContentView } from "./content-library.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { buildRequestOf } from "./ledger-rechoice.js";
import { LONG_REST_PREPARATION } from "./spellcasting.js";
import { withArticle } from "@vtt/domain";

/**
 * Changing what a prepared caster can prepare (SRD Spell Preparation by Class). After a Long Rest a Cleric, Druid,
 * Paladin or Ranger replaces a spell on its list with another of its class's spells for which it has slots, and a
 * Wizard with another spell from its spellbook. The sheet lists the spells the build chose, so a replacement re-makes
 * that spell's row in the choices ledger and the sheet is rebuilt from it, as a re-chosen land is. A Wizard's
 * spellbook holds six spells at level 1 and two more for each Wizard level after; the build lists only the prepared
 * ones, so the rest are recorded on the actor (`Actor.spellbook`), as are spells copied in: 2 hours and 50 GP for each
 * level, and from a Spell Scroll an Intelligence (Arcana) check (DC 10 + the spell's level) that destroys the scroll
 * either way.
 */

export type SpellChoiceDeps = Readonly<{ library: ContentView; policy: BuilderPolicy; catalog?: EquipmentCatalog }>;

const WIZARD = "wizard";
/** SRD Wizard: "It starts with six level 1 Wizard spells", and "Whenever you gain a Wizard level after 1, add two". */
const BOOK_AT_FIRST_LEVEL = 6;
export const BOOK_PER_LEVEL = 2;
/** SRD "Copying a Spell into the Book": for each level of the spell. */
const COPY_HOURS_PER_LEVEL = 2;
const COPY_GP_PER_LEVEL = 50;

/** A class's own spell rows in the ledger: a "spell" pick no feature made. */
const isClassSpellRow = (row: CharacterChoice) => row.kind === "spell" && typeof row.payload?.featureId !== "string";

/** The spells in a Wizard's spellbook: the Wizard spells on its sheet, and those recorded beyond it. */
function bookOf(actor: Pick<Actor, "spellbook">, definition: ActorDefinition): Set<string> {
  return new Set([
    ...(definition.spellcasting?.spells ?? [])
      .filter((spell) => spell.classId === WIZARD && spell.level > 0)
      .map((spell) => spell.id),
    ...actor.spellbook.map((entry) => entry.id)
  ]);
}

/**
 * What this character may change about the spells it prepares: for each class that changes its list after a Long
 * Rest, the spells it may swap in (not already on the sheet), and a Wizard's spellbook. Null for a sheet that doesn't
 * record how it was built (an import), which can't be rebuilt here.
 */
export function spellChoicesOf(
  actor: Pick<Actor, "spellbook">,
  definition: ActorDefinition | undefined,
  library: ContentView,
  policy: BuilderPolicy
): SpellChoices | null {
  if (!definition?.spellcasting || (definition.character?.choices ?? []).length === 0) return null;
  const request = buildRequestOf(definition, library);
  if (!request) return null;
  let survey: ReturnType<typeof computeServerOffers>;
  try {
    survey = computeServerOffers(request, library, policy);
  } catch {
    return null;
  }
  const onSheet = new Set(definition.spellcasting.spells.map((spell) => spell.id));
  const swappable = new Set(
    definition.spellcasting.spells.filter((spell) => spell.level > 0 && !spell.alwaysPrepared).map((spell) => spell.id)
  );
  const book = bookOf(actor, definition);
  const levelOf = (id: string) => library.spellRecord(id)?.level ?? 0;
  let spellbook: SpellChoices["spellbook"] = null;
  const swaps = survey.classSpells.flatMap((budget) => {
    const options = classSpellOptions(budget, survey.catalogs).options.filter(
      (option) => (option.level ?? 0) >= 1 && (option.level ?? 0) <= budget.maxSlotLevel
    );
    if (budget.classId === WIZARD) {
      const wizardLevel = definition.character?.classes.find((entry) => entry.id === WIZARD)?.level ?? 1;
      const fromLevels = (definition.character?.choices ?? []).filter(
        (row) => isClassSpellRow(row) && (row.classId ?? request.classId) === WIZARD
      ).length;
      // A spell the sheet lists again after a rebuild counts once.
      const free = actor.spellbook.filter((entry) => !entry.copied && !onSheet.has(entry.id)).length;
      spellbook = {
        spellIds: [...book].sort((left, right) => levelOf(left) - levelOf(right) || left.localeCompare(right)),
        freeLeft: Math.max(0, BOOK_AT_FIRST_LEVEL + BOOK_PER_LEVEL * (wizardLevel - 1) - fromLevels - free),
        maxLevel: budget.maxSlotLevel,
        addable: options.filter((option) => !book.has(option.id)).map((option) => option.id)
      };
    }
    if (!(budget.classId in LONG_REST_PREPARATION)) return [];
    return [
      {
        classId: budget.classId,
        className: budget.className,
        replaces: budget.spellRows.map((row) => row.id).filter((id) => swappable.has(id)),
        spellIds: options
          .filter((option) => !onSheet.has(option.id) && (budget.classId !== WIZARD || book.has(option.id)))
          .map((option) => option.id)
      }
    ];
  });
  return { swaps, spellbook };
}

function characterOf(state: GameState, actorId: string): { actor: Actor; definition: ActorDefinition } {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  const definition = state.definitions.find((entry) => entry.id === actor.definitionId)?.definition;
  if (!definition) throw new CommandRejectedError(`${actor.name} has no sheet to change.`);
  return { actor, definition };
}

const inFight = (state: GameState, actorId: string) =>
  state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId);

/**
 * Puts `spellId` on the prepared list in place of `replaces`, one of the spells the character's class chose, and
 * rebuilds the sheet. A player does it in the prepare step a Long Rest opens (a Paladin or Ranger once), the GM any
 * time outside a fight. A Wizard's replaced spell stays in the spellbook.
 */
export function swapClassSpell(
  state: GameState,
  actorId: string,
  spellId: string,
  replaces: string,
  role: "gm" | "player",
  deps: SpellChoiceDeps
): Readonly<{ added: string; removed: string }> {
  const { actor, definition } = characterOf(state, actorId);
  if (inFight(state, actorId))
    throw new CommandRejectedError("Prepared spells change after a Long Rest, not in a fight.");
  if (role === "player") {
    if (actor.preparation === null)
      throw new CommandRejectedError("You change your prepared spells when you finish a Long Rest.");
    if (actor.preparation.changesLeft === 0)
      throw new CommandRejectedError("You've changed as many prepared spells as this Long Rest allows.");
  }
  const choices = definition.character?.choices ?? [];
  const request = buildRequestOf(definition, deps.library);
  if (!request)
    throw new CommandRejectedError(
      `${actor.name}'s sheet doesn't record how it was built, so its spells change in the Level flow.`
    );
  const out = definition.spellcasting?.spells.find((spell) => spell.id === replaces);
  const index = choices.findIndex((row) => isClassSpellRow(row) && row.id === replaces);
  if (!out || index < 0 || out.alwaysPrepared || out.level === 0)
    throw new CommandRejectedError(
      `${out?.name ?? "That spell"} isn't one of the spells ${actor.name}'s class prepares, so nothing can replace it.`
    );
  const classId = out.classId ?? choices[index].classId ?? request.classId;
  const record = deps.library.spellRecord(spellId);
  if (!record) throw new CommandRejectedError("That spell is not in the content catalog.");
  const offered = spellChoicesOf(actor, definition, deps.library, deps.policy)?.swaps.find(
    (entry) => entry.classId === classId
  );
  if (!offered)
    throw new CommandRejectedError(`${actor.name}'s ${classId} spells change on gaining a level, in the Level flow.`);
  if (!offered.spellIds.includes(spellId)) {
    const why = definition.spellcasting?.spells.some((spell) => spell.id === spellId)
      ? `${record.name} is already on ${actor.name}'s sheet.`
      : classId === WIZARD
        ? `${record.name} isn't in ${actor.name}'s spellbook - copy it in first.`
        : `${record.name} isn't ${withArticle(offered.className)} spell ${actor.name} has slots for.`;
    throw new CommandRejectedError(why);
  }
  const rechosen = choices.map((row, at) => (at === index ? { ...row, id: spellId } : row));
  const rebuilt = buildCharacterDefinition({ ...request, choices: rechosen }, deps.library, deps.policy);
  rebuildActorDefinition(state, actorId, rebuilt, deps.catalog);
  // The book keeps both: the spell swapped out takes the place the one swapped in had beyond the sheet.
  if (classId === WIZARD)
    actor.spellbook = actor.spellbook.map((entry) => (entry.id === spellId ? { ...entry, id: replaces } : entry));
  if (role === "player" && actor.preparation?.changesLeft != null)
    actor.preparation = { changesLeft: actor.preparation.changesLeft - 1 };
  return { added: record.name, removed: out.name };
}

/** The purse after paying `gp`: gold first, then platinum, electrum, silver and copper, change given back in gold,
 *  silver and copper. Null when the purse holds less. */
export function paid(purse: Currency, gp: number): Currency | null {
  const values = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 } as const;
  const worth = (Object.keys(values) as Array<keyof typeof values>).reduce(
    (sum, coin) => sum + purse[coin] * values[coin],
    0
  );
  let owed = gp * 100;
  if (worth < owed) return null;
  const left = { ...purse };
  for (const coin of ["gp", "pp", "ep", "sp", "cp"] as const) {
    if (owed <= 0) break;
    const used = Math.min(left[coin], Math.ceil(owed / values[coin]));
    left[coin] -= used;
    owed -= used * values[coin];
  }
  let change = -owed;
  for (const coin of ["gp", "sp", "cp"] as const) {
    left[coin] += Math.floor(change / values[coin]);
    change %= values[coin];
  }
  return left;
}

/** What a copy into the spellbook takes. */
export const copyCostOf = (level: number) => ({
  hours: COPY_HOURS_PER_LEVEL * level,
  gp: COPY_GP_PER_LEVEL * level
});

export type SpellbookSource = "level" | "scroll" | "book";

/**
 * Adds a Wizard spell to the spellbook: one of the picks the Wizard's levels give, free; or a copy, from a Spell Scroll
 * the character carries or from another spellbook (the GM's to say what that book holds), for 2 hours and 50 GP a
 * level. A scroll's copy needs the Arcana check, and the scroll is gone whether it succeeds or fails. Returns the
 * table's line. Never mid-fight: a copy takes hours.
 */
export function addToSpellbook(
  state: GameState,
  actorId: string,
  input: Readonly<{ spellId: string; from: SpellbookSource; itemId?: string }>,
  initiator: Initiator,
  deps: SpellChoiceDeps &
    Readonly<{
      random: RandomSource;
      /** The record the scroll's check is kept under. */
      roll: Readonly<{ id: string; commandId: string; sessionId: string; createdAt: string }>;
    }>
): string {
  const { actor, definition } = characterOf(state, actorId);
  const book = spellChoicesOf(actor, definition, deps.library, deps.policy)?.spellbook;
  if (!book) throw new CommandRejectedError(`${actor.name} has no spellbook to add to.`);
  if (inFight(state, actorId))
    throw new CommandRejectedError("Adding a spell to a spellbook takes hours - finish the fight first.");
  const spell = deps.library.spellRecord(input.spellId);
  if (!spell) throw new CommandRejectedError("That spell is not in the content catalog.");
  if (book.spellIds.includes(spell.id))
    throw new CommandRejectedError(`${spell.name} is already in ${actor.name}'s spellbook.`);
  if (!book.addable.includes(spell.id))
    throw new CommandRejectedError(
      spell.level > book.maxLevel
        ? `${actor.name} can't prepare level ${spell.level} spells yet, so ${spell.name} can't go in the spellbook.`
        : `${spell.name} isn't a Wizard spell of level 1 or higher.`
    );
  if (input.from === "level") {
    if (book.freeLeft === 0)
      throw new CommandRejectedError(
        `${actor.name}'s spellbook already holds the spells the Wizard's levels give - copy others in.`
      );
    actor.spellbook = [...actor.spellbook, { id: spell.id }];
    return `${actor.name} adds ${spell.name} to the spellbook.`;
  }
  if (input.from === "book" && initiator.role !== "gm")
    throw new GameAccessDeniedError("The GM copies a spell from another spellbook, since the GM knows what it holds.");
  const scroll =
    input.from === "scroll"
      ? actor.inventory.find(
          (row) =>
            row.id === input.itemId &&
            row.spellId === spell.id &&
            row.quantity > 0 &&
            deps.catalog?.equipmentRecord(catalogIdOf(row))?.spellScroll !== undefined
        )
      : undefined;
  if (input.from === "scroll" && !scroll)
    throw new CommandRejectedError(`${actor.name} carries no Spell Scroll of ${spell.name}.`);
  const cost = copyCostOf(spell.level);
  const purse = paid(actor.currency, cost.gp);
  if (!purse)
    throw new CommandRejectedError(`Copying ${spell.name} costs ${cost.gp} GP, more than ${actor.name}'s purse holds.`);
  actor.currency = purse;
  const spent = `${cost.hours} hours and ${cost.gp} GP`;
  if (!scroll) {
    actor.spellbook = [...actor.spellbook, { id: spell.id, copied: true }];
    return `${actor.name} copies ${spell.name} into the spellbook (${spent}).`;
  }
  const dc = 10 + spell.level;
  const plan = checkPlan(actor, definition, deriveEquipment(actor, definition, deps.catalog), {
    ability: "int",
    skill: "arcana"
  });
  const rolled = rollSettledCheck(
    state,
    actor,
    plan,
    {
      ...deps.roll,
      role: initiator.role,
      label: `Intelligence (Arcana) check to copy ${spell.name}`,
      visibility: actor.visibility === "gm-only" ? "gm-only" : "public"
    },
    deps.random
  );
  actor.inventory = withOneUsedUp(actor.inventory, scroll.id);
  if (rolled.total < dc)
    return `${actor.name} fails to copy ${spell.name} (Arcana ${rolled.total} against DC ${dc}), and the scroll is destroyed. The ${spent} are spent.`;
  actor.spellbook = [...actor.spellbook, { id: spell.id, copied: true }];
  return `${actor.name} copies ${spell.name} from the scroll into the spellbook (${spent}), and the scroll is destroyed.`;
}
