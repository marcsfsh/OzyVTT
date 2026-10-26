import { useState } from "react";
import type {
  AnnotationShapeKind,
  AnnotationVisibility,
  DoorState,
  EncounterTokenPosition,
  MutationResult,
  ObjectStats,
  RulesBlocked
} from "@vtt/domain";
import { command } from "../lib/command";
import { newId } from "../lib/ids";
import { resolveAtLight, resolveAtWall } from "../encounter/targeting";
import type { MoveMode } from "./movePreview";
import type { Point } from "./useMapView";
import type { AreaKindId } from "./mapTools";

/**
 * Everything the map sends: token moves, annotations, fog, terrain and vision. Each family has its own busy flag, and
 * a refusal lands on the map's feedback line. Moves and fog target the privately staged scene while
 * the GM arranges one (`sceneId`), else the live table.
 */
/** A token move a movement rule refused, kept so the GM can move it anyway or a player can ask the GM. */
export type BlockedMove = Readonly<{
  actorId: string;
  position: EncounterTokenPosition;
  mode: MoveMode | undefined;
  /** The height the move asked for; absent keeps the token's own. */
  altitudeFeet?: number;
  blocked: RulesBlocked;
}>;

const ASKED = "Asked the GM. Waiting for their call.";

/** How a creature works on a door (`door:use`). */
export type DoorWork = "pick" | "force" | "jam" | "pry" | "seal" | "release";

