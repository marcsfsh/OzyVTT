import {
  DoorSetOpenSchema,
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
import {
  addLight,
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
import { isGmGrade, type Kit } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Dynamic vision (ADR-0023): the GM's walls, doors, windows and lights, the scene's ambient light and its switch, and
// opening a door, which a player may do beside their own character.

/** The geometry of the map an edit targets: the live table's, or the parked scene's with `sceneId`. */
async function sceneGeometry(kit: Kit, sceneId: string | undefined) {
  const combat = kit.read().combat;
  const mapAssetId =
    sceneId === undefined ? combat.mapAssetId : (combat.scenes.find((scene) => scene.id === sceneId)?.mapAssetId ?? null);
  if (!mapAssetId) throw new CommandRejectedError("Pick a map before setting up its vision.");
  return kit.context.tokenGeometryFor(mapAssetId);
}

const GM_ONLY = "Only the GM sets up walls, lights and vision.";

export const visionCommands = [
  defineCommand({
    type: "vision.set-enabled",
    operationId: "setVisionEnabled",
    description:
      "Turns dynamic vision on or off for the live table or, with `sceneId`, a prepared scene (GM-grade only). With it on, walls, closed doors and windows block movement, walls and closed doors block sight and light, and each player receives only the creatures their own characters perceive. The map needs a calibrated grid or a saved scale.",
    summary: "Turn dynamic vision on or off for the live table or a prepared scene (GM).",
    schema: VisionSetEnabledSchema,
    malformed: "The vision command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      const { enabled, sceneId } = request;
      const geometry = await sceneGeometry(kit, sceneId);
      const { duplicate } = await execute((state) => setVisionEnabled(state, sceneId, geometry, enabled));
      if (!duplicate && sceneId === undefined)
        kit.context.appendLog({
          kind: "scene",
          text: enabled
            ? "Dynamic vision on - each player sees only what their characters can."
            : "Dynamic vision off.",
          gmOnly: true
        });
    }
  }),

  defineCommand({
    type: "vision.set-ambient",
    operationId: "setVisionAmbient",
    description:
      "Sets the scene's ambient light (GM-grade only): `bright` (daylight), `dim` (twilight, a lit room's shadows) or `dark` (night, an unlit dungeon), where creatures see only by light, Darkvision and their other senses. `sceneId` targets a prepared scene.",
    summary: "Set the scene's ambient light: bright, dim or dark (GM).",
    schema: VisionSetAmbientSchema,
    malformed: "The ambient light is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      const { ambient, sceneId } = request;
      const geometry = await sceneGeometry(kit, sceneId);
      await execute((state) => setVisionAmbient(state, sceneId, geometry, ambient));
    }
  }),

  defineCommand({
    type: "vision.reset-explored",
    operationId: "resetVisionExplored",
    description:
      "Forgets what the party has seen of the scene, so only what its characters see now is shown (GM-grade only). `sceneId` targets a prepared scene.",
    summary: "Forget what the party has seen of the scene (GM).",
    schema: VisionResetExploredSchema,
    malformed: "The vision command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }) {
      await execute((state) => resetExplored(state, request.sceneId));
    }
  }),

  defineCommand({
    type: "wall.add",
    operationId: "addWalls",
    description:
      "Draws a chain of walls, doors or windows through `points`, one segment per pair (GM-grade only). Ends snap to another wall's end or a grid corner nearby and are clamped to the map. A wall blocks sight, light and movement, a door does while closed (doors start closed), and a window blocks movement only. `sceneId` targets a prepared scene. Answers with the new segments' ids.",
    summary: "Draw walls, doors or windows on the map (GM).",
    schema: WallAddSchema,
    malformed: "The wall is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      const { kind, points, sceneId } = request;
      const geometry = await sceneGeometry(kit, sceneId);
      let wallIds: string[] = [];
      await execute((state) => {
        wallIds = addWalls(state, sceneId, geometry, { kind, points, newId: kit.context.newId });
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
      const { wallId, a, b, sceneId } = request;
      const geometry = await sceneGeometry(kit, sceneId);
      await execute((state) => moveWall(state, sceneId, geometry, { wallId, a, b }));
    }
  }),

  defineCommand({
    type: "wall.remove",
    operationId: "removeWall",
    description: "Removes one wall, door or window (GM-grade only). `sceneId` targets a prepared scene.",
    summary: "Remove a wall, door or window (GM).",
    schema: WallRemoveSchema,
    malformed: "The wall command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }) {
      await execute((state) => removeWall(state, request.sceneId, request.wallId));
    }
  }),

  defineCommand({
    type: "wall.clear",
    operationId: "clearWalls",
    description: "Removes every wall, door and window from the scene (GM-grade only). `sceneId` targets a prepared scene.",
    summary: "Remove every wall, door and window (GM).",
    schema: WallClearSchema,
    malformed: "The wall command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }) {
      await execute((state) => clearWalls(state, request.sceneId));
    }
  }),

  defineCommand({
    type: "door.set-open",
    operationId: "setDoorOpen",
    description:
      "Opens or closes a door. The GM opens any door, on the live table or (with `sceneId`) a prepared scene; a player only one within 5 feet of their own character's token on the live table, with no wall between them.",
    summary: "Open or close a door; a player, one beside their own character.",
    schema: DoorSetOpenSchema,
    malformed: "The door command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { wallId, open, sceneId } = request;
      const player = isGmGrade(principal) ? null : principal;
      if (player && sceneId !== undefined) throw new GameAccessDeniedError("Only the GM can stage a prepared scene.");
      let opener: string | null = null;
      const { duplicate } = await execute((state) => {
        if (player) {
          const mine = playerViewerIds(state, player.sessionId);
          // Out of reach and unknown look the same, so a door the player hasn't found isn't confirmed.
          const reachable = mine.find((actorId) => doorWithinReach(state, wallId, [actorId]));
          if (reachable === undefined)
            throw new GameAccessDeniedError("Move your character next to the door to open or close it.");
          opener = reachable;
        }
        setDoorOpen(state, sceneId, wallId, open);
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
      "Places a light on the map at `position`, or gives one to a creature (`actorId`), which carries it as its token moves (GM-grade only). `brightFeet` is the Bright Light radius and `dimFeet` the Dim Light beyond it, as the SRD prints them (a Torch is 20 and 20). Lights matter where the ambient light is dark; walls and closed doors stop them. `sceneId` targets a prepared scene. Answers with the light's id, which is the commandId.",
    summary: "Place a light on the map or give one to a creature (GM).",
    schema: LightAddSchema,
    malformed: "The light is malformed.",
    issueMessage: true,
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      const { commandId, position, actorId, brightFeet, dimFeet, sceneId } = request;
      const geometry = await sceneGeometry(kit, sceneId);
      await execute((state) =>
        addLight(state, sceneId, geometry, {
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
    description: "Moves a light; a carried one is set down there (GM-grade only). `sceneId` targets a prepared scene.",
    summary: "Move a light (GM).",
    schema: LightMoveSchema,
    malformed: "The light move is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      const { lightId, position, sceneId } = request;
      const geometry = await sceneGeometry(kit, sceneId);
      await execute((state) => moveLight(state, sceneId, geometry, { lightId, position }));
    }
  }),

  defineCommand({
    type: "light.remove",
    operationId: "removeLight",
    description: "Removes a light (GM-grade only). `sceneId` targets a prepared scene.",
    summary: "Remove a light (GM).",
    schema: LightRemoveSchema,
    malformed: "The light command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }) {
      await execute((state) => removeLight(state, request.sceneId, request.lightId));
    }
  })
];
