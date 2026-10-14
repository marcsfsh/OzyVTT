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
  SceneSetCombatantsSchema
} from "../game-commands.js";
import { CommandRejectedError } from "../game-store.js";
import { launchReplay } from "../replay-launch.js";
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

// Prepared scenes, launching a recorded moment, and the fog of war. All of it is the GM's.

export const sceneCommands = [
  defineCommand({
    type: "scene.create",
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
          timeline.truncateAll();
        }
      });
      // Going live also presents the map on the shared screen.
      if (!duplicate && activate === true && state.combat.mapAssetId)
        await kit.context.presentSceneMap(state.combat.mapAssetId);
      return { sceneId: commandId };
    }
  }),

  defineCommand({
    type: "scene.rename",
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
    summary: "Switch the live table to a prepared scene, parking the current one (GM).",
    schema: SceneIdSchema,
    malformed: "The scene command is malformed.",
    gmOnly: "Only the GM can switch scenes.",
    async run({ request, executeTimeline }, kit) {
      const { commandId, sceneId } = request;
      const { state, duplicate } = await executeTimeline((draft, timeline) => {
        activateScene(draft, sceneId, commandId); // rejects while rewound
        // Snapshots belong to the scene that was live; the swap invalidates them.
        timeline.truncateAll();
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
          text: `This scene still stages ${resumedArchived.length} archived character${resumedArchived.length === 1 ? "" : "s"} (${resumedArchived.map((actor) => actor.name).join(", ")}) - restore or remove them.`,
          gmOnly: true
        });
      // Going live also presents the scene's map on the shared screen.
      if (state.combat.mapAssetId) await kit.context.presentSceneMap(state.combat.mapAssetId);
    }
  }),

  defineCommand({
    type: "scene.set-combatants",
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
    summary:
      "Launch one recorded moment of an archived fight onto the live table, parking the current scene; the moment's combatants are cloned under new ids so live characters are never rewritten (GM).",
    schema: ReplayLaunchSchema,
    malformed: "The replay launch is malformed.",
    gmOnly: "Only the GM can launch a replay.",
    // The typed route lives on the archive it replays, so its `{id}` is the archive's number.
    pathParams: (params) => ({ archiveId: Number(params.id) }),
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
        timeline.truncateAll();
      });
      if (!outcome) return;
      if (!duplicate) {
        kit.context.appendLog({
          kind: "scene",
          text: `Launched a recorded moment: "${outcome.label}". The table you were on is parked - switch back any time.`,
          gmOnly: true
        });
        if (state.combat.mapAssetId) await kit.context.presentSceneMap(state.combat.mapAssetId);
      }
      return { sceneId: outcome.scene.id, actorIds: outcome.actorIds };
    }
  }),

  defineCommand({
    type: "fog.set-enabled",
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
          text: enabled ? "Fog of war enabled - unrevealed ground is hidden from players." : "Fog of war disabled.",
          gmOnly: true
        });
    }
  }),

  defineCommand({
    type: "fog.paint",
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
    summary: "Hide the whole map again (clear every fog stroke) (GM).",
    schema: FogResetSchema,
    malformed: "The fog command is malformed.",
    gmOnly: "Only the GM controls the fog of war.",
    async run({ request, execute }) {
      await execute((state) => resetFog(state, request.sceneId));
    }
  })
];