export function useMapCommands({
  revision,
  sceneId,
  size,
  canMove,
  moveModeFor = () => undefined,
  drawing,
  onShapeAdded,
  waitingAsks = 0
}: Readonly<{
  revision: number;
  sceneId?: string;
  size: Readonly<{ width: number; height: number }> | null;
  canMove: (actorId: string) => boolean;
  /** How a creature's drag travels (the mode picked for the acting creature); walking when undefined. */
  moveModeFor?: (actorId: string) => MoveMode | undefined;
  /** How a new drawing is shared, and in which colour. */
  drawing: Readonly<{ visibility: AnnotationVisibility; visibleToActorId: string | null; color: string }>;
  /** A new shape is selected for editing as soon as the server stores it. */
  onShapeAdded: (annotationId: string | null) => void;
  /** How many of this viewer's questions wait on the GM; one fewer means the GM answered. */
  waitingAsks?: number;
}>) {
  const [message, setMessage] = useState("");
  // Once the GM answers (the token moves, or stays), the line no longer says the question is waiting.
  const [seenAsks, setSeenAsks] = useState(waitingAsks);
  if (waitingAsks !== seenAsks) {
    setSeenAsks(waitingAsks);
    if (waitingAsks < seenAsks && message === ASKED) setMessage("");
  }
  const [busyActorId, setBusyActorId] = useState<string | null>(null);
  const [annotationBusy, setAnnotationBusy] = useState<string | null>(null);
  const [fogBusy, setFogBusy] = useState(false);
  const [terrainBusy, setTerrainBusy] = useState(false);
  const [visionBusy, setVisionBusy] = useState(false);
  const [blockedMove, setBlockedMove] = useState<BlockedMove | null>(null);
  const scene = sceneId !== undefined ? { sceneId } : {};

  const sendMove = async (
    actorId: string,
    position: EncounterTokenPosition | null,
    mode: MoveMode | undefined,
    override?: Readonly<{ reason: string }>,
    altitudeFeet?: number
  ) => {
    setBusyActorId(actorId);
    setMessage("");
    setBlockedMove(null);
    const result = await command("token:move", {
      actorId,
      position,
      ...(mode && mode !== "walk" && position ? { mode } : {}),
      ...(altitudeFeet !== undefined && position ? { altitudeFeet } : {}),
      ...(override ? { override } : {}),
      ...scene,
      expectedRevision: revision
    });
    setMessage(
      result.ok
        ? position
          ? "Token moved."
          : "Token returned to the tray."
        : (result.message ?? "The token move was rejected.")
    );
    if (!result.ok && result.blocked?.overridable && position)
      setBlockedMove({
        actorId,
        position,
        mode,
        ...(altitudeFeet !== undefined ? { altitudeFeet } : {}),
        blocked: result.blocked
      });
    setBusyActorId(null);
  };
  /** Moves a token; `altitudeFeet` is the height the move ends at, the token's own when absent. */
  const submitMove = async (actorId: string, position: EncounterTokenPosition | null, altitudeFeet?: number) => {
    if (busyActorId || !canMove(actorId)) return;
    await sendMove(actorId, position, moveModeFor(actorId), undefined, altitudeFeet);
  };
  /** The GM puts a creature at a height, free of movement: on a surface, or in the air. */
  const setAltitude = async (actorId: string, altitudeFeet: number, airborne: "fly" | "levitate" | null) => {
    if (busyActorId) return;
    setBusyActorId(actorId);
    setMessage("");
    const result = await command("token:set-altitude", { actorId, altitudeFeet, airborne, expectedRevision: revision });
    setMessage(result.ok ? "Height set." : (result.message ?? "The height could not be set."));
    setBusyActorId(null);
  };
  /** A creature climbs onto a mount, controlling it or letting it act on its own, or off the one it rides with null. */
  const mount = async (actorId: string, mountId: string | null, control?: "controlled" | "independent") => {
    if (busyActorId) return;
    setBusyActorId(actorId);
    setMessage("");
    const result = await command("actor:mount", {
      actorId,
      mountId,
      ...(mountId !== null && control ? { control } : {}),
      expectedRevision: revision
    });
    setMessage(
      result.ok
        ? mountId
          ? "Mounted."
          : "Dismounted."
        : (result.message ?? (mountId ? "That creature can't be mounted now." : "It can't dismount now."))
    );
    setBusyActorId(null);
  };
  /** The GM drops a creature from the height it is at; the server rolls the damage. */
  const fall = async (actorId: string, intoWater: boolean) => {
    if (busyActorId) return;
    setBusyActorId(actorId);
    setMessage("");
    const result = await command("actor:fall", { actorId, ...(intoWater ? { intoWater } : {}) });
    setMessage(result.ok ? "The fall is rolled." : (result.message ?? "The fall could not be rolled."));
    setBusyActorId(null);
  };
  /** The GM's ruling on a refused move: the same move again, with an audited override. */
  const moveAnyway = async () => {
    if (!blockedMove || busyActorId) return;
    await sendMove(
      blockedMove.actorId,
      blockedMove.position,
      blockedMove.mode,
      { reason: "GM ruling on the map" },
      blockedMove.altitudeFeet
    );
  };
  /** A player's question about a refused move, parked for the GM to allow or deny. */
  const askAboutMove = async () => {
    if (!blockedMove) return;
    const { actorId, position, mode, altitudeFeet } = blockedMove;
    const result = await command("rules:ask", {
      type: "token.move",
      payload: {
        commandId: newId(),
        actorId,
        position,
        ...(mode && mode !== "walk" ? { mode } : {}),
        ...(altitudeFeet !== undefined ? { altitudeFeet } : {})
      }
    });
    setBlockedMove(null);
    setMessage(
      !result.ok
        ? (result.message ?? "That question could not be sent.")
        : result.ran
          ? "That worked this time. No question was needed."
          : ASKED
    );
  };
  const placeAtCenter = (actorId: string) => {
    if (size) void submitMove(actorId, { x: size.width / 2, y: size.height / 2 });
  };

  const runAnnotation = async (id: string, action: () => Promise<MutationResult>, fail: string) => {
    setAnnotationBusy(id);
    setMessage("");
    const result = await action();
    if (!result.ok) setMessage(result.message ?? fail);
    setAnnotationBusy(null);
  };
  const addAnnotation = (
    kind: "measurement" | "shape",
    shape: AnnotationShapeKind | undefined,
    origin: Point,
    target: Point
  ) =>
    runAnnotation(
      "new",
      async () => {
        const result = await command("annotation:add", {
          kind,
          shape,
          geometry: { origin, target },
          visibility: drawing.visibility,
          visibleToActorId: drawing.visibility === "gm-actor" ? drawing.visibleToActorId : null,
          movableByOthers: false,
          color: drawing.color,
          expectedRevision: revision
        });
        if (result.ok && kind === "shape") onShapeAdded(result.annotationId ?? null);
        return result;
      },
      "That could not be added to the map."
    );
  const ping = (point: Point) =>
    runAnnotation(
      "ping",
      () => command("annotation:ping", { point, color: drawing.color, expectedRevision: revision }),
      "The ping could not be sent."
    );
  const setColor = (id: string, color: string) =>
    runAnnotation(
      id,
      () => command("annotation:set-color", { id, color, expectedRevision: revision }),
      "The color could not be changed."
    );
  const moveAnnotation = (id: string, origin: Point, target: Point) =>
    runAnnotation(
      id,
      () => command("annotation:move", { id, geometry: { origin, target }, expectedRevision: revision }),
      "That could not be moved."
    );
  const removeAnnotation = (id: string) =>
    runAnnotation(
      id,
      () => command("annotation:remove", { id, expectedRevision: revision }),
      "That could not be removed."
    );
  const setVisibility = (id: string, visibility: AnnotationVisibility, visibleToActorId: string | null) =>
    runAnnotation(
      id,
      () => command("annotation:set-visibility", { id, visibility, visibleToActorId, expectedRevision: revision }),
      "The visibility could not be changed."
    );
  const setMovable = (id: string, movableByOthers: boolean) =>
    runAnnotation(
      id,
      () => command("annotation:set-movable", { id, movableByOthers, expectedRevision: revision }),
      "Move control could not be changed."
    );
  const clearAnnotations = (scope: "mine" | "players" | "all") =>
    void runAnnotation(
      "clear",
      () => command("annotation:clear", { scope, expectedRevision: revision }),
      "Shapes could not be removed."
    );

  const runFog = (run: () => Promise<MutationResult>, failure: string) => {
    setFogBusy(true);
    void run().then((result) => {
      setFogBusy(false);
      if (!result.ok) setMessage(result.message ?? failure);
    });
  };
  const paintFog = (op: "reveal" | "hide", a: Point, b: Point) => {
    const rect = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y)
    };
    if (rect.width < 2 || rect.height < 2) {
      setMessage(`Drag an area to ${op} it.`);
      return;
    }
    runFog(
      () => command("fog:paint", { op, rect, ...scene, expectedRevision: revision }),
      "The fog stroke could not be painted."
    );
  };
  const setFogEnabled = (enabled: boolean) =>
    runFog(
      () => command("fog:set-enabled", { enabled, ...scene, expectedRevision: revision }),
      "The fog could not be toggled."
    );
  const revealAllFog = () => {
    if (!size) return;
    runFog(
      () =>
        command("fog:paint", {
          op: "reveal",
          rect: { x: 0, y: 0, width: size.width, height: size.height },
          ...scene,
          expectedRevision: revision
        }),
      "The fog could not be revealed."
    );
  };
  const hideAllFog = () =>
    runFog(() => command("fog:reset", { ...scene, expectedRevision: revision }), "The fog could not be reset.");

  const runTerrain = (run: () => Promise<MutationResult>, failure: string) => {
    setTerrainBusy(true);
    void run().then((result) => {
      setTerrainBusy(false);
      if (!result.ok) setMessage(result.message ?? failure);
    });
  };
  const paintTerrain = (op: "difficult" | "clear", a: Point, b: Point) => {
    const rect = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y)
    };
    if (rect.width < 2 || rect.height < 2) {
      setMessage(op === "difficult" ? "Drag an area to mark it difficult." : "Drag an area to clear it.");
      return;
    }
    runTerrain(
      () => command("terrain:paint", { op, rect, ...scene, expectedRevision: revision }),
      "The terrain could not be marked."
    );
  };
  const clearAllTerrain = () =>
    runTerrain(
      () => command("terrain:reset", { ...scene, expectedRevision: revision }),
      "The terrain could not be cleared."
    );

  const runVision = (run: () => Promise<MutationResult>, failure: string, done?: string) => {
    setVisionBusy(true);
    void run().then((result) => {
      setVisionBusy(false);
      setMessage(result.ok ? (done ?? "") : (result.message ?? failure));
    });
  };
  const setVisionEnabled = (enabled: boolean) =>
    runVision(
      () => command("vision:set-enabled", { enabled, ...scene, expectedRevision: revision }),
      "Vision could not be switched."
    );
  const setAmbient = (ambient: "bright" | "dim" | "dark", sunlight?: boolean) =>
    runVision(
      () =>
        command("vision:set-ambient", {
          ambient,
          ...(sunlight !== undefined ? { sunlight } : {}),
          ...scene,
          expectedRevision: revision
        }),
      "The light could not be changed."
    );
  /** An area of light or obscurement over a dragged rectangle. */
  const addArea = (kind: AreaKindId, a: Point, b: Point) => {
    if (Math.abs(a.x - b.x) < 4 || Math.abs(a.y - b.y) < 4) {
      setMessage("Drag over the map to paint an area.");
      return;
    }
    const rect = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y)
    };
    runVision(
      () => command("vision:add-area", { kind, rect, ...scene, expectedRevision: revision }),
      "The area could not be painted."
    );
  };
  const removeArea = (areaId: string) =>
    runVision(
      () => command("vision:remove-area", { areaId, ...scene, expectedRevision: revision }),
      "That area could not be removed."
    );
  const addWall = (kind: "wall" | "door" | "window", a: Point, b: Point) => {
    if (Math.hypot(a.x - b.x, a.y - b.y) < 4) {
      setMessage(`Drag along the map to draw a ${kind}.`);
      return;
    }
    runVision(
      () => command("wall:add", { kind, points: [a, b], ...scene, expectedRevision: revision }),
      `The ${kind} could not be drawn.`
    );
  };
  const removeWall = (wallId: string) =>
    runVision(
      () => command("wall:remove", { wallId, ...scene, expectedRevision: revision }),
      "That could not be removed."
    );
  const clearWalls = () =>
    runVision(() => command("wall:clear", { ...scene, expectedRevision: revision }), "The walls could not be removed.");
  /** A player opens a door beside their character; the server checks it is. */
  const setDoorOpen = (wallId: string, open: boolean) =>
    runVision(
      () => command("door:set-open", { wallId, open, ...scene, expectedRevision: revision }),
      open ? "The door could not be opened." : "The door could not be closed.",
      open ? "Door opened." : "Door closed."
    );
  /** A creature beside a door picks, forces, pries, jams or seals it; the server rolls the check and says how it went. */
  const workDoor = (wallId: string, actorId: string, how: DoorWork) => {
    setVisionBusy(true);
    void command("door:use", { wallId, actorId, how, expectedRevision: revision }).then((result) => {
      setVisionBusy(false);
      setMessage(result.ok ? (result.text ?? "") : (result.message ?? "That could not be done to the door."));
    });
  };
  /** The spell being aimed lights or puts out a flame set on the map (`resolveAtLight`). */
  const aimAtLight = (lightId: string) =>
    resolveAtLight(lightId, revision, (ok, text) =>
      setMessage(text ?? (ok ? "" : "That could not be aimed at the light."))
    );
  /** The attack or spell being aimed lands on a door or a wall (`resolveAtWall`); the server says how it went. */
  const aimAtWall = (wallId: string) =>
    resolveAtWall(wallId, revision, (ok, text) =>
      setMessage(text ?? (ok ? "" : "That could not be aimed at the wall."))
    );
  /** The GM sets what keeps a door shut and its statistics as an object, in that order: the second write follows the
   *  first one's revision, so it carries none of its own. */
  const saveDoor = (wallId: string, door: DoorState | null, object: ObjectStats | null) =>
    runVision(
      async () => {
        const held = await command("door:set-state", { wallId, door, ...scene, expectedRevision: revision });
        if (!held.ok) return held;
        return command("object:set", { wallId, object, ...scene });
      },
      "The door could not be changed.",
      "Door saved."
    );
  const addLight = (position: Point, light: Readonly<{ brightFeet: number; dimFeet: number }>) =>
    runVision(
      () =>
        command("light:add", {
          position,
          brightFeet: light.brightFeet,
          dimFeet: light.dimFeet,
          ...scene,
          expectedRevision: revision
        }),
      "The light could not be placed."
    );
  const removeLight = (lightId: string) =>
    runVision(
      () => command("light:remove", { lightId, ...scene, expectedRevision: revision }),
      "That light could not be removed."
    );
  const forgetExplored = () =>
    runVision(
      () => command("vision:reset-explored", { ...scene, expectedRevision: revision }),
      "What the party has seen could not be forgotten."
    );

  return {
    message,
    setMessage,
    busyActorId,
    submitMove,
    setAltitude,
    mount,
    fall,
    placeAtCenter,
    blockedMove,
    moveAnyway,
    askAboutMove,
    dismissBlockedMove: () => setBlockedMove(null),
    annotationBusy,
    addAnnotation,
    ping,
    setColor,
    moveAnnotation,
    removeAnnotation,
    setVisibility,
    setMovable,
    clearAnnotations,
    fogBusy,
    paintFog,
    setFogEnabled,
    revealAllFog,
    hideAllFog,
    terrainBusy,
    paintTerrain,
    clearAllTerrain,
    visionBusy,
    setVisionEnabled,
    setAmbient,
    addArea,
    removeArea,
    addWall,
    removeWall,
    clearWalls,
    setDoorOpen,
    workDoor,
    aimAtWall,
    aimAtLight,
    saveDoor,
    addLight,
    removeLight,
    forgetExplored
  };
}

export type MapCommands = ReturnType<typeof useMapCommands>;
