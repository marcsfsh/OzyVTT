import { requireActorAccess } from "../authorization.js";
import { claimCharacter, forceReleaseCharacter, releaseCharactersForSession } from "../character-claims.js";
import { setCharacterIdentity, setCharacterProficiencies } from "../character-edit.js";
import {
  ActorRemoveSchema,
  CharacterSetCurrencySchema,
  CharacterSetIdentitySchema,
  CharacterSetInventorySchema,
  CharacterSetPreparedSchema,
  CharacterSetProficienciesSchema,
  CharacterSetSlotSchema,
  CommandIdentitySchema
} from "../game-commands.js";
import { setCurrency, setInventoryItem } from "../inventory.js";
import { setPreparedSpell, setSpellSlotRemaining } from "../spellcasting.js";
import { initiatorOf, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Claims, and the edits a player may make to their own character's sheet.

export const characterSheetCommands = [
  defineCommand({
    type: "character.claim",
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
    type: "character.set-currency",
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
