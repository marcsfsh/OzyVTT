import {
  DoorSetOpenSchema,
  ItemSetFormSchema,
  ItemSetLightSchema,
  VisionAreaAddSchema,
  VisionAreaRemoveSchema,
  LightAddSchema,
  LightMoveSchema,
  LightRemoveSchema,
  VisionResetExploredSchema,
  VisionSetAmbientSchema,
  VisionSetEnabledSchema,
  WallAddSchema,
  WallClearSchema,
  WallMoveSchema,
  WallRemoveSchema
} from "@vtt/domain/commands";
import { GameAccessDeniedError } from "../authorization.js";
import { CommandRejectedError } from "../game-store.js";
import { setItemLight } from "../item-light.js";
import { setItemForm } from "../inventory.js";
import {
  addLight,
  addVisionArea,
  removeVisionArea,
  addWalls,
  clearWalls,
  doorWithinReach,
  moveLight,
  moveWall,
  removeLight,
  removeWall,
  resetExplored,
  setDoorOpen,
  setVisionAmbient,
  setVisionEnabled
} from "../vision/edit.js";
import { playerViewerIds } from "../vision/audience.js";
import { heldShutAgainst, isHiddenDoor } from "../doors.js";
import { spendObjectInteraction } from "../object-interactions.js";
import { initiatorOf, isGmGrade, type Kit } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Dynamic vision (ADR-0023): the GM's walls, doors, windows and lights, the scene's ambient light and its switch, and
// opening a door, which a player may do beside their own character.

/** The geometry of the map an edit targets: the live table's, or the parked scene's with `encounterId`. */
async function sceneGeometry(kit: Kit, encounterId: string | undefined) {
  const combat = kit.read().combat;
  const mapAssetId =
    encounterId === undefined
      ? combat.mapAssetId
      : (combat.encounters.find((scene) => scene.id === encounterId)?.mapAssetId ?? null);
  if (!mapAssetId) throw new CommandRejectedError("Pick a map before setting up its vision.");
  return kit.context.tokenGeometryFor(mapAssetId);
}

const GM_ONLY = "Only the GM sets up walls, lights and vision.";

