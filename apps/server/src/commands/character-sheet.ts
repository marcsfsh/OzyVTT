import { randomUUID } from "node:crypto";
import type { GameState } from "@vtt/domain";
import { catalogIdOf, type InventoryItem } from "@vtt/schemas";
import { requireActorAccess } from "../authorization.js";
import { claimCharacter, forceReleaseCharacter, releaseCharactersForSession } from "../character-claims.js";
import { setCharacterIdentity, setCharacterProficiencies } from "../character-edit.js";
import {
  ActorRemoveSchema,
  CharacterForceReleaseSchema,
  CharacterGiveItemSchema,
  CharacterRecoverAmmunitionSchema,
  CharacterSetCurrencySchema,
  CharacterSetFavouritesSchema,
  CharacterSetIdentitySchema,
  CharacterSetInventorySchema,
  CharacterFinishPreparingSchema,
  CharacterSwapSpellSchema,
  CharacterAddToSpellbookSchema,
  CharacterSetPreparedSchema,
  CharacterSetProficienciesSchema,
  CharacterSetSlotSchema,
  CommandIdentitySchema
} from "@vtt/domain/commands";
import { recoverAmmunition } from "../ammunition.js";
import type { EffectNarration } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { giveItem, setCurrency, setInventoryItem } from "../inventory.js";
import { setFavourites } from "../option-uses.js";
import { finishPreparing, setPreparedSpell, setSpellSlotRemaining } from "../spellcasting.js";
import { addToSpellbook, swapClassSpell } from "../spell-choices.js";
import { initiatorOf, isGmGrade, sessionIdOf, type GamePrincipal, type Kit } from "./kit.js";
import { defineCommand } from "./pipeline.js";

/** A player adds only an item their catalog has, when the row names a catalog record at all: a record the GM hid or
 *  shared with another character is refused as one that does not exist. A row already carried keeps what it is. */
function requireReceivedItem(
  kit: Kit,
  principal: GamePrincipal,
  state: GameState,
  actorId: string,
  item: InventoryItem
) {
  if (isGmGrade(principal) || item.quantity <= 0) return;
  const carried = state.actors.find((actor) => actor.id === actorId)?.inventory.some((entry) => entry.id === item.id);
  if (carried) return;
  const recordId = catalogIdOf(item);
  if (kit.playCatalog().equipmentRecord(recordId) && !kit.catalogFor(principal).equipmentRecord(recordId))
    throw new CommandRejectedError("That item is not in the content catalog.");
}

/** A player takes only a spell their catalog has: one shown to everyone or to one of their characters. The refusal
 *  reads as for a spell that does not exist, so it says nothing about a hidden one. */
function requireReceivedSpell(kit: Kit, principal: GamePrincipal, spellId: string) {
  if (!isGmGrade(principal) && !kit.catalogFor(principal).spellRecord(spellId))
    throw new CommandRejectedError("That spell is not in the content catalog.");
}

// Claims, and the edits a player may make to their own character's sheet.

