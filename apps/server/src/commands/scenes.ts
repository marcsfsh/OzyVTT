import { EncounterArchiveLaunchSchema } from "@vtt/api-contract";
import type { EncounterArchiveDocument } from "../encounter-archive.js";
import { paintFog, resetFog, setFogEnabled } from "../fog.js";
import {
  FogPaintSchema,
  FogResetSchema,
  FogSetEnabledSchema,
  ReplayLaunchSchema,
  SceneCreateSchema,
  SceneIdSchema,
  SceneRenameSchema,
  SceneReorderSchema,
  SceneSetCombatantsSchema,
  TerrainPaintSchema,
  TerrainResetSchema
} from "@vtt/domain/commands";
import { restartTimeline } from "../combat-history.js";
import { CommandRejectedError } from "../game-store.js";
import { launchReplay } from "../replay-launch.js";
import { paintTerrain, resetTerrain } from "../terrain.js";
import {
  activateScene,
  createScene,
  duplicateScene,
  removeScene,
  renameScene,
  reorderScenes,
  setSceneCombatants
} from "../scenes.js";
import { defineCommand } from "./pipeline.js";

// Prepared scenes, launching a recorded moment, the fog of war and difficult terrain. All of it is the GM's.

export const sceneCommands = [
  defineCommand({
    type: "scene.create",
    operationId: "createScene",
    description:
      "Prepares a staged scene on a battlemap, privately, without touching the live table (GM-grade only). The response's `sceneId` equals the commandId.",
    summary:
      "Prepare a staged scene on a battlemap without touching the live table, or go live on it in the same command (GM).",
    schema: SceneCreateSchema,
    malformed: "The scene setup is malformed.",
    gmOnly: "Only the GM can prepare scenes.",
    async run({ request, executeTimeline }, kit) {
      const sceneMap = kit.context.mapCatalog.get(request.mapAssetId);
      if (!sceneMap || sceneMap.kind !== "battlemap")
        throw new CommandRejectedError("Prepare scenes on an uploaded battlemap.");
      const { commandId, name, mapAssetId, combatantIds, activate } = request;
      const geometry = await kit.context.tokenGeometryFor(mapAssetId);
      const implicitSceneId = kit.context.newId();
      // `activate` runs the same park/resume swap as `scene.activate` (and inherits its refusals), hence
      // executeTimeline and truncation.
      const { state, duplicate } = await executeTimeline((draft, timeline) => {
        createScene(draft, { sceneId: commandId, name, mapAssetId, combatantIds }, geometry);
        if (activate === true) {
          // The implicit-scene id must not be the commandId: the new scene already owns it.
          activateScene(draft, commandId, implicitSceneId);
          restartTimeline(draft, timeline);
        }
      });
      // Going live also presents the map on the shared screen and starts the scene's sound.
      if (!duplicate && activate === true && state.combat.mapAssetId)
        await kit.context.presentSceneMap(state.combat.mapAssetId);
      if (!duplicate && activate === true) await kit.context.sound?.sceneWentLive(commandId, state.revision);
      return { sceneId: commandId };
    }
  }),

  defineCommand({
    type: "scene.rename",
    operationId: "renameScene",
    description: "Renames a prepared scene (GM-grade only).",
    summary: "Rename a prepared scene (GM).",
    schema: SceneRenameSchema,
    malformed: "The scene rename is malformed.",
    gmOnly: "Only the GM can rename scenes.",
    async run({ request, execute }) {
      await execute((state) => renameScene(state, request.sceneId, request.name));
    }
  }),

  defineCommand({
    type: "scene.remove",
    operationId: "removeScene",
    description: "Removes a prepared scene (GM-grade only); the active scene cannot be removed.",
    summary: "Remove a prepared scene (GM).",
    schema: SceneIdSchema,
    malformed: "The scene command is malformed.",
    gmOnly: "Only the GM can remove scenes.",
    async run({ request, execute }) {
      await execute((state) => removeScene(state, request.sceneId));
    }
  }),

  defineCommand({
    type: "scene.activate",
    operationId: "activateScene",
    description:
      "Switches the live table to a prepared scene and parks the current one non-destructively (GM-grade only). Rejected while the timeline is rewound; the turn-snapshot timeline restarts for the newly live scene.",
    summary: "Switch the live table to a prepared scene and park the current one (GM).",
    schema: SceneIdSchema,
    malformed: "The scene command is malformed.",
    gmOnly: "Only the GM can switch scenes.",
    async run({ request, executeTimeline }, kit) {
      const { commandId, sceneId } = request;
      const { state, duplicate } = await executeTimeline((draft, timeline) => {
        activateScene(draft, sceneId, commandId); // rejects while rewound
        // Snapshots belong to the scene that was live; the swap invalidates them.
        restartTimeline(draft, timeline);
      });
      if (duplicate) return;
      const scene = state.combat.scenes.find((candidate) => candidate.id === sceneId);
      kit.context.appendLog({ kind: "scene", text: `Switched to scene "${scene?.name ?? "Untitled"}".`, gmOnly: true });
      // Older prepared scenes may still hold archived characters. Activation does not refuse (that would
      // strand the scene); the GM is told instead.
      const resumedArchived = state.combat.initiative
        .map((entry) => state.actors.find((actor) => actor.id === entry.actorId))
        .filter((actor): actor is NonNullable<typeof actor> => actor !== undefined && actor.archived);
      if (resumedArchived.length > 0)
        kit.context.appendLog({
          kind: "scene",
          text: `This scene still stages ${resumedArchived.length} archived character${resumedArchived.length === 1 ? "" : "s"} (${resumedArchived.map((actor) => actor.name).join(", ")}). Restore or remove ${resumedArchived.length === 1 ? "it" : "them"}.`,
          gmOnly: true
        });
      // Going live also presents the scene's map on the shared screen and starts its sound.
      if (state.combat.mapAssetId) await kit.context.presentSceneMap(state.combat.mapAssetId);
      await kit.context.sound?.sceneWentLive(sceneId, state.revision);
    }
  }),

  defineCommand({
    type: "scene.set-combatants",
    operationId: "setSceneCombatants",
    description: "Replaces a prepared scene's combatant list (GM-grade only).",
    summary: "Replace a prepared scene's combatant list (GM).",
    schema: SceneSetCombatantsSchema,
    malformed: "The scene update is malformed.",
    gmOnly: "Only the GM can change a scene's combatants.",
    async run({ request, execute }, kit) {
      const { sceneId, combatantIds } = request;
      const scene = kit.read().combat.scenes.find((candidate) => candidate.id === sceneId);
      if (!scene) throw new CommandRejectedError("That scene no longer exists.");
      const geometry = await kit.context.tokenGeometryFor(scene.mapAssetId);
      await execute((state) => setSceneCombatants(state, sceneId, combatantIds, geometry));
    }
  }),

  defineCommand({
    type: "scene.duplicate",
    operationId: "duplicateScene",
    description:
      "Duplicates a prepared scene as a new staged copy carrying the same map and staged combatants/tokens (GM-grade only). Duplicating the live scene snapshots its current combat into the copy; the copy is always parked, next to the original. The response's `sceneId` equals the commandId.",
    summary: "Duplicate a prepared scene as a new staged copy (GM).",
    schema: SceneIdSchema,
    malformed: "The scene command is malformed.",
    gmOnly: "Only the GM can duplicate scenes.",
    async run({ request, execute }) {
      await execute((state) => {
        duplicateScene(state, request.sceneId, request.commandId);
      });
      return { sceneId: request.commandId };
    }
  }),

  defineCommand({
    type: "scene.reorder",
    operationId: "reorderScenes",
    description:
      "Reorders the prepared-scene list to the given permutation of every scene id (GM-grade only). Does not change which scene is live.",
    summary: "Reorder the prepared-scene list (GM).",
    schema: SceneReorderSchema,
    malformed: "The scene order is malformed.",
    gmOnly: "Only the GM can reorder scenes.",
    async run({ request, execute }) {
      await execute((state) => reorderScenes(state, request.order));
    }
  }),

  defineCommand({
    type: "replay.launch",
    operationId: "launchEncounterArchive",
    description:
      "Parks the live table exactly as a scene switch does and makes one recorded moment of this archive live on it (GM-grade only). The moment's combatants are cloned under new ids, so tonight's characters are never rewritten, and the parked scene resumes any time through scene.activate.",
    summary:
      "Launch one recorded moment of an archived fight onto the live table and park the current scene; the moment's combatants are cloned under new ids so live characters are never rewritten (GM).",
    schema: ReplayLaunchSchema,
    malformed: "The replay launch is malformed.",
    gmOnly: "Only the GM can launch a replay.",
    // The typed route lives on the archive it replays, so its `{id}` is the archive's number.
    pathParams: (params) => ({ archiveId: Number(params.id) }),
    reply: { schema: EncounterArchiveLaunchSchema, description: "The launched scene and the cloned combatants." },
    // Parks the live table like `scene.activate` and goes live on a recorded moment.
    async run({ request, executeTimeline }, kit) {
      const { commandId, archiveId, turnIndex } = request;
      if (!kit.context.archiveDocument)
        throw new CommandRejectedError("Recorded fights are not available on this server.");
      const stored = kit.context.archiveDocument(archiveId);
      if (stored === null) throw new CommandRejectedError("No such recorded fight.");
      let document: EncounterArchiveDocument;
      try {
        document = JSON.parse(stored) as EncounterArchiveDocument;
      } catch {
        throw new CommandRejectedError("That recording could not be read.");
      }
      let outcome: ReturnType<typeof launchReplay> | undefined;
      const { state, duplicate } = await executeTimeline((draft, timeline) => {
        outcome = launchReplay(draft, {
          archiveId,
          document,
          turnIndex,
          sceneId: commandId,
          implicitSceneId: `${commandId.slice(0, 35)}-p`,
          newActorId: kit.context.newId
        });
        // The snapshots belonged to the fight that just parked; the swap invalidates them.
        restartTimeline(draft, timeline);
      });
      if (!outcome) return;
      if (!duplicate) {
        kit.context.appendLog({
          kind: "scene",
          text: `Launched a recorded moment: "${outcome.label}". The table you were on is parked. Switch back any time.`,
          gmOnly: true
        });
        if (state.combat.mapAssetId) await kit.context.presentSceneMap(state.combat.mapAssetId);
      }
      return { sceneId: outcome.scene.id, actorIds: outcome.actorIds };
    }
  }),

  defineCommand({
    type: "fog.set-enabled",
    operationId: "setFogEnabled",
    description:
      "Turns manual fog of war on/off (GM-grade only). Enabled fog with no reveal strokes hides the whole map from players and the shared screen; `sceneId` targets a prepared scene's private prep; without it, the live table.",
    summary: "Turn manual fog of war on/off for the live table or a prepared scene (GM).",
    schema: FogSetEnabledSchema,
    malformed: "The fog command is malformed.",
    gmOnly: "Only the GM controls the fog of war.",
    async run({ request, execute }, kit) {
      const { enabled, sceneId } = request;
      const { duplicate } = await execute((state) => setFogEnabled(state, sceneId, enabled));
      if (!duplicate && sceneId === undefined)
        kit.context.appendLog({
          kind: "scene",
          text: enabled ? "Fog of war is on. Unrevealed ground is hidden from players." : "Fog of war is off.",
          gmOnly: true
        });
    }
  }),

  defineCommand({
    type: "fog.paint",
    operationId: "paintFog",
    description:
      "Paints one reveal/hide fog rect (GM-grade only). The server snaps to whole grid cells on calibrated unrotated maps and clamps to the map bounds; a stroke covering the whole map replaces all prior strokes. `sceneId` targets a prepared scene.",
    summary: "Paint a reveal/hide fog rect, grid-snapped and clamped to the map (GM).",
    schema: FogPaintSchema,
    malformed: "The fog stroke is malformed.",
    gmOnly: "Only the GM controls the fog of war.",
    async run({ request, execute }, kit) {
      const { op, rect, sceneId } = request;
      // Geometry comes from the stroke's target map: the live table's or the parked scene's.
      const combat = kit.read().combat;
      const mapAssetId =
        sceneId === undefined
          ? combat.mapAssetId
          : (combat.scenes.find((scene) => scene.id === sceneId)?.mapAssetId ?? null);
      if (!mapAssetId) throw new CommandRejectedError("Pick a map before painting fog.");
      const geometry = await kit.context.tokenGeometryFor(mapAssetId);
      const shapeId = kit.context.newId();
      await execute((state) => paintFog(state, sceneId, geometry, { id: shapeId, op, rect }));
    }
  }),

  defineCommand({
    type: "fog.reset",
    operationId: "resetFog",
    description:
      "Clears every fog stroke, so with fog on the whole map is hidden again (GM-grade only). `sceneId` targets a prepared scene.",
    summary: "Hide the whole map again (clear every fog stroke) (GM).",
    schema: FogResetSchema,
    malformed: "The fog command is malformed.",
    gmOnly: "Only the GM controls the fog of war.",
    async run({ request, execute }) {
      await execute((state) => resetFog(state, request.sceneId));
    }
  }),

  defineCommand({
    type: "terrain.paint",
    operationId: "paintTerrain",
    description:
      "Marks a dragged area as difficult terrain, or clears it (GM-grade only). The server snaps to whole grid cells on calibrated unrotated maps and clamps to the map bounds; a map needs a calibrated grid. Entering a cell whose centre lies in difficult terrain costs double. `sceneId` targets a prepared scene.",
    summary: "Mark or clear difficult terrain over a grid-snapped area (GM).",
    schema: TerrainPaintSchema,
    malformed: "The terrain stroke is malformed.",
    gmOnly: "Only the GM marks terrain.",
    async run({ request, execute }, kit) {
      const { op, rect, sceneId } = request;
      const combat = kit.read().combat;
      const mapAssetId =
        sceneId === undefined
          ? combat.mapAssetId
          : (combat.scenes.find((scene) => scene.id === sceneId)?.mapAssetId ?? null);
      if (!mapAssetId) throw new CommandRejectedError("Pick a map before marking terrain.");
      const geometry = await kit.context.tokenGeometryFor(mapAssetId);
      await execute((state) => paintTerrain(state, sceneId, geometry, { op, rect }));
    }
  }),

  defineCommand({
    type: "terrain.reset",
    operationId: "resetTerrain",
    description:
      "Clears all difficult terrain from the live table or, with `sceneId`, a prepared scene (GM-grade only).",
    summary: "Clear all difficult terrain (GM).",
    schema: TerrainResetSchema,
    malformed: "The terrain command is malformed.",
    gmOnly: "Only the GM marks terrain.",
    async run({ request, execute }) {
      await execute((state) => resetTerrain(state, request.sceneId));
    }
  })
];
