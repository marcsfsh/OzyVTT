import {
  addAnnotation,
  addPing,
  clearAnnotations,
  moveAnnotation,
  removeAnnotation,
  setAnnotationColor,
  setAnnotationMovable,
  setAnnotationVisibility,
  type AnnotationActor
} from "../annotations.js";
import { GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import {
  AnnotationAddSchema,
  AnnotationClearSchema,
  AnnotationColorSetSchema,
  AnnotationMovableSetSchema,
  AnnotationMoveSchema,
  AnnotationPingSchema,
  AnnotationRemoveSchema,
  AnnotationVisibilitySetSchema,
  TokenMoveSchema
} from "../game-commands.js";
import { CommandRejectedError } from "../game-store.js";
import { applyMovementRules } from "../movement-rules.js";
import { creatureDistance, mapDistance, narrateTokenMove, type MovementNarration } from "../movement-narration.js";
import { moveEncounterToken, moveSceneToken } from "../token-placement.js";
import { gmGradeLabelOf, initiatorOf, isGmGrade, sessionIdOf, type GamePrincipal, type Kit } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Token movement and the drawings, measurements and pings on the encounter map.

function annotationActorOf(principal: GamePrincipal): AnnotationActor {
  return { sessionId: sessionIdOf(principal), role: isGmGrade(principal) ? "gm" : "player" };
}

/** The live encounter map and its geometry; `refusal` when no fight is running. */
async function liveMap(kit: Kit, refusal: string) {
  const mapAssetId = kit.read().combat.mapAssetId;
  if (!mapAssetId) throw new CommandRejectedError(refusal);
  return { mapAssetId, geometry: await kit.context.tokenGeometryFor(mapAssetId) };
}

/** The geometry was read before the command's turn in the queue; a scene switch in between voids it. */
function requireSameMap(mapAssetId: string | null, expected: string) {
  if (mapAssetId !== expected) throw new CommandRejectedError("The active encounter changed. Try again.");
}

export const mapCommands = [
  defineCommand({
    type: "token.move",
    operationId: "moveToken",
    description:
      "Moves a combatant's token; the server snaps to the calibrated grid. `position: null` returns the token to the tray. Player sessions may move only their claimed character. `sceneId` targets a prepared (GM-private) scene instead of the live table.",
    summary: "Move a combatant's token (server-snapped); position null returns it to the tray.",
    schema: TokenMoveSchema,
    malformed: "The token move is malformed.",
    async run({ principal, request, execute }, kit) {
      const { commandId, actorId, position, sceneId } = request;
      if (sceneId !== undefined) {
        // GM staging a prepared (off-table) scene privately. Geometry comes from that scene's own map.
        if (!isGmGrade(principal)) throw new GameAccessDeniedError("Only the GM can stage a prepared scene.");
        const scene = kit.read().combat.scenes.find((candidate) => candidate.id === sceneId);
        if (!scene) throw new CommandRejectedError("That scene no longer exists.");
        const sceneGeometry = await kit.context.tokenGeometryFor(scene.mapAssetId);
        await execute((state) => moveSceneToken(state, sceneId, actorId, position, sceneGeometry), {
          type: "token.move-scene"
        });
        return;
      }
      const mapAssetId = kit.read().combat.mapAssetId;
      if (!mapAssetId) throw new CommandRejectedError("Start an encounter before moving tokens.");
      if (request.override && !isGmGrade(principal))
        throw new GameAccessDeniedError("Only the GM can override movement rules.");
      const geometry = await kit.context.tokenGeometryFor(mapAssetId);
      let movement: MovementNarration | null | undefined;
      let movementWarning: string | null = null;
      let movementOverridden: string | null = null;
      const opportunityPrompts: Array<{ actorId: string; name: string }> = [];
      const { duplicate } = await execute((state) => {
        if (state.combat.mapAssetId !== mapAssetId)
          throw new CommandRejectedError("The active encounter changed. Try moving the token again.");
        requireActorAccess(
          initiatorOf(principal),
          state,
          actorId,
          "move",
          "You may only move your claimed character token."
        );
        const from = state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
        moveEncounterToken(state, actorId, position, geometry);
        // Narrate from the post-mutation state so logged distances are the snapped, authoritative ones.
        movement = narrateTokenMove({ state, actorId, from, geometry });
        // Movement budget and opportunity attacks (SRD), after the snap; a strict rejection discards the draft.
        const moverToken = state.combat.tokens.find((token) => token.actorId === actorId);
        const outcome = applyMovementRules(state, {
          actorId,
          from,
          to: moverToken?.position ?? null,
          distance: (a, b) => mapDistance(geometry, a, b)?.value ?? null,
          creatureDistance: (enemy, moverPoint) => {
            const enemyToken = state.combat.tokens.find((token) => token.actorId === enemy.actorId);
            if (!enemyToken || !moverToken) return null;
            return (
              creatureDistance(
                geometry,
                { position: enemy.position, sizeCells: enemyToken.sizeCells ?? 1, sizePx: enemyToken.sizePx },
                { position: moverPoint, sizeCells: moverToken.sizeCells ?? 1, sizePx: moverToken.sizePx }
              )?.value ?? null
            );
          },
          override: request.override ?? null,
          resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
          catalog: kit.equipmentCatalog(),
          newPromptId: kit.context.newId,
          now: Date.now,
          commandId
        });
        movementWarning = outcome.warning;
        movementOverridden = outcome.overridden;
        opportunityPrompts.push(...outcome.prompts);
      });
      if (duplicate) return;
      if (movement?.publicText)
        kit.context.appendLog({ kind: "movement", text: movement.publicText, actorIds: [actorId] });
      if (movement?.gmText) kit.context.appendLog({ kind: "movement", text: movement.gmText, gmOnly: true });
      if (movementWarning)
        kit.context.appendLog({
          kind: "movement",
          text: `Rules note: ${movementWarning}`,
          actorIds: [actorId],
          gmOnly: true
        });
      if (movementOverridden)
        kit.context.appendLog({
          kind: "override",
          text: `OVERRIDE (movement.exceeds-speed): ${kit.actorName(actorId)} moved beyond its speed - ${movementOverridden}`,
          actorIds: [actorId]
        });
      for (const prompt of opportunityPrompts)
        kit.context.broadcastTableEvent({
          kind: "reaction",
          text: `${prompt.name} may make an opportunity attack against ${kit.actorName(actorId)}.`,
          actorIds: [prompt.actorId],
          gmOnly: kit.actorHidden(prompt.actorId)
        });
    }
  }),

  defineCommand({
    type: "annotation.add",
    operationId: "addAnnotation",
    description:
      "Draws a measurement or area shape on the encounter map; the server snaps geometry to the grid. The response's `annotationId` equals the commandId.",
    summary: "Draw a measurement or area shape on the encounter map.",
    schema: AnnotationAddSchema,
    malformed: "The annotation is malformed.",
    async run({ principal, request, execute }, kit) {
      const { mapAssetId, geometry } = await liveMap(kit, "Start an encounter before adding to the map.");
      const { commandId, kind, shape, visibility, visibleToActorId, movableByOthers, color } = request;
      const { duplicate } = await execute((state) => {
        requireSameMap(state.combat.mapAssetId, mapAssetId);
        addAnnotation(
          state,
          {
            id: commandId,
            kind,
            shape,
            origin: request.geometry.origin,
            target: request.geometry.target,
            visibility: visibility ?? "public",
            visibleToActorId: visibleToActorId ?? null,
            movableByOthers,
            color,
            actor: annotationActorOf(principal),
            now: Date.now()
          },
          geometry
        );
      });
      if (!duplicate) kit.context.scheduleAnnotationExpiry();
      return { annotationId: commandId };
    }
  }),

  defineCommand({
    type: "annotation.ping",
    operationId: "pingMap",
    description: "Pings a point on the encounter map (ephemeral, labeled with the sender).",
    summary: "Ping a point on the encounter map.",
    schema: AnnotationPingSchema,
    malformed: "The ping is malformed.",
    async run({ principal, request, execute }, kit) {
      const { mapAssetId, geometry } = await liveMap(kit, "Start an encounter before pinging the map.");
      const { commandId, point, color } = request;
      const { duplicate } = await execute((state) => {
        requireSameMap(state.combat.mapAssetId, mapAssetId);
        const label = isGmGrade(principal)
          ? gmGradeLabelOf(principal)
          : (state.actors.find((candidate) => candidate.ownerSessionId === principal.sessionId)?.name ?? "A player");
        addPing(
          state,
          { id: commandId, point, label, color, actor: annotationActorOf(principal), now: Date.now() },
          geometry
        );
      });
      if (!duplicate) kit.context.scheduleAnnotationExpiry();
    }
  }),

  defineCommand({
    type: "annotation.move",
    operationId: "moveAnnotation",
    description: "Moves/resizes an annotation; the server re-snaps geometry.",
    summary: "Move or resize an annotation you may edit.",
    schema: AnnotationMoveSchema,
    malformed: "The annotation update is malformed.",
    async run({ principal, request, execute }, kit) {
      const { geometry } = await liveMap(kit, "Start an encounter before editing the map.");
      const { id, geometry: moved } = request;
      await execute((state) => {
        moveAnnotation(state, id, moved.origin, moved.target, annotationActorOf(principal), geometry);
      });
    }
  }),

  defineCommand({
    type: "annotation.remove",
    operationId: "removeAnnotation",
    description: "Removes one annotation (owners, the GM, and GM-grade integrations).",
    summary: "Remove an annotation you may edit.",
    schema: AnnotationRemoveSchema,
    malformed: "The annotation command is malformed.",
    async run({ principal, request, execute }) {
      await execute((state) => {
        removeAnnotation(state, request.id, annotationActorOf(principal));
      });
    }
  }),

  defineCommand({
    type: "annotation.set-color",
    operationId: "setAnnotationColor",
    description: "Changes an annotation's color.",
    summary: "Change an annotation's color.",
    schema: AnnotationColorSetSchema,
    malformed: "The color change is malformed.",
    async run({ principal, request, execute }) {
      await execute((state) => {
        setAnnotationColor(state, request.id, request.color, annotationActorOf(principal));
      });
    }
  }),

  defineCommand({
    type: "annotation.set-visibility",
    operationId: "setAnnotationVisibility",
    description: "Changes who can see an annotation (public, gm-only, owner-only, owner-gm, gm-actor).",
    summary: "Change who can see an annotation.",
    schema: AnnotationVisibilitySetSchema,
    malformed: "The visibility change is malformed.",
    async run({ principal, request, execute }) {
      const { id, visibility, visibleToActorId } = request;
      await execute((state) => {
        setAnnotationVisibility(state, id, visibility, visibleToActorId ?? null, annotationActorOf(principal));
      });
    }
  }),

  defineCommand({
    type: "annotation.set-movable",
    operationId: "setAnnotationMovable",
    description: "Allows or disallows other players moving a shape.",
    summary: "Allow or disallow other players moving a shape.",
    schema: AnnotationMovableSetSchema,
    malformed: "The move-control change is malformed.",
    async run({ principal, request, execute }) {
      await execute((state) => {
        setAnnotationMovable(state, request.id, request.movableByOthers, annotationActorOf(principal));
      });
    }
  }),

  defineCommand({
    type: "annotation.clear",
    operationId: "clearAnnotations",
    description: "Clears drawn shapes: your own, all player shapes (GM-grade), or everything (GM-grade).",
    summary: "Clear drawn shapes by scope (mine/players/all).",
    schema: AnnotationClearSchema,
    malformed: "The clear command is malformed.",
    async run({ principal, request, execute }) {
      await execute((state) => {
        clearAnnotations(state, request.scope, annotationActorOf(principal));
      });
    }
  })
];