export const visionCommands = [
  defineCommand({
    type: "vision.set-enabled",
    operationId: "setVisionEnabled",
    description:
      "Turns dynamic vision on or off for the live table or, with `encounterId`, a prepared encounter (GM-grade only). With it on, walls, closed doors and windows block movement, walls and closed doors block sight and light, and each player receives only the creatures their own characters perceive. The map needs a calibrated grid or a saved scale.",
    summary: "Turn dynamic vision on or off for the live table or a prepared encounter (GM).",
    schema: VisionSetEnabledSchema,
    malformed: "The vision command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      const { enabled, encounterId } = request;
      const geometry = await sceneGeometry(kit, encounterId);
      const { duplicate } = await execute((state) => setVisionEnabled(state, encounterId, geometry, enabled));
      if (!duplicate && encounterId === undefined)
        kit.context.appendLog({
          kind: "scene",
          text: enabled
            ? "Dynamic vision is on. Each player sees only what their characters can."
            : "Dynamic vision is off.",
          gmOnly: true
        });
    }
  }),

  defineCommand({
    type: "vision.set-ambient",
    operationId: "setVisionAmbient",
    description:
      "Sets the encounter's ambient light (GM-grade only): `bright` (daylight), `dim` (twilight, a lit room's shadows) or `dark` (night, an unlit dungeon), where creatures see only by light, Darkvision and their other senses. `encounterId` targets a prepared encounter.",
    summary: "Set the encounter's ambient light: bright, dim or dark (GM).",
    schema: VisionSetAmbientSchema,
    malformed: "The ambient light is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      const { ambient, sunlight, encounterId } = request;
      const geometry = await sceneGeometry(kit, encounterId);
      await execute((state) => setVisionAmbient(state, encounterId, geometry, ambient, sunlight));
    }
  }),

  defineCommand({
    type: "vision.add-area",
    operationId: "addVisionArea",
    description:
      "Paints an area of light or obscurement over the encounter's ambient light (GM-grade only): `bright`, `dim` or `dark` set its light level (a lit room in a dark dungeon, a shadowed cellar in daylight; `sunlight` makes a bright one sunlit), `lightly-obscured` (patchy fog, moderate foliage) gives Disadvantage on Wisdom (Perception) checks that rely on sight, `heavily-obscured` (dense fog or foliage) blocks sight into and through it, and `magical-darkness` stays dark whatever light reaches it, seen into only by Blindsight, Truesight and Devil's Sight. A `rect` snaps to whole cells; fog and magical Darkness may be a `circle` of `radiusFeet` instead. `encounterId` targets a prepared encounter. The area's id is the commandId.",
    summary: "Paint an area of light, darkness or fog over the encounter (GM).",
    schema: VisionAreaAddSchema,
    malformed: "The area is malformed.",
    issueMessage: true,
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      const { commandId, kind, sunlight, rect, circle, encounterId } = request;
      const geometry = await sceneGeometry(kit, encounterId);
      await execute((state) =>
        addVisionArea(state, encounterId, geometry, {
          id: commandId,
          kind,
          ...(sunlight !== undefined ? { sunlight } : {}),
          ...(rect ? { rect } : {}),
          ...(circle ? { circle } : {})
        })
      );
    }
  }),

  defineCommand({
    type: "vision.remove-area",
    operationId: "removeVisionArea",
    description:
      "Removes an area of light, darkness or fog (GM-grade only), whether the GM painted it or a spell made it. `encounterId` targets a prepared encounter.",
    summary: "Remove an area of light, darkness or fog (GM).",
    schema: VisionAreaRemoveSchema,
    malformed: "The area command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }) {
      await execute((state) => removeVisionArea(state, request.encounterId, request.areaId));
    }
  }),

  defineCommand({
    type: "item.set-light",
    operationId: "setItemLight",
    description:
      "Lights or puts out a light source a creature carries (a Torch, a Lamp, a Lantern, a Candle, a magic item that glows), lowers or raises a Hooded Lantern's hood, or aims a Bullseye Lantern's Cone (`facingDegrees`, from the right of the map, clockwise). Lighting a Candle, Lamp, Lantern or Torch needs a Tinderbox or another flame in hand, and a Lamp or Lantern burns a flask of Oil for 6 hours; a Torch or Candle burns for an hour, then is used up. Lighting one and moving a hood take the creature's Bonus Action on its turn in an encounter. A lit light is held (equipped), and stowing it puts it out. GM-grade for any creature; a player session for their own claimed character.",
    summary: "Light, put out, hood or aim a carried light source.",
    schema: ItemSetLightSchema,
    malformed: "The light command is malformed.",
    issueMessage: true,
    async run({ principal, request, execute }, kit) {
      const { actorId, itemId, lit, hoodLowered, facingDegrees } = request;
      let said: string | null = null;
      const { duplicate } = await execute((state) => {
        said = setItemLight(
          state,
          {
            actorId,
            itemId,
            ...(lit !== undefined ? { lit } : {}),
            ...(hoodLowered !== undefined ? { hoodLowered } : {}),
            ...(facingDegrees !== undefined ? { facingDegrees } : {})
          },
          initiatorOf(principal),
          kit.equipmentCatalog()
        );
      });
      if (!duplicate && said !== null)
        kit.context.appendLog({ kind: "action", text: said, actorIds: [actorId], gmOnly: kit.actorHidden(actorId) });
    }
  }),

  defineCommand({
    type: "item.set-form",
    operationId: "setItemForm",
    description:
      "Puts a carried item in one of the forms its holder chooses (a Rod of Lordly Might's flame blade, a Quarterstaff of the Acrobat's pole), or back in its own form with a null `variantId`. The item must be held (equipped), and a form the item says takes a Bonus Action takes the creature's Bonus Action on its turn in an encounter. The kinds the GM says a found item is (an Ioun Stone's) are set with character.set-inventory instead. GM-grade for any creature; a player session for their own claimed character.",
    summary: "Change the form of a carried item.",
    schema: ItemSetFormSchema,
    malformed: "The item form command is malformed.",
    issueMessage: true,
    async run({ principal, request, execute }, kit) {
      const { actorId, itemId, variantId } = request;
      let said = "";
      const { duplicate } = await execute((state) => {
        said = setItemForm(
          state,
          { actorId, itemId, variantId },
          initiatorOf(principal),
          kit.equipmentCatalog(),
          (id) => kit.resolveDefinitionIn(state, id)
        );
      });
      if (!duplicate)
        kit.context.appendLog({ kind: "action", text: said, actorIds: [actorId], gmOnly: kit.actorHidden(actorId) });
    }
  }),

  defineCommand({
    type: "vision.reset-explored",
    operationId: "resetVisionExplored",
    description:
      "Forgets what the party has seen of the encounter, so only what its characters see now is shown (GM-grade only). `encounterId` targets a prepared encounter.",
    summary: "Forget what the party has seen of the encounter (GM).",
    schema: VisionResetExploredSchema,
    malformed: "The vision command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }) {
      await execute((state) => resetExplored(state, request.encounterId));
    }
  }),

  defineCommand({
    type: "wall.add",
    operationId: "addWalls",
    description:
      "Draws a chain of walls, doors or windows through `points`, one segment per pair (GM-grade only). Ends snap to another wall's end or a grid corner nearby and are clamped to the map. A wall blocks sight, light and movement, a door does while closed (doors start closed), and a window blocks movement only. `encounterId` targets a prepared encounter. Answers with the new segments' ids.",
    summary: "Draw walls, doors or windows on the map (GM).",
    schema: WallAddSchema,
    malformed: "The wall is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      const { kind, points, encounterId } = request;
      const geometry = await sceneGeometry(kit, encounterId);
      let wallIds: string[] = [];
      await execute((state) => {
        wallIds = addWalls(state, encounterId, geometry, { kind, points, newId: kit.context.newId });
      });
      return { wallIds };
    }
  }),

  defineCommand({
    type: "wall.move",
    operationId: "moveWall",
    description: "Moves a wall, door or window's two ends, snapped as when drawn (GM-grade only).",
    summary: "Move a wall's ends (GM).",
    schema: WallMoveSchema,
    malformed: "The wall move is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      const { wallId, a, b, encounterId } = request;
      const geometry = await sceneGeometry(kit, encounterId);
      await execute((state) => moveWall(state, encounterId, geometry, { wallId, a, b }));
    }
  }),

  defineCommand({
    type: "wall.remove",
    operationId: "removeWall",
    description: "Removes one wall, door or window (GM-grade only). `encounterId` targets a prepared encounter.",
    summary: "Remove a wall, door or window (GM).",
    schema: WallRemoveSchema,
    malformed: "The wall command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }) {
      await execute((state) => removeWall(state, request.encounterId, request.wallId));
    }
  }),

  defineCommand({
    type: "wall.clear",
    operationId: "clearWalls",
    description:
      "Removes every wall, door and window from the encounter (GM-grade only). `encounterId` targets a prepared encounter.",
    summary: "Remove every wall, door and window (GM).",
    schema: WallClearSchema,
    malformed: "The wall command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }) {
      await execute((state) => clearWalls(state, request.encounterId));
    }
  }),

  defineCommand({
    type: "door.set-open",
    operationId: "setDoorOpen",
    description:
      "Opens or closes a door. The GM opens any door, on the live table or (with `encounterId`) a prepared encounter; a player only one within 5 feet of their own character's token on the live table, with no wall between them. In an encounter that is the character's one free object interaction on its turn, and a second takes the Utilize action.",
    summary: "Open or close a door; a player, one beside their own character.",
    schema: DoorSetOpenSchema,
    malformed: "The door command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { wallId, open, encounterId } = request;
      const player = isGmGrade(principal) ? null : principal;
      if (player && encounterId !== undefined)
        throw new GameAccessDeniedError("Only the GM can stage a prepared encounter.");
      let opener: string | null = null;
      const { duplicate } = await execute((state) => {
        if (player) {
          const mine = playerViewerIds(state, player.sessionId);
          const door = state.combat.vision.walls.find((wall) => wall.id === wallId);
          // Out of reach, unknown and secret look the same, so a door the player hasn't found isn't confirmed.
          const reachable =
            door && !isHiddenDoor(door) ? mine.filter((actorId) => doorWithinReach(state, wallId, [actorId])) : [];
          if (reachable.length === 0)
            throw new GameAccessDeniedError("Move your character next to the door to open or close it.");
          // A locked, stuck, barred or jammed door opens only for a creature it doesn't hold shut against: one with
          // the key, or one an Arcane Lock names.
          // In a fight the creature whose turn it is opens it, as its one free object interaction or a Utilize action.
          const onTurn = reachable.filter((actorId) => actorId === state.combat.turnActorId);
          const candidates = onTurn.length > 0 ? onTurn : reachable;
          const free = open
            ? candidates.find((actorId) => heldShutAgainst(state, door!, actorId) === null)
            : candidates[0];
          if (free === undefined) throw new CommandRejectedError(heldShutAgainst(state, door!, candidates[0]!)!);
          opener = free;
          const actor = state.actors.find((candidate) => candidate.id === free)!;
          spendObjectInteraction(state, actor, { role: "player" }, `${open ? "Open" : "Close"} the door`);
        }
        setDoorOpen(state, encounterId, wallId, open);
      });
      if (!duplicate && opener !== null)
        kit.context.appendLog({
          kind: "movement",
          text: `${kit.actorName(opener)} ${open ? "opens" : "closes"} a door.`,
          actorIds: [opener]
        });
    }
  }),

  defineCommand({
    type: "light.add",
    operationId: "addLight",
    description:
      "Places a light on the map at `position`, or gives one to a creature (`actorId`), which carries it as its token moves (GM-grade only). `brightFeet` is the Bright Light radius and `dimFeet` the Dim Light beyond it, as the SRD prints them (a Torch is 20 and 20). Lights matter where the ambient light is dark; walls and closed doors stop them. `encounterId` targets a prepared encounter. Answers with the light's id, which is the commandId.",
    summary: "Place a light on the map or give one to a creature (GM).",
    schema: LightAddSchema,
    malformed: "The light is malformed.",
    issueMessage: true,
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      const { commandId, position, actorId, brightFeet, dimFeet, encounterId } = request;
      const geometry = await sceneGeometry(kit, encounterId);
      await execute((state) =>
        addLight(state, encounterId, geometry, {
          id: commandId,
          ...(position ? { position } : {}),
          ...(actorId ? { actorId } : {}),
          brightFeet,
          dimFeet
        })
      );
      return { lightId: commandId };
    }
  }),

  defineCommand({
    type: "light.move",
    operationId: "moveLight",
    description:
      "Moves a light; a carried one is set down there (GM-grade only). `encounterId` targets a prepared encounter.",
    summary: "Move a light (GM).",
    schema: LightMoveSchema,
    malformed: "The light move is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      const { lightId, position, encounterId } = request;
      const geometry = await sceneGeometry(kit, encounterId);
      await execute((state) => moveLight(state, encounterId, geometry, { lightId, position }));
    }
  }),

  defineCommand({
    type: "light.remove",
    operationId: "removeLight",
    description: "Removes a light (GM-grade only). `encounterId` targets a prepared encounter.",
    summary: "Remove a light (GM).",
    schema: LightRemoveSchema,
    malformed: "The light command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }) {
      await execute((state) => removeLight(state, request.encounterId, request.lightId));
    }
  })
];