export const characterSheetCommands = [
  defineCommand({
    type: "character.claim",
    operationId: "claimCharacter",
    description:
      "Claims an unclaimed player character for the calling session. Player sessions only: GM sessions and integration credentials are refused (an integration wanting a seat at the table should hold a player session from POST /sessions/player).",
    summary: "Claim an unclaimed player character for the calling player session.",
    schema: ActorRemoveSchema,
    malformed: "The claim command is malformed.",
    // Claims bind a character to a player session; GM sessions and integrations are refused.
    playerOnly: "GM sessions do not claim player characters.",
    async run({ principal, request, execute }) {
      await execute((state) => claimCharacter(state, request.actorId, sessionIdOf(principal)));
    }
  }),

  defineCommand({
    type: "character.release",
    operationId: "releaseCharacters",
    description: "Releases every character claimed by the calling player session.",
    summary: "Release every character claimed by the calling player session.",
    schema: CommandIdentitySchema,
    malformed: "The release command is malformed.",
    // Only a player session has claims to release.
    playerOnly: "Join a session first.",
    async run({ principal, execute }) {
      await execute((state) => releaseCharactersForSession(state, sessionIdOf(principal)));
    }
  }),

  defineCommand({
    type: "character.force-release",
    operationId: "forceReleaseCharacter",
    description:
      "Force-releases a claimed character (GM-grade only): the recovery path for a lost player device. A character in the running fight is refused with code `in_fight` (409) unless the request carries `inFight: true`. The player who held it is told on their own devices.",
    summary: "Force-release a claimed character (GM).",
    schema: CharacterForceReleaseSchema,
    malformed: "The force-release command is malformed.",
    gmOnly: "Only the GM can force-release a character.",
    async run({ request, execute }, kit) {
      let released: ReturnType<typeof forceReleaseCharacter> | null = null;
      const { duplicate } = await execute((state) => {
        released = forceReleaseCharacter(state, request.actorId, { inFight: request.inFight === true });
      });
      const held = released as ReturnType<typeof forceReleaseCharacter> | null;
      if (!duplicate && held)
        kit.context.claimReleased?.(held.sessionId, { actorId: request.actorId, name: held.name });
    }
  }),

  defineCommand({
    type: "character.set-slot",
    operationId: "setSpellSlot",
    description:
      "Sets a character's remaining spell slots for one level (clamped to the sheet maximum), to spend or restore a slot during play. With `pact`, it sets the Warlock's Pact Magic slots at that level instead. Player sessions may target only their claimed character.",
    summary: "Spend or restore a character's spell slots for one level (clamped to the sheet maximum).",
    schema: CharacterSetSlotSchema,
    malformed: "The spell-slot command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, level, remaining, pact } = request;
      await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, actorId, "resource");
        setSpellSlotRemaining(
          state,
          actorId,
          level,
          remaining,
          (definitionId) => kit.resolveDefinitionIn(state, definitionId),
          kit.equipmentCatalog(),
          pact === true
        );
      });
    }
  }),

  defineCommand({
    type: "character.set-prepared",
    operationId: "setPreparedSpell",
    description:
      "Prepares or un-prepares one of a character's known spells (cantrips and always-prepared spells can't be toggled), within the sheet's prepared cap. A player session may target only their claimed character, and only in the prepare step a Long Rest opens for a Cleric, Druid, Wizard, Paladin or Ranger (Paladins and Rangers swap in one spell), never mid-fight; the GM may change it any time.",
    summary: "Prepare or un-prepare one of a character's known spells.",
    schema: CharacterSetPreparedSchema,
    malformed: "The prepared-spell command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, spellId, prepared } = request;
      await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, actorId, "resource");
        setPreparedSpell(
          state,
          actorId,
          spellId,
          prepared,
          (definitionId) => kit.resolveDefinitionIn(state, definitionId),
          initiatorOf(principal).role
        );
      });
    }
  }),

  defineCommand({
    type: "character.finish-preparing",
    operationId: "finishPreparing",
    description:
      "Closes the prepare step a Long Rest opened for a character: its prepared spells stand until the next Long Rest. Player sessions may target only their claimed character.",
    summary: "Close a character's prepare step after a Long Rest.",
    schema: CharacterFinishPreparingSchema,
    malformed: "The finish-preparing command is malformed.",
    async run({ principal, request, execute }) {
      await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, request.actorId, "resource");
        finishPreparing(state, request.actorId);
      });
    }
  }),

  defineCommand({
    type: "character.swap-spell",
    operationId: "swapSpell",
    description:
      "Puts a spell on a character's prepared list in place of one its class chose (`replaces`), and rebuilds the sheet from its choices ledger (SRD Spell Preparation by Class): a Cleric, Druid, Paladin or Ranger takes another spell of its class's list for which it has slots, a Wizard another spell from its spellbook, and the Wizard's replaced spell stays in the book. A player session may target only their claimed character, in the prepare step a Long Rest opens (a Paladin or Ranger once); the GM any time. Never mid-fight, and only on a sheet built here (it records its choices ledger).",
    summary: "Swap a spell onto a prepared caster's list in place of one its class chose.",
    schema: CharacterSwapSpellSchema,
    malformed: "The swap-spell command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, spellId, replaces } = request;
      let line = "";
      const { duplicate } = await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, actorId, "resource");
        requireReceivedSpell(kit, principal, spellId);
        const swapped = swapClassSpell(state, actorId, spellId, replaces, initiatorOf(principal).role, {
          library: kit.playCatalog(),
          policy: state.builderPolicy,
          catalog: kit.equipmentCatalog()
        });
        line = `${kit.actorName(actorId)} prepares ${swapped.added} in place of ${swapped.removed}.`;
      });
      if (!duplicate)
        kit.context.appendLog({ kind: "encounter", text: line, actorIds: [actorId], gmOnly: kit.actorHidden(actorId) });
    }
  }),

  defineCommand({
    type: "character.add-to-spellbook",
    operationId: "addToSpellbook",
    description:
      "Adds a Wizard spell of a level the Wizard can prepare to its spellbook. `from: \"level\"` is one of the spells the Wizard's levels give (six at level 1, two more each level after), free. `scroll` copies it from a Spell Scroll of that spell the character carries (`itemId`): 2 hours and 50 GP for each level of the spell, then an Intelligence (Arcana) check against DC 10 + its level, and the scroll is destroyed whether it succeeds or fails. `book` copies it from another spellbook for the same price, GM-grade only, since the GM knows what that book holds. The clock is the GM's to move. A player session may target only their claimed character; never mid-fight, and only on a sheet built here.",
    summary: "Add a spell to a Wizard's spellbook, free from its levels or copied from a scroll or another book.",
    schema: CharacterAddToSpellbookSchema,
    malformed: "The spellbook command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, spellId, from, itemId, commandId } = request;
      let line = "";
      const { duplicate } = await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, actorId, "resource");
        requireReceivedSpell(kit, principal, spellId);
        line = addToSpellbook(
          state,
          actorId,
          { spellId, from, ...(itemId !== undefined ? { itemId } : {}) },
          initiatorOf(principal),
          {
            library: kit.playCatalog(),
            policy: state.builderPolicy,
            catalog: kit.equipmentCatalog(),
            random: (sides) => kit.context.random(sides),
            roll: {
              id: randomUUID(),
              commandId,
              sessionId: sessionIdOf(principal),
              createdAt: new Date().toISOString()
            }
          }
        );
      });
      if (!duplicate)
        kit.context.appendLog({ kind: "encounter", text: line, actorIds: [actorId], gmOnly: kit.actorHidden(actorId) });
      // A scroll's copy can fail its check, so the reply says where the spell ended up.
      const actor = kit.read().actors.find((candidate) => candidate.id === actorId);
      return { inBook: actor?.spellbook.some((entry) => entry.id === spellId) ?? false };
    }
  }),

  defineCommand({
    type: "character.set-inventory",
    operationId: "setInventory",
    description:
      "Adds, updates, or removes (quantity 0) one of a character's inventory items and toggles equipped/attuned. Player sessions may target only their claimed character.",
    summary: "Add, update, or remove one of a character's inventory items.",
    schema: CharacterSetInventorySchema,
    malformed: "The inventory command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, item } = request;
      let ended: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, actorId, "inventory");
        requireReceivedItem(kit, principal, state, actorId, item);
        // Donning armor ends Mage Armor, which the table is told.
        ended = setInventoryItem(state, actorId, item, (definitionId) => kit.resolveDefinitionIn(state, definitionId), {
          catalog: kit.equipmentCatalog(),
          role: initiatorOf(principal).role,
          pickableSpell: (spellId) => kit.catalogFor(principal).spellRecord(spellId)
        });
      });
      if (!duplicate) kit.publishNarrations(ended);
    }
  }),

  defineCommand({
    type: "character.give-item",
    operationId: "giveItem",
    description:
      "Moves one carried item row, whole, from one character to another (GM-grade only). It arrives unequipped and unattuned, and the charges it has spent go with it: a wand's charges belong to the wand.",
    summary: "Hand one carried item, with its spent charges, to another character (GM).",
    schema: CharacterGiveItemSchema,
    malformed: "The give-item command is malformed.",
    gmOnly: "Only the GM can move an item to another character.",
    async run({ request, execute }, kit) {
      const { actorId, toActorId, itemId } = request;
      let name = "";
      const { duplicate } = await execute((state) => {
        name = giveItem(
          state,
          actorId,
          toActorId,
          itemId,
          (definitionId) => kit.resolveDefinitionIn(state, definitionId),
          {
            catalog: kit.equipmentCatalog(),
            role: "gm"
          }
        ).name;
      });
      if (!duplicate)
        kit.context.appendLog({
          kind: "encounter",
          text: `${kit.actorName(actorId)} hands ${name} to ${kit.actorName(toActorId)}.`,
          actorIds: [actorId, toActorId],
          gmOnly: kit.actorHidden(actorId) || kit.actorHidden(toActorId)
        });
    }
  }),

  defineCommand({
    type: "character.recover-ammunition",
    operationId: "recoverAmmunition",
    description:
      "Picks up the ammunition a character fired outside a fight: half the pieces fired from each row come back, rounded down, and the rest are lost (SRD Ammunition). A fight's pieces come back when the encounter ends, so this is refused while the character is in a running fight. Player sessions may target only their claimed character.",
    summary: "Pick up half the ammunition a character fired outside a fight.",
    schema: CharacterRecoverAmmunitionSchema,
    malformed: "The recover-ammunition command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId } = request;
      let lines: ReturnType<typeof recoverAmmunition> = [];
      const { duplicate } = await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, actorId, "inventory");
        if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId))
          throw new CommandRejectedError("Ammunition is picked up after the fight.");
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That character no longer exists.");
        if (!actor.inventory.some((row) => row.ammunitionFired !== undefined))
          throw new CommandRejectedError(`${actor.name} has no fired ammunition to pick up.`);
        lines = recoverAmmunition(state, [actorId], kit.equipmentCatalog());
      });
      if (duplicate) return;
      const said = lines.length > 0 ? lines : [{ actorId, text: `${kit.actorName(actorId)} finds none of it.` }];
      for (const line of said)
        kit.context.appendLog({
          kind: "encounter",
          text: line.text,
          actorIds: [line.actorId],
          gmOnly: kit.actorHidden(line.actorId)
        });
    }
  }),

  defineCommand({
    type: "character.set-currency",
    operationId: "setCurrency",
    description:
      "Sets a character's coin purse (cp/sp/ep/gp/pp). Player sessions may target only their claimed character.",
    summary: "Set a character's coin purse.",
    schema: CharacterSetCurrencySchema,
    malformed: "The currency command is malformed.",
    async run({ principal, request, execute }) {
      await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, request.actorId, "inventory");
        setCurrency(state, request.actorId, request.currency);
      });
    }
  }),

  defineCommand({
    type: "character.set-favourites",
    operationId: "setFavourites",
    description:
      "Pins options to a character's turn card on the sheet, in order: up to 8 ids, each an option the character has now and one that belongs on the turn list (an `actions[]` entry of `GET /game/actors/{actorId}/available-actions` without `passive`). An empty list clears the pins. The pins reach only the character's owner and the GM. The GM may pin for any character; a player session only for their claimed character.",
    summary: "Pin options to a character's turn card (the GM for anyone; a player for their own claimed character).",
    schema: CharacterSetFavouritesSchema,
    malformed: "The favourites command is malformed.",
    issueMessage: true,
    async run({ principal, request, execute }, kit) {
      await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, request.actorId, "edit");
        const actor = state.actors.find((candidate) => candidate.id === request.actorId);
        const definition = actor?.definitionId ? kit.resolveDefinitionIn(state, actor.definitionId) : undefined;
        setFavourites(state, request.actorId, request.optionIds, { definition, catalog: kit.equipmentCatalog() });
      });
    }
  }),

  defineCommand({
    type: "character.set-identity",
    operationId: "setIdentity",
    description:
      "Sets a character's identity (class/level/race/background/feats) on its editable imported sheet. It is a light hand-edit; the guided builder is `character.rebuild`. Player sessions may target only their claimed character, and may only rename: classes, levels, species and background ids, feats, features, the choice ledger and Martial Arts are the GM's. On a sheet built here (it carries the choice ledger) those belong to the builder for everyone, and the Level flow (`character.rebuild`) changes them.",
    summary:
      "Edit a character's identity (class/level/race/background/feats) on its imported sheet; players only rename.",
    schema: CharacterSetIdentitySchema,
    malformed: "The identity command is malformed.",
    async run({ principal, request, execute }, kit) {
      await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, request.actorId, "edit");
        setCharacterIdentity(
          state,
          request.actorId,
          request.character,
          { gm: isGmGrade(principal) },
          kit.equipmentCatalog()
        );
      });
    }
  }),

  defineCommand({
    type: "character.set-proficiencies",
    operationId: "setProficiencies",
    description:
      "Sets a character's save and skill proficiency selections on its editable imported sheet. Player sessions may target only their claimed character.",
    summary: "Edit a character's save and skill proficiency selections on its imported sheet.",
    schema: CharacterSetProficienciesSchema,
    malformed: "The proficiencies command is malformed.",
    async run({ principal, request, execute }, kit) {
      await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, request.actorId, "edit");
        setCharacterProficiencies(state, request.actorId, request.proficiencies, kit.equipmentCatalog(), {
          library: kit.playCatalog(),
          policy: state.builderPolicy
        });
      });
    }
  })
];
