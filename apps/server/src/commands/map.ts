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
import type { GameState } from "@vtt/domain";
import { pointInRects } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import type { TokenMapGeometry } from "../token-placement.js";
import { GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { requireStartOrdered } from "../simultaneous-effects.js";
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
  ActorFallSchema,
  ActorMountSchema,
  TokenMoveSchema,
  TokenSetAltitudeSchema
} from "@vtt/domain/commands";
import { CommandRejectedError } from "../game-store.js";
import { airborneAfter, altitudeOf, setAltitude } from "../altitude.js";
import { endsOnLanding, startFall } from "../falling.js";
import { failedTeleport, landTeleport } from "../granted-moves.js";
import { holdMove } from "../held-moves.js";
import { walkThroughZones } from "../zone-stops.js";
import { landJump } from "../jumping.js";
import { askToStayMounted, carryRiders, mountOf, mountOrDismount, parted, ridersOf } from "../mounts.js";
import { timeStopOutOfRange } from "../time-stop.js";
import { applyMovementRules, dragAlong, dragCostsExtra, grappledBy } from "../movement-rules.js";
import { swallowedBy } from "../swallow.js";
import {
  creatureDistance,
  DISTANCE_TOLERANCE_FEET,
  footprintOf,
  mapDistance,
  narrateTokenMove,
  tokenCreatureDistance,
  type MovementNarration
} from "../movement-narration.js";
import { releaseGrapplesOutOfRange, type EffectNarration } from "../effects.js";
import { endZoneAndItsSpell, placeZone, zonesAfterAreaMove, zonesAfterMove } from "../spell-zones.js";
import { spaceEntryAfterMove } from "../space-entry.js";
import { isNimble, passesCreatures } from "../space-sharing.js";
import { fireFormBurns } from "../wall-passage.js";
import { teleportOutOfCage } from "../forcecage.js";
import { zoneContentOf } from "../spell-zone-state.js";
import { policeBarrier, shellsForcedBy, teleportBarredAt } from "../zone-barriers.js";
import { zoneMovementOptions } from "../zone-ground.js";
import { movementCost } from "../terrain.js";
import { moveEncounterToken, moveSceneToken } from "../token-placement.js";
import { HIDDEN_SOURCE } from "../hidden-source.js";
import { insidePolygon } from "../vision/geometry.js";
import { sceneSight } from "../vision/sight.js";
import { gmGradeLabelOf, initiatorOf, isGmGrade, sessionIdOf, type GamePrincipal, type Kit } from "./kit.js";
import { offerNearbyReactions } from "../triggered-reactions.js";
import { defineCommand } from "./pipeline.js";

// Token movement and the drawings, measurements and pings on the encounter map.

function annotationActorOf(principal: GamePrincipal): AnnotationActor {
  return { sessionId: sessionIdOf(principal), role: isGmGrade(principal) ? "gm" : "player" };
}

/** The way a move went for the spaces it entered, when the movement rules didn't measure it: a creature that may stop
 *  in others' spaces (Air Form) goes through them, and any creature may go into a swarm's or a gelatinous cube's. */
