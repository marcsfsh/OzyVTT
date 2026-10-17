import {
  addAnnotation,
  addPing,
  clearAnnotations,
  moveAnnotation,
  removeAnnotation,
  setAnnotationColor,
  setAnnotationMovable,
  setAnnotationVisibility,
  templateOfArea,
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
  SpellZoneEndSchema,
  SpellZonePlaceSchema,
  TokenMoveSchema
} from "@vtt/domain/commands";
import { CommandRejectedError } from "../game-store.js";
import { applyMovementRules, dragAlong, dragCostsExtra, grappledBy } from "../movement-rules.js";
import {
  creatureDistance,
  DISTANCE_TOLERANCE_FEET,
  mapDistance,
  narrateTokenMove,
  tokenCreatureDistance,
  type MovementNarration
} from "../movement-narration.js";
import { releaseGrapplesOutOfRange, type EffectNarration } from "../effects.js";
import { endZone } from "../spell-zone-state.js";
import { placeZone, speedHalvingAt, zonesAfterAreaMove, zonesAfterMove } from "../spell-zones.js";
import { movementCost } from "../terrain.js";
import { moveEncounterToken, moveSceneToken } from "../token-placement.js";
import { HIDDEN_SOURCE } from "../hidden-source.js";
import { sceneSight } from "../vision/sight.js";
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
      "Moves a combatant's token; the server snaps to the calibrated grid. `position: null` returns the token to the tray. `mode` says how it travels: walking (default) or a special speed (`fly`, `swim`, `climb`, `burrow`) spends movement, `teleport` spends none and provokes no Opportunity Attack, and `forced` (GM only) is a creature moved against its will. A grappler drags the creatures it grapples along. Player sessions may move only their claimed character, and only once a fight is running; in a fight, moving it off its turn or teleporting is the GM's to allow, and only the GM takes a placed token back to the tray. Before a fight the GM places tokens on the live scene without narration. `sceneId` targets a prepared (GM-private) scene instead of the live table.",
    summary:
      "Move a combatant's token (server-snapped) walking, by a special speed, teleporting or by force; position null returns it to the tray.",
    schema: TokenMoveSchema,
    malformed: "The token move is malformed.",
    async run({ principal, request, execute }, kit) {
      const { commandId, actorId, position, sceneId } = request;
      const mode = request.mode ?? "walk";
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
      if (!mapAssetId) throw new CommandRejectedError("Make a scene live before moving tokens.");
      if (request.override && !isGmGrade(principal))
        throw new GameAccessDeniedError("Only the GM can override movement rules.");
      if (mode === "forced" && !isGmGrade(principal))
        throw new GameAccessDeniedError("Only the GM moves a creature by force.");
      const geometry = await kit.context.tokenGeometryFor(mapAssetId);
      let movement: MovementNarration | null | undefined;
      let movementWarning: string | null = null;
      let movementOverridden: string | null = null;
      const opportunityPrompts: Array<{ actorId: string; name: string }> = [];
      let released: EffectNarration[] = [];
      const zoneEvents: EffectNarration[] = [];
      const draggedNames: string[] = [];
      let moverHiddenAtStart = false;
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
        // Before a fight the GM sets the scene; players move their own tokens once it starts.
        if (!state.combat.active && !isGmGrade(principal))
          throw new CommandRejectedError("Your GM places the tokens before the fight starts.");
        const from = state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
        // Dynamic vision, as the mover set off: what it perceived, and who saw it go. A player's move also passes over
        // the creatures hidden from them under the fog, as their preview does.
        const sight = sceneSight(state, kit.sightContent());
        const perceivedAtStart = sight.enabled ? sight.perceivedBy([actorId]) : null;
        const unseenByMover = kit.unseenBy(initiatorOf(principal), state);
        const perceives =
          perceivedAtStart || unseenByMover.size > 0
            ? (id: string) => (perceivedAtStart?.has(id) ?? true) && !unseenByMover.has(id)
            : null;
        const seenAtStart = sight.enabled
          ? new Set(state.actors.filter((actor) => sight.sees(actor.id, actorId)).map((actor) => actor.id))
          : null;
        // Hidden from the table as it set off (the shared check): it provokes no player's opportunity attack, and the
        // table's line about it can't say where it came from.
        moverHiddenAtStart = kit.hiddenFromTable(state)(actorId);
        // Taking a placed token off the map mid-fight would move it for free.
        if (position === null && from !== null && !isGmGrade(principal) && state.combat.active)
          throw new CommandRejectedError("Only the GM takes a token off the map during a fight.");
        // A grappler drags what it holds (SRD Grappled: "Movable"); teleporting or being moved by force doesn't.
        const dragged =
          from !== null &&
          position !== null &&
          (mode === "walk" || mode === "fly" || mode === "swim" || mode === "climb" || mode === "burrow")
            ? grappledBy(state, actorId).filter(
                (heldId) => state.combat.tokens.find((token) => token.actorId === heldId)?.position
              )
            : [];
        moveEncounterToken(state, actorId, position, geometry);
        // Movement budget and opportunity attacks (SRD), after the snap; a strict rejection discards the draft.
        const moverToken = state.combat.tokens.find((token) => token.actorId === actorId);
        const outcome = applyMovementRules(state, {
          actorId,
          from,
          to: moverToken?.position ?? null,
          mode,
          byPlayer: !isGmGrade(principal),
          distance: (a, b) => mapDistance(geometry, a, b)?.value ?? null,
          cost: (a, b, options) => {
            const halvedAt = speedHalvingAt(state, actorId, kit.zoneDeps(state, geometry));
            return movementCost(state, geometry, actorId, a, b, { ...options, ...(halvedAt ? { halvedAt } : {}) });
          },
          calibration: geometry.calibration,
          dragging: {
            actorIds: dragged,
            costsExtra: dragCostsExtra(state, actorId, dragged, (definitionId) =>
              kit.resolveDefinitionIn(state, definitionId)
            )
          },
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
          ...(perceives ? { perceives } : {}),
          ...(seenAtStart ? { seenBy: (id: string) => seenAtStart.has(id) } : {}),
          moverHiddenFromPlayers: moverHiddenAtStart,
          newPromptId: kit.context.newId,
          now: Date.now,
          commandId
        });
        movementWarning = outcome.warning;
        movementOverridden = outcome.overridden;
        opportunityPrompts.push(...outcome.prompts);
        // A spell area the move enters (or that its mover carries over others) acts on whoever it meets.
        const arrived = moverToken?.position ?? null;
        if (from !== null && arrived !== null) {
          const path =
            mode === "teleport"
              ? [from, arrived]
              : (movementCost(state, geometry, actorId, from, arrived)?.path ?? [from, arrived]);
          zoneEvents.push(
            ...zonesAfterMove(
              state,
              { moverId: actorId, path, teleported: mode === "teleport" },
              kit.zoneDeps(state, geometry)
            )
          );
        }
        // Narrate from the post-mutation state so logged distances are the snapped, authoritative ones.
        // A creature hidden from the table after the move is left out of the table's line. Setting the scene before
        // a fight tells the table nothing: the feed narrates moves in a fight.
        const hiddenAfter = kit.hiddenFromTable(state);
        movement = state.combat.active
          ? narrateTokenMove({
              state,
              actorId,
              from,
              geometry,
              mode,
              crawled: outcome.crawled,
              hiddenFromTable: hiddenAfter,
              fromHiding: moverHiddenAtStart
            })
          : null;
        const to = moverToken?.position ?? null;
        if (from !== null && to !== null)
          for (const heldId of dragAlong(state, dragged, from, to, geometry)) {
            draggedNames.push(hiddenAfter(heldId) ? HIDDEN_SOURCE : kit.actorName(heldId));
            // A creature dragged along meets the spell areas it is dragged into.
            const held = state.combat.tokens.find((token) => token.actorId === heldId)?.position;
            if (held)
              zoneEvents.push(
                ...zonesAfterMove(
                  state,
                  { moverId: heldId, path: [{ x: held.x - to.x + from.x, y: held.y - to.y + from.y }, held] },
                  kit.zoneDeps(state, geometry)
                )
              );
          }
        // SRD Grappling: a grapple ends once the two are farther apart than its range.
        released = releaseGrapplesOutOfRange(
          state,
          actorId,
          (a, b) => tokenCreatureDistance(state, geometry, a, b)?.value ?? null,
          DISTANCE_TOLERANCE_FEET
        );
      });
      if (duplicate) return;
      kit.publishNarrations(released);
      if (movement?.publicText)
        kit.context.appendLog({ kind: "movement", text: movement.publicText, actorIds: [actorId] });
      if (draggedNames.length > 0)
        kit.context.appendLog({
          kind: "movement",
          text: `${kit.actorName(actorId)} drags ${draggedNames.join(" and ")} along.`,
          actorIds: [actorId],
          gmOnly: kit.actorHidden(actorId)
        });
      if (movement?.gmText) kit.context.appendLog({ kind: "movement", text: movement.gmText, gmOnly: true });
      // What the spell areas did to the mover follows the move itself.
      kit.publishNarrations(zoneEvents);
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
          text: `OVERRIDE (movement): ${kit.actorName(actorId)} moved past a movement rule - ${movementOverridden}`,
          actorIds: [actorId]
        });
      // A GM creature's prompt against a mover hidden from the table names it as the projection does.
      const moverName = moverHiddenAtStart || kit.actorHidden(actorId) ? HIDDEN_SOURCE : kit.actorName(actorId);
      for (const prompt of opportunityPrompts)
        kit.context.broadcastTableEvent({
          kind: "reaction",
          text: `${prompt.name} may make an opportunity attack against ${moverName}.`,
          actorIds: [prompt.actorId],
          gmOnly: kit.actorHidden(prompt.actorId)
        });
    }
  }),

  defineCommand({
    type: "spell-zone.place",
    operationId: "placeSpellZone",
    description:
      "Places a spell's lingering area on the encounter map (GM-grade only): the area a cast left (Moonbeam, Web, Spirit Guardians' is the caster's own), which a player's cast leaves unplaced until the GM draws it. The template snaps like an area template and replaces any earlier area of that spell; from then on the server raises the area's save or deals its damage when a creature enters it or starts or ends its turn there. Placing it catches no one: the cast made its save.",
    summary: "Place a spell's lingering area on the map so the server runs it (GM).",
    schema: SpellZonePlaceSchema,
    malformed: "The spell-area command is malformed.",
    gmOnly: "Only the GM places a spell's area.",
    async run({ principal, request, execute }, kit) {
      const { mapAssetId, geometry } = await liveMap(kit, "Start an encounter before placing a spell's area.");
      if (!geometry.calibration) throw new CommandRejectedError("Calibrate this map before placing a spell's area.");
      const { commandId, zoneId, template } = request;
      await execute((state) => {
        requireSameMap(state.combat.mapAssetId, mapAssetId);
        const zone = state.combat.spellZones.find((candidate) => candidate.id === zoneId);
        if (!zone) throw new CommandRejectedError("That spell's area has already ended.");
        // The spell's own area decides the shape and the size; the drag only places and points it.
        const placed = zone.area ? templateOfArea(geometry.calibration!, template, zone.area) : template;
        addAnnotation(
          state,
          {
            id: commandId,
            kind: "shape",
            shape: placed.shape,
            origin: placed.origin,
            target: placed.target,
            visibility: "public",
            reachesPastMap: zone.area !== null,
            actor: annotationActorOf(principal),
            now: Date.now()
          },
          geometry
        );
        placeZone(state, zoneId, commandId);
      });
    }
  }),

  defineCommand({
    type: "spell-zone.end",
    operationId: "endSpellZone",
    description:
      "Ends a spell's lingering area (GM-grade only), removing it from the map: webs burned away, a guardian dismissed, or a ruling. The caster's Concentration on the spell is untouched; ending that ends the area too.",
    summary: "End a spell's lingering area (GM).",
    schema: SpellZoneEndSchema,
    malformed: "The spell-area command is malformed.",
    gmOnly: "Only the GM ends a spell's area.",
    async run({ request, execute }, kit) {
      let name = "";
      const { duplicate } = await execute((state) => {
        const zone = state.combat.spellZones.find((candidate) => candidate.id === request.zoneId);
        if (!zone) throw new CommandRejectedError("That spell's area has already ended.");
        name = zone.name;
        endZone(state, zone.id);
      });
      if (!duplicate && name) kit.context.appendLog({ kind: "encounter", text: `${name} ends.`, gmOnly: true });
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
      const { mapAssetId, geometry } = await liveMap(kit, "Make a scene live before adding to the map.");
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
      const { mapAssetId, geometry } = await liveMap(kit, "Make a scene live before pinging the map.");
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
      const { geometry } = await liveMap(kit, "Make a scene live before editing the map.");
      const { id, geometry: moved } = request;
      const zoneEvents: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        const before = state.combat.annotations.find((annotation) => annotation.id === id)?.geometry;
        moveAnnotation(state, id, moved.origin, moved.target, annotationActorOf(principal), geometry);
        // A spell's area moved onto creatures (Moonbeam's Cylinder, a drifting cloud) acts on them.
        if (before) zoneEvents.push(...zonesAfterAreaMove(state, id, before, kit.zoneDeps(state, geometry)));
      });
      if (!duplicate) kit.publishNarrations(zoneEvents);
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
