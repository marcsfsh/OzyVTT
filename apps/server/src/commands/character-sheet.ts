import { requireActorAccess } from "../authorization.js";
import { claimCharacter, forceReleaseCharacter, releaseCharactersForSession } from "../character-claims.js";
import { setCharacterIdentity, setCharacterProficiencies } from "../character-edit.js";
import {
  ActorRemoveSchema,
  CharacterGiveItemSchema,
  CharacterSetCurrencySchema,
  CharacterSetIdentitySchema,
  CharacterSetInventorySchema,
  CharacterSetPreparedSchema,
  CharacterSetProficienciesSchema,
  CharacterSetSlotSchema,
  CommandIdentitySchema
} from "@vtt/domain/commands";
import { giveItem, setCurrency, setInventoryItem } from "../inventory.js";
import { setPreparedSpell, setSpellSlotRemaining } from "../spellcasting.js";
import { initiatorOf, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Claims, and the edits a player may make to their own character's sheet.

export const characterSheetCommands = [
  defineCommand({
    type: "character.claim",
    operationId: "claimCharacter",
    description:
      "Claims an unclaimed player character for the calling session. Player sessions only - GM sessions and integration credentials are refused (an integration wanting a seat at the table should hold a player session from POST /sessions/player).",
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
    description: "Force-releases a claimed character (GM-grade only) - the recovery path for a lost player device.",
    summary: "Force-release a claimed character (GM).",
    schema: ActorRemoveSchema,
    malformed: "The force-release command is malformed.",
    gmOnly: "Only the GM can force-release a character.",
    async run({ request, execute }) {
      await execute((state) => forceReleaseCharacter(state, request.actorId));
    }
  }),

  defineCommand({
    type: "character.set-slot",
    operationId: "setSpellSlot",
    description:
      "Sets a character's remaining spell slots for one level (clamped to the sheet maximum) - spend or restore a slot during play. Player sessions may target only their claimed character.",
    summary: "Spend or restore a character's spell slots for one level (clamped to the sheet maximum).",
    schema: CharacterSetSlotSchema,
    malformed: "The spell-slot command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, level, remaining } = request;
      await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, actorId, "resource");
        setSpellSlotRemaining(
          state,
          actorId,
          level,
          remaining,
          (definitionId) => kit.resolveDefinitionIn(state, definitionId),
          kit.equipmentCatalog()
        );
      });
    }
  }),

  defineCommand({
    type: "character.set-prepared",
    operationId: "setPreparedSpell",
    description:
      "Prepares or un-prepares one of a character's known spells (cantrips and always-prepared spells can't be toggled). Player sessions may target only their claimed character.",
    summary: "Prepare or un-prepare one of a character's known spells.",
    schema: CharacterSetPreparedSchema,
    malformed: "The prepared-spell command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, spellId, prepared } = request;
      await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, actorId, "resource");
        setPreparedSpell(state, actorId, spellId, prepared, (definitionId) =>
          kit.resolveDefinitionIn(state, definitionId)
        );
      });
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
      await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, actorId, "inventory");
        setInventoryItem(state, actorId, item, (definitionId) => kit.resolveDefinitionIn(state, definitionId), {
          catalog: kit.equipmentCatalog(),
          role: initiatorOf(principal).role
        });
      });
    }
  }),

  defineCommand({
    type: "character.give-item",
    operationId: "giveItem",
    description:
      "Moves one carried item row, whole, from one character to another (GM-grade only). It arrives unequipped and unattuned, and the charges it has spent go with it: a wand's charges belong to the wand, not to whoever held it.",
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
    type: "character.set-identity",
    operationId: "setIdentity",
    description:
      "Sets a character's identity (class/level/race/background/feats) on its editable imported sheet - a light hand-edit, not a guided builder. Player sessions may target only their claimed character.",
    summary: "Edit a character's identity (class/level/race/background/feats) on its imported sheet.",
    schema: CharacterSetIdentitySchema,
    malformed: "The identity command is malformed.",
    async run({ principal, request, execute }) {
      await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, request.actorId, "edit");
        setCharacterIdentity(state, request.actorId, request.character);
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
    async run({ principal, request, execute }) {
      await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, request.actorId, "edit");
        setCharacterProficiencies(state, request.actorId, request.proficiencies);
      });
    }
  })
];