function entryPathOf(
  state: GameState,
  geometry: TokenMapGeometry,
  actorId: string,
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
  deps: Readonly<{ resolveDefinition: (definitionId: string) => ActorDefinition | undefined }>
): ReadonlyArray<Readonly<{ x: number; y: number }>> {
  const definitionId = state.actors.find((actor) => actor.id === actorId)?.definitionId;
  const definition = definitionId ? deps.resolveDefinition(definitionId) : undefined;
  const cost = movementCost(state, geometry, actorId, from, to, {
    resolveDefinition: deps.resolveDefinition,
    ...(passesCreatures(definition) ? { passesCreatures: true } : {}),
    ...(isNimble(definition) ? { nimble: true } : {})
  });
  return cost?.path && cost.path.length > 1 ? cost.path : [from, to];
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
      "Moves a combatant's token; the server snaps to the calibrated grid. `position: null` returns the token to the tray. `mode` says how it travels: walking (default) or a special speed (`fly`, `swim`, `climb`, `burrow`) spends movement, `jump` leaps straight over what lies between up to the jump distance (a foot of movement for each foot), `teleport` spends none and provokes no Opportunity Attack, and `forced` (GM only) is a creature moved against its will. A grappler drags the creatures it grapples along. Player sessions may move only their claimed character, and only once a fight is running; in a fight, moving it off its turn or teleporting is the GM's to allow unless an action or feature granted that move or teleport this turn (Tactical Shift, Misty Step), which the move is charged to, and only the GM takes a placed token back to the tray. Before a fight the GM places tokens on the live scene without narration. `sceneId` targets a prepared (GM-private) scene; without it the token moves on the live table.",
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
      const landing: EffectNarration[] = [];
      const pursuits: EffectNarration[] = [];
      let granted: string | undefined;
      let moverHiddenAtStart = false;
      const { state: moved, duplicate } = await execute((state) => {
        if (state.combat.mapAssetId !== mapAssetId)
          throw new CommandRejectedError("The active encounter changed. Try moving the token again.");
        requireActorAccess(
          initiatorOf(principal),
          state,
          actorId,
          "move",
          "You may only move your claimed character token."
        );
        // What its turn's start does at once comes first, in the order its player gives.
        if (mode !== "forced" && mode !== "teleport") requireStartOrdered(state, actorId, initiatorOf(principal));
        // Before a fight the GM sets the scene; players move their own tokens once it starts.
        if (!state.combat.active && !isGmGrade(principal))
          throw new CommandRejectedError("Your GM places the tokens before the fight starts.");
        // A rider goes where its mount takes it (SRD Mounted Combat), until it dismounts.
        const riding = position !== null && state.combat.active ? mountOf(state, actorId) : undefined;
        if (riding && mode !== "forced" && mode !== "teleport")
          throw new CommandRejectedError(
            `${kit.actorName(actorId)} is riding ${riding.name}. Move ${riding.name}, or dismount first.`
          );
        // A mover waiting on its Opportunity Attacks that moves again gives up the rest of the held move.
        if (state.combat.heldMove?.actorId === actorId) state.combat = { ...state.combat, heldMove: null };
        const startToken = state.combat.tokens.find((token) => token.actorId === actorId);
        const from = startToken?.position ?? null;
        const fromAltitude = altitudeOf(startToken);
        const wasAirborne = startToken?.airborne;
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
        // A grappler drags what it holds (SRD Grappled: "Movable"), and a swallower carries what is inside it;
        // teleporting or being moved by force doesn't.
        const dragged =
          from !== null &&
          position !== null &&
          (mode === "walk" || mode === "fly" || mode === "swim" || mode === "climb" || mode === "burrow")
            ? [...grappledBy(state, actorId), ...swallowedBy(state, actorId).map(({ prey }) => prey.id)].filter(
                (heldId) => state.combat.tokens.find((token) => token.actorId === heldId)?.position
              )
            : [];
        moveEncounterToken(state, actorId, position, geometry);
        // The height it ends at, and what holds it up there; back in the tray it is on the ground.
        const toAltitude = position === null ? 0 : (request.altitudeFeet ?? fromAltitude);
        setAltitude(state, actorId, toAltitude, airborneAfter(mode, toAltitude, wasAirborne));
        // Movement budget and opportunity attacks (SRD), after the snap; a strict rejection discards the draft.
        const moverToken = state.combat.tokens.find((token) => token.actorId === actorId);
        const outcome = applyMovementRules(state, {
          actorId,
          from,
          to: moverToken?.position ?? null,
          mode,
          fromAltitudeFeet: fromAltitude,
          toAltitudeFeet: toAltitude,
          ...(wasAirborne ? { wasAirborne } : {}),
          byPlayer: !isGmGrade(principal),
          distance: (a, b) => mapDistance(geometry, a, b)?.value ?? null,
          // Spell areas on the way: Spirit Guardians' halved Speed, and the ground they make difficult.
          cost: (a, b, options) =>
            movementCost(state, geometry, actorId, a, b, {
              ...options,
              ...zoneMovementOptions(state, actorId, kit.zoneDeps(state, geometry))
            }),
          calibration: geometry.calibration,
          dragging: {
            // Its riders move with it too, and their space is no obstacle.
            actorIds: [...dragged, ...ridersOf(state, actorId)],
            // What it swallowed is inside it, and costs it nothing to carry.
            costsExtra: dragCostsExtra(
              state,
              actorId,
              dragged.filter((heldId) => grappledBy(state, actorId).includes(heldId)),
              (definitionId) => kit.resolveDefinitionIn(state, definitionId)
            )
          },
          creatureDistance: (enemy, moverPoint, altitudeFeet) => {
            const enemyToken = state.combat.tokens.find((token) => token.actorId === enemy.actorId);
            if (!enemyToken || !moverToken) return null;
            return (
              creatureDistance(
                geometry,
                footprintOf(enemyToken, enemy.position),
                footprintOf(moverToken, moverPoint, altitudeFeet ?? toAltitude)
              )?.value ?? null
            );
          },
          override: request.override ?? null,
          resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
          catalog: kit.equipmentCatalog(),
          ...(perceives ? { perceives } : {}),
          ...(seenAtStart ? { seenBy: (id: string) => seenAtStart.has(id) } : {}),
          ...(sight.enabled
            ? {
                seesPoint: (point: { x: number; y: number }) =>
                  sight.areaOf([actorId]).some((area) => insidePolygon(point, area))
              }
            : {}),
          // A jump lands on painted terrain or on the ground a spell's area makes difficult (Web, Entangle).
          difficultAt: (point) =>
            pointInRects(point, state.combat.terrain.difficult) ||
            zoneMovementOptions(state, actorId, kit.zoneDeps(state, geometry)).difficultAt?.(point) === true,
          moverHiddenFromPlayers: moverHiddenAtStart,
          newPromptId: kit.context.newId,
          now: Date.now,
          commandId
        });
        // A jump that lands in Difficult Terrain: the server rolls the DC 10 Dexterity (Acrobatics) check.
        if (outcome.landsOnDifficult) {
          const jumper = state.actors.find((actor) => actor.id === actorId);
          if (jumper)
            landJump(
              state,
              jumper,
              kit.fallDeps(
                state,
                (current, a, b) => tokenCreatureDistance(current, geometry, a, b)?.value ?? null,
                commandId
              ),
              landing
            );
        }
        granted = outcome.granted;
        // A move that provokes waits at the edge of reach while the attacks are answered.
        const destination = state.combat.tokens.find((token) => token.actorId === actorId)?.position;
        // What a stretch of the way costs this mover, the ground spell areas make included.
        const costFeet = (a: { x: number; y: number }, b: { x: number; y: number }) =>
          movementCost(
            state,
            geometry,
            actorId,
            a,
            b,
            zoneMovementOptions(state, actorId, kit.zoneDeps(state, geometry))
          )?.feet ?? null;
        if (outcome.heldAt && destination)
          holdMove(state, geometry, {
            actorId,
            at: outcome.heldAt.position,
            altitudeFeet: outcome.heldAt.altitudeFeet,
            to: destination,
            toAltitudeFeet: toAltitude,
            ...(airborneAfter(mode, toAltitude, wasAirborne)
              ? { airborne: airborneAfter(mode, toAltitude, wasAirborne)! }
              : {}),
            promptIds: outcome.heldAt.promptIds,
            refundFeet: outcome.heldAt.refundFeet,
            dragged,
            // The areas on the rest of the way act on the mover as it goes on.
            rest: movementCost(state, geometry, actorId, outcome.heldAt.position, destination)?.path ?? [
              outcome.heldAt.position,
              destination
            ]
          });
        // Time Stop ends once its caster goes more than 1,000 feet from where it cast it.
        landing.push(...timeStopOutOfRange(state, actorId, (a, b) => mapDistance(geometry, a, b)?.value ?? null));
        // A flight that ends when its rider lands (a Broom of Flying).
        landing.push(...endsOnLanding(state, actorId, fromAltitude, toAltitude));
        // A teleport into a filled space fails: back where it was, hurt (Dimension Door).
        if (outcome.teleportFails && from !== null) {
          moveEncounterToken(state, actorId, from, geometry);
          setAltitude(state, actorId, fromAltitude, wasAirborne);
          const caster = state.actors.find((actor) => actor.id === actorId);
          if (caster)
            failedTeleport(
              state,
              caster,
              outcome.teleportFails,
              kit.fallDeps(
                state,
                (current, a, b) => tokenCreatureDistance(current, geometry, a, b)?.value ?? null,
                commandId
              ),
              landing
            );
        }
        // A teleport out of a Forcecage takes a Charisma save first; a failure keeps the creature in and wastes it.
        const landed = state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
        if (mode === "teleport" && from !== null && landed !== null && !outcome.teleportFails) {
          const caged = teleportOutOfCage(state, actorId, from, landed, {
            resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
            catalog: kit.equipmentCatalog(),
            rollDie: (sides) => kit.context.random(sides)
          });
          if (caged) landing.push(...caged.events);
          if (caged?.held) {
            moveEncounterToken(state, actorId, from, geometry);
            setAltitude(state, actorId, fromAltitude, wasAirborne);
          }
          // What the granted teleport's arrival does near where it lands (a mummy lord's Whirlwind of Sand).
          const traveler = state.actors.find((actor) => actor.id === actorId);
          if (outcome.teleportLanding && traveler && !caged?.held) {
            const arrival = sceneSight(state, kit.sightContent());
            landing.push(
              ...landTeleport(state, traveler, outcome.teleportLanding, granted ?? "the teleport", {
                commandId,
                distanceFeet: (a, b) => tokenCreatureDistance(state, geometry, a, b)?.value ?? null,
                sees: (viewer, target) => !arrival.enabled || arrival.sees(viewer, target),
                resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
                catalog: kit.equipmentCatalog()
              })
            );
          }
        }
        movementWarning = outcome.warning;
        movementOverridden = outcome.overridden;
        opportunityPrompts.push(...outcome.prompts);
        // A spell area the move enters (or that its mover carries over others) acts on whoever it meets.
        const arrived = state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
        if (from !== null && arrived !== null) {
          const zoneDeps = kit.zoneDeps(state, geometry);
          // SRD Forbiddance: "creatures can't teleport into the area".
          const ward =
            mode === "teleport" ? teleportBarredAt(state, arrived, moverToken?.sizeCells ?? 1, zoneDeps) : null;
          if (ward) {
            const note = policeBarrier(
              state,
              request.override ?? null,
              "movement.teleport",
              `${kit.actorName(actorId)} can't teleport into ${ward}.`
            );
            if (note) movementWarning = movementWarning ? `${movementWarning} ${note}` : note;
          }
          const path =
            mode === "teleport"
              ? [from, arrived]
              : (movementCost(state, geometry, actorId, from, arrived)?.path ?? [from, arrived]);
          // A creature's own move goes as far as the first area whose save, failed, stops it, and waits there on the
          // save; a move already waiting on its Opportunity Attacks meets the areas past them as it goes on.
          const ownMove = mode !== "teleport" && mode !== "forced" && state.combat.heldMove?.actorId !== actorId;
          let stoppedAt: number | null = null;
          if (ownMove) {
            const walk = walkThroughZones(state, actorId, path, zoneDeps);
            zoneEvents.push(...walk.events);
            stoppedAt = walk.stop;
            if (walk.stop !== null) {
              const stopAt = path[walk.stop]!;
              const airborne = airborneAfter(mode, toAltitude, wasAirborne);
              holdMove(state, geometry, {
                actorId,
                at: stopAt,
                altitudeFeet: toAltitude,
                to: arrived,
                toAltitudeFeet: toAltitude,
                ...(airborne ? { airborne } : {}),
                promptIds: walk.saveIds,
                refundFeet: costFeet(stopAt, arrived) ?? 0,
                dragged,
                rest: path.slice(walk.stop)
              });
            }
          } else
            zoneEvents.push(
              ...zonesAfterMove(state, { moverId: actorId, path, teleported: mode === "teleport" }, zoneDeps)
            );
          // A move stopped by an area's save has gone only as far as the stop.
          const travelled = (way: ReadonlyArray<Readonly<{ x: number; y: number }>>) =>
            stoppedAt === null ? way : path.slice(0, stoppedAt + 1);
          zoneEvents.push(
            ...(mode === "teleport" ? [] : shellsForcedBy(state, actorId, path, zoneDeps)),
            // The creatures whose spaces it passed into (a gelatinous cube's).
            ...spaceEntryAfterMove(
              state,
              {
                moverId: actorId,
                path:
                  mode === "teleport"
                    ? path
                    : travelled(outcome.path ?? entryPathOf(state, geometry, actorId, from, arrived, zoneDeps)),
                teleported: mode === "teleport"
              },
              zoneDeps
            )
          );
          // Fire Form burns each creature whose space the elemental's own way entered, once a turn.
          const mover = state.actors.find((actor) => actor.id === actorId);
          if (mover && outcome.path && mode !== "teleport" && mode !== "forced" && geometry.calibration)
            zoneEvents.push(
              ...fireFormBurns(state, mover, travelled(outcome.path), {
                resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
                catalog: kit.equipmentCatalog(),
                newId: kit.context.newId,
                now: () => new Date().toISOString(),
                commandId,
                rollDie: (sides) => kit.context.random(sides),
                squarePx: geometry.calibration.cellSizePx
              })
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
              fromHiding: moverHiddenAtStart,
              fromAltitudeFeet: fromAltitude,
              ...(granted ? { granted } : {})
            })
          : null;
        const to = state.combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;
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
        // A mount carries its riders; one that teleports leaves them where they were, off it. One moved by force
        // carries them too, and each saves to stay on (SRD Mounted Combat).
        if (mode === "teleport") for (const riderId of ridersOf(state, actorId)) parted(state, riderId);
        else {
          const riders = carryRiders(state, actorId, geometry);
          if (mode === "forced" && riders.length > 0)
            zoneEvents.push(...askToStayMounted(state, riders, actorId, "its mount is moved", Date.now()));
        }
        if (riding && (mode === "teleport" || mode === "forced")) parted(state, actorId);
        // SRD Grappling: a grapple ends once the two are farther apart than its range.
        released = releaseGrapplesOutOfRange(
          state,
          actorId,
          (a, b) => tokenCreatureDistance(state, geometry, a, b)?.value ?? null,
          DISTANCE_TOLERANCE_FEET
        );
        // A move that ends here, unheld by an Opportunity Attack or an area's save, can open another creature's
        // reaction to it (a nalfeshnee's Pursuit). A teleport or a shove is no move of the creature's own.
        if (mode !== "forced" && mode !== "teleport" && position !== null && state.combat.heldMove?.actorId !== actorId)
          pursuits.push(
            ...offerNearbyReactions(state, actorId, "ends-move-near", {
              newId: kit.context.newId,
              now: () => new Date().toISOString(),
              resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
              catalog: kit.equipmentCatalog(),
              distanceFeet: (a, b) => tokenCreatureDistance(state, geometry, a, b)?.value ?? null,
              commandId
            })
          );
      });
      if (duplicate) return;
      if (landing.length > 0) kit.publishRolls(moved, commandId);
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
      // What the spell areas did to the mover follows the move itself, as does a jump's landing.
      kit.publishNarrations(zoneEvents);
      kit.publishNarrations(landing);
      kit.publishNarrations(pursuits);
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
          text: `OVERRIDE (movement): ${kit.actorName(actorId)} moved past a movement rule · ${movementOverridden}`,
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
    type: "token.set-altitude",
    operationId: "setTokenAltitude",
    description:
      "Sets how high a creature is above the ground (GM-grade only), free of movement: standing or clinging on a surface such as a ledge, a balcony or a wall (`airborne` null), or in the air, flying (`fly`) or held up by a levitation (`levitate`). 0 puts it on the ground. Height counts in every distance between creatures, so reach, range and auras read it. A creature put in the air that can't stay there falls as the command commits.",
    summary: "Set how high a creature is, on a surface or in the air (GM).",
    schema: TokenSetAltitudeSchema,
    malformed: "The height change is malformed.",
    gmOnly: "Only the GM sets a creature's height. Fly, climb or jump to change your own.",
    async run({ request, execute }, kit) {
      const { actorId, altitudeFeet } = request;
      const { duplicate } = await execute((state) => {
        const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId);
        if (!token?.position) throw new CommandRejectedError("Place that creature on the map first.");
        setAltitude(state, actorId, altitudeFeet, request.airborne ?? undefined);
      });
      if (duplicate) return;
      const name = kit.actorName(actorId);
      kit.context.appendLog({
        kind: "movement",
        text: altitudeFeet > 0 ? `${name} is ${altitudeFeet} ft up.` : `${name} is on the ground.`,
        actorIds: [actorId],
        gmOnly: kit.actorHidden(actorId)
      });
    }
  }),

  defineCommand({
    type: "actor.fall",
    operationId: "fallActor",
    description:
      "Makes a creature fall (GM-grade only), SRD Falling: 1d6 Bludgeoning damage for every 10 feet, to a maximum of 20d6, rolled by the server, and the Prone condition unless it takes no damage. It falls from the height it is at unless `feet` says how far, and lands on the ground or at `landingAltitudeFeet`. With `intoWater` it may use its Reaction for a DC 15 Strength (Athletics) or Dexterity (Acrobatics) check, which the server rolls with the better of the two, a success halving the damage. In a fight, a creature that can answer the fall with its Reaction (Feather Fall within range and sight, the faller's own Slow Fall) gets a `falls` prompt, and the fall waits for the answers. A creature that can't stay in the air falls this way by itself after any command.",
    summary: "Make a creature fall; the server rolls the damage once any reaction to it is answered (GM).",
    schema: ActorFallSchema,
    malformed: "The fall is malformed.",
    gmOnly: "Only the GM makes a creature fall.",
    async run({ request, execute }, kit) {
      const { commandId, actorId } = request;
      const distance = await kit.creatureDistance();
      let events: EffectNarration[] = [];
      const { state, duplicate } = await execute((draft) => {
        const actor = draft.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        const height = altitudeOf(draft.combat.tokens.find((token) => token.actorId === actorId));
        const feet = request.feet ?? height - (request.landingAltitudeFeet ?? 0);
        if (feet <= 0) throw new CommandRejectedError(`${actor.name} is on the ground. Say how far it falls.`);
        events = startFall(
          draft,
          {
            actorId,
            feet,
            ...(request.intoWater ? { intoWater: true } : {}),
            ...(request.landingAltitudeFeet !== undefined ? { landingAltitudeFeet: request.landingAltitudeFeet } : {})
          },
          kit.fallDeps(draft, distance, commandId)
        );
      });
      if (duplicate) return;
      kit.publishRolls(state, commandId);
      kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "actor.mount",
    operationId: "mountActor",
    description:
      "A creature climbs onto a mount (`mountId`) or gets off the one it rides (`mountId: null`), SRD 5.2.1 Mounted Combat: the mount must be within 5 feet and at least one size larger (a flying or aquatic one wearing an Exotic Saddle), and either costs half the rider's Speed on its turn in a fight. The rider shares the mount's space and height, the mount's moves carry it, and it moves only by its mount until it dismounts; a dismounted rider stands in the nearest unoccupied space. A `controlled` mount (the default) takes the rider's Initiative, its turn right after the rider's, and only the Dash, Disengage and Dodge actions; an `independent` one keeps its own. A mount moved by force carries its rider, who makes a DC 10 Dexterity saving throw to stay on, and one that teleports leaves its rider behind, off it. A player may mount or dismount only their own character; the GM may `override` a movement rule.",
    summary: "Mount a creature or dismount; the mount's moves carry its rider.",
    schema: ActorMountSchema,
    malformed: "The mount request is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, mountId } = request;
      if (request.override && !isGmGrade(principal))
        throw new GameAccessDeniedError("Only the GM can override movement rules.");
      const { mapAssetId, geometry } = await liveMap(kit, "Make a scene live before mounting a creature.");
      const distance = await kit.creatureDistance();
      let mountName: string | null = null;
      let outcome: ReturnType<typeof mountOrDismount> = { warnings: [], overridden: null };
      const { duplicate } = await execute((state) => {
        requireSameMap(state.combat.mapAssetId, mapAssetId);
        requireActorAccess(initiatorOf(principal), state, actorId, "move", "You may only move your claimed character.");
        mountName = (mountId ? kit.actorName(mountId) : mountOf(state, actorId)?.name) ?? null;
        outcome = mountOrDismount(
          state,
          {
            riderId: actorId,
            ...(request.control ? { control: request.control } : {}),
            mountId,
            override: isGmGrade(principal) ? (request.override ?? null) : null,
            distanceFeet: (a, b) => distance(state, a, b),
            resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
            catalog: kit.equipmentCatalog(),
            newId: kit.context.newId
          },
          geometry
        );
      });
      if (duplicate) return;
      const name = kit.actorName(actorId);
      kit.context.appendLog({
        kind: "movement",
        text: mountId
          ? `${name} mounts ${mountName ?? "a creature"}.`
          : `${name} dismounts from ${mountName ?? "its mount"}.`,
        actorIds: [actorId, ...(mountId ? [mountId] : [])],
        gmOnly: kit.actorHidden(actorId) || (mountId !== null && kit.actorHidden(mountId))
      });
      for (const warning of outcome.warnings)
        kit.context.appendLog({ kind: "movement", text: `Rules note: ${warning}`, actorIds: [actorId], gmOnly: true });
      if (outcome.overridden)
        kit.context.appendLog({
          kind: "override",
          text: `OVERRIDE (movement): ${name} mounted past a movement rule · ${outcome.overridden}`,
          actorIds: [actorId]
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
      const { mapAssetId, geometry } = await liveMap(kit, "Make a scene live before placing a spell's area.");
      if (!geometry.calibration) throw new CommandRejectedError("Calibrate this map before placing a spell's area.");
      const { commandId, zoneId, template } = request;
      await execute((state) => {
        requireSameMap(state.combat.mapAssetId, mapAssetId);
        const zone = state.combat.spellZones.find((candidate) => candidate.id === zoneId);
        if (!zone) throw new CommandRejectedError("That spell's area has already ended.");
        // The spell's own area decides the shape and the size; the drag only places and points it.
        const placed = zone.area ? templateOfArea(geometry.calibration!, template, zone.area) : template;
        // A nearly imperceptible glyph is drawn for the GM and its caster's player alone.
        const unseen = zoneContentOf(zone, kit.equipmentCatalog())?.trigger.hidden === true;
        addAnnotation(
          state,
          {
            id: commandId,
            kind: "shape",
            shape: placed.shape,
            origin: placed.origin,
            target: placed.target,
            visibility: unseen ? "gm-actor" : "public",
            ...(unseen ? { visibleToActorId: zone.casterId } : {}),
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
      "Ends a spell's lingering area and removes it from the map (GM-grade only): webs burned away, a guardian dismissed, or a ruling. The caster's Concentration on the spell is untouched; ending that ends the area too. A spell with no Concentration that is only its area (Glyph of Warding, Guardian of Faith) ends with it.",
    summary: "End a spell's lingering area (GM).",
    schema: SpellZoneEndSchema,
    malformed: "The spell-area command is malformed.",
    gmOnly: "Only the GM ends a spell's area.",
    async run({ request, execute }, kit) {
      let name = "";
      let ended: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        const zone = state.combat.spellZones.find((candidate) => candidate.id === request.zoneId);
        if (!zone) throw new CommandRejectedError("That spell's area has already ended.");
        name = zone.name;
        ended = endZoneAndItsSpell(state, zone.id);
      });
      if (!duplicate && name) kit.context.appendLog({ kind: "encounter", text: `${name} ends.`, gmOnly: true });
      if (!duplicate) kit.publishNarrations(ended);
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
