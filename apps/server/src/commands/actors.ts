import { addActorFromDefinition, importActorDefinition, removeActor } from "../actor-roster.js";
import { requireActorAccess } from "../authorization.js";
import { forceReleaseCharacter } from "../character-claims.js";
import { addCombatant } from "../encounter.js";
import {
  ActorAddFromDefinitionSchema,
  ActorImportDefinitionSchema,
  ActorRemoveSchema,
  ActorSetSpeedSchema,
  SetActorArchivedSchema,
  SetActorHealthDisplaySchema,
  SetActorSheetPreviewSchema,
  SetActorSizeSchema,
  SetActorVisibilitySchema,
  SetTokenImageSchema
} from "../game-commands.js";
import { CommandRejectedError } from "../game-store.js";
import { setActorSize, setActorVisibility } from "../token-placement.js";
import { importedDefinition } from "./characters.js";
import { initiatorOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// The roster and each combatant's presentation on the table.

export const actorCommands = [
  defineCommand({
    type: "actor.add-from-definition",
    operationId: "addActorFromDefinition",
    description:
      "Instantiates a bundled SRD monster onto the roster (GM-grade only). The response's `actorId` equals the commandId.",
    summary:
      "Instantiate a bundled SRD monster onto the roster, optionally joining the running fight in the same command (GM).",
    schema: ActorAddFromDefinitionSchema,
    malformed: "The add-combatant command is malformed.",
    gmOnly: "Only the GM can add combatants.",
    async run({ principal, request, execute }, kit) {
      // Browse-driven, so the GM's catalog: a draft creature cannot be added. Library status and table
      // visibility are independent.
      const definition = kit.catalogFor(principal).monster(request.definitionId);
      if (!definition) throw new CommandRejectedError("That monster is not in the bundled content.");
      // The commandId doubles as the entity id so a duplicate delivery acks the same actorId.
      const actorId = request.commandId;
      // `joinEncounter` adds the roster row, initiative entry and tray token in one revision.
      const mapAssetId = kit.read().combat.mapAssetId;
      const geometry =
        request.joinEncounter === true && mapAssetId ? await kit.context.tokenGeometryFor(mapAssetId) : null;
      await execute(
        (state) => {
          addActorFromDefinition(state, definition, actorId, request.visibility, kit.equipmentCatalog());
          // Ignored out of combat: there is no fight to join, and the roster add is the whole intent.
          if (request.joinEncounter === true && state.combat.active && geometry)
            addCombatant(state, actorId, undefined, () => kit.context.random(20), geometry);
        },
        { actorId }
      );
      return { actorId };
    }
  }),

  defineCommand({
    type: "actor.import-definition",
    operationId: "importActorDefinition",
    description:
      "Imports a canonical ActorDefinition JSON as a claimable actor with a full sheet (GM-grade only). The response's `actorId` equals the commandId.",
    summary: "Import a canonical ActorDefinition JSON as a claimable actor (GM).",
    schema: ActorImportDefinitionSchema,
    malformed: "The import command is malformed.",
    gmOnly: "Only the GM can import sheets.",
    async run({ request, execute }, kit) {
      const definition = importedDefinition(request.definition, "actor definition");
      const actorId = request.commandId;
      await execute(
        (state) => importActorDefinition(state, definition, actorId, request.visibility, kit.equipmentCatalog()),
        { actorId }
      );
      return { actorId };
    }
  }),

  defineCommand({
    type: "actor.remove",
    operationId: "removeActor",
    description:
      "Removes an actor from the roster (GM-grade only); rejected for claimed characters and, while rewound, for combatants in the fight.",
    summary: "Remove an actor from the roster (GM).",
    schema: ActorRemoveSchema,
    malformed: "The remove-combatant command is malformed.",
    gmOnly: "Only the GM can remove combatants.",
    async run({ request, execute }) {
      await execute((state) => removeActor(state, request.actorId));
    }
  }),

  defineCommand({
    type: "actor.set-token-image",
    operationId: "setActorTokenImage",
    description:
      "Sets or clears (null) a combatant's token image from the uploaded token library: the GM for any combatant, a player for their own claimed character.",
    summary:
      "Set or clear a combatant's token image from the token library - the GM for anyone, a player for their own claimed character.",
    schema: SetTokenImageSchema,
    malformed: "The token image command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, tokenAssetId } = request;
      // Checked before the library lookup so a player cannot probe it through someone else's character.
      requireActorAccess(initiatorOf(principal), kit.read(), actorId, "edit");
      if (tokenAssetId !== null && !kit.context.tokenCatalog.get(tokenAssetId))
        throw new CommandRejectedError("That token image is not in your library.");
      const { state, duplicate } = await execute((draft) => {
        const actor = draft.actors.find((item) => item.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        // Re-checked inside the transaction: the check above races a claim release.
        requireActorAccess(initiatorOf(principal), draft, actorId, "edit");
        if (tokenAssetId === null) delete actor.tokenAssetId;
        else actor.tokenAssetId = tokenAssetId;
      });
      if (duplicate || tokenAssetId === null) return;
      kit.context.tokenCatalog.touchLastUsed(tokenAssetId);
      const definitionId = state.actors.find((item) => item.id === actorId)?.definitionId;
      if (definitionId) kit.context.tokenCatalog.rememberForDefinition(definitionId, tokenAssetId);
    }
  }),

  defineCommand({
    type: "actor.set-size",
    operationId: "setActorSize",
    description:
      "Sets a combatant's creature size; large+ tokens size to their grid footprint and re-snap (GM-grade only).",
    summary: "Set a combatant's creature size; the token re-snaps to its footprint (GM).",
    schema: SetActorSizeSchema,
    malformed: "The token size command is malformed.",
    gmOnly: "Only the GM can resize tokens.",
    async run({ request, execute }, kit) {
      const mapAssetId = kit.read().combat.mapAssetId;
      const geometry = mapAssetId ? await kit.context.tokenGeometryFor(mapAssetId) : null;
      await execute((state) => setActorSize(state, request.actorId, request.size, geometry));
    }
  }),

  defineCommand({
    type: "actor.set-visibility",
    operationId: "setActorVisibility",
    description: "Moves a combatant between the shared layer (public) and the GM-only layer (GM-grade only).",
    summary: "Move a combatant between the shared layer and the GM-only layer (GM).",
    schema: SetActorVisibilitySchema,
    malformed: "The token visibility command is malformed.",
    gmOnly: "Only the GM can change token visibility.",
    async run({ request, execute }) {
      await execute((state) => setActorVisibility(state, request.actorId, request.visibility));
    }
  }),

  defineCommand({
    type: "actor.set-archived",
    operationId: "setActorArchived",
    description:
      "Archives or restores a character (GM-grade only). Archived characters are hidden from players, refused by claim, and rejected server-side by scene staging and encounter start/add; a character in the running encounter must be removed first. Archiving a CLAIMED character releases the claim in the same mutation, so its player is not left holding an invisible claim.",
    summary:
      "Archive or restore a character - archived characters are hidden from players, refused by claim, rejected by scene and encounter staging, and any claim is released on archive (GM).",
    schema: SetActorArchivedSchema,
    malformed: "The archive command is malformed.",
    gmOnly: "Only the GM can archive characters.",
    async run({ request, execute }, kit) {
      const { actorId, archived } = request;
      // Archiving hides a character from players and the encounter builder; a combatant in the running
      // fight must be removed from combat first.
      let releasedClaim = false;
      const { duplicate } = await execute((state) => {
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That character no longer exists.");
        if (archived && state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId))
          throw new CommandRejectedError("Remove this character from the encounter before archiving it.");
        // Release a claim on archive, otherwise the owner holds an invisible claim and the one-claim rule
        // blocks them from claiming anything else.
        releasedClaim = archived && actor.ownerSessionId !== null;
        if (releasedClaim) forceReleaseCharacter(state, actorId);
        actor.archived = archived;
      });
      if (!duplicate && releasedClaim)
        kit.context.appendLog({
          kind: "encounter",
          text: `${kit.actorName(actorId)} was archived - their player's claim was released.`,
          actorIds: [actorId],
          gmOnly: true
        });
    }
  }),

  defineCommand({
    type: "actor.set-sheet-preview",
    operationId: "setActorSheetPreview",
    description:
      "Shares (or un-shares) an ARCHIVED character's sheet with players as a read-only keepsake (GM-grade only). Default hidden - a retired character stays private until the GM shares it. Meaningless while the character is not archived. Players receive only the character's id and name in their projection.",
    summary: "Share or hide an archived character's sheet as a read-only keepsake for players; hidden by default (GM).",
    schema: SetActorSheetPreviewSchema,
    malformed: "The sheet-preview command is malformed.",
    gmOnly: "Only the GM can share an archived character's sheet.",
    // Players receive only the shared sheet's id and name.
    async run({ request, execute }, kit) {
      const { actorId, enabled } = request;
      const { duplicate } = await execute((state) => {
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That character no longer exists.");
        actor.sheetPreview = enabled;
      });
      if (!duplicate)
        kit.context.appendLog({
          kind: "encounter",
          text: `${kit.actorName(actorId)}'s archived sheet is now ${enabled ? "shared with players" : "hidden from players"}.`,
          actorIds: [actorId],
          gmOnly: true
        });
    }
  }),

  defineCommand({
    type: "actor.set-speed",
    operationId: "setActorSpeed",
    description:
      "Sets a combatant's walking speed in feet (GM-grade only); null clears it to unknown, which skips the movement rules for that combatant. Speed seeds from the imported definition automatically.",
    summary: "Set a combatant's walking speed in feet (null clears to unknown, skipping movement rules) (GM).",
    schema: ActorSetSpeedSchema,
    malformed: "The speed command is malformed.",
    gmOnly: "Only the GM can set movement speed.",
    async run({ request, execute }) {
      const { actorId, speedFeet } = request;
      await execute((state) => {
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        if (speedFeet === null) delete actor.speedFeet;
        else actor.speedFeet = speedFeet;
      });
    }
  }),

  defineCommand({
    type: "actor.set-health-display",
    operationId: "setActorHealthDisplay",
    description:
      "Overrides how one combatant's token health shows on the map (GM-grade only), or clears the override (`display: null`) so the token follows the table-wide default. Same style/audience choices as the table-wide health-display command.",
    summary: "Override one combatant's token health display, or clear it to follow the table default (GM).",
    schema: SetActorHealthDisplaySchema,
    malformed: "The health-display command is malformed.",
    gmOnly: "Only the GM can change how health is shown.",
    async run({ request, execute }) {
      const { actorId, display } = request;
      await execute((state) => {
        const actor = state.actors.find((item) => item.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        if (display === null) delete actor.healthDisplay;
        else actor.healthDisplay = display;
      });
    }
  })
];
