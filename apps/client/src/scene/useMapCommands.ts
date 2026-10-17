import { useState } from "react";
import type {
  AnnotationShapeKind,
  AnnotationVisibility,
  EncounterTokenPosition,
  MutationResult,
  RulesBlocked
} from "@vtt/domain";
import { command } from "../lib/command";
import { newId } from "../lib/ids";
import type { MoveMode } from "./movePreview";
import type { Point } from "./useMapView";

/**
 * Everything the map sends: token moves, annotations, fog and terrain. Each family has its own busy flag, and
 * a refusal lands on the map's feedback line. Moves and fog target the privately staged scene while
 * the GM arranges one (`sceneId`), else the live table.
 */
/** A token move a movement rule refused, kept so the GM can move it anyway or a player can ask the GM. */
export type BlockedMove = Readonly<{
  actorId: string;
  position: EncounterTokenPosition;
  mode: MoveMode | undefined;
  blocked: RulesBlocked;
}>;

const ASKED = "Asked the GM. Waiting for their call.";

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
  const [blockedMove, setBlockedMove] = useState<BlockedMove | null>(null);
  const scene = sceneId !== undefined ? { sceneId } : {};

  const sendMove = async (
    actorId: string,
    position: EncounterTokenPosition | null,
    mode: MoveMode | undefined,
    override?: Readonly<{ reason: string }>
  ) => {
    setBusyActorId(actorId);
    setMessage("");
    setBlockedMove(null);
    const result = await command("token:move", {
      actorId,
      position,
      ...(mode && mode !== "walk" && position ? { mode } : {}),
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
      setBlockedMove({ actorId, position, mode, blocked: result.blocked });
    setBusyActorId(null);
  };
  const submitMove = async (actorId: string, position: EncounterTokenPosition | null) => {
    if (busyActorId || !canMove(actorId)) return;
    await sendMove(actorId, position, moveModeFor(actorId));
  };
  /** The GM's ruling on a refused move: the same move again, with an audited override. */
  const moveAnyway = async () => {
    if (!blockedMove || busyActorId) return;
    await sendMove(blockedMove.actorId, blockedMove.position, blockedMove.mode, { reason: "GM ruling on the map" });
  };
  /** A player's question about a refused move, parked for the GM to allow or deny. */
  const askAboutMove = async () => {
    if (!blockedMove) return;
    const { actorId, position, mode } = blockedMove;
    const result = await command("rules:ask", {
      type: "token.move",
      payload: {
        commandId: newId(),
        actorId,
        position,
        ...(mode && mode !== "walk" ? { mode } : {})
      }
    });
    setBlockedMove(null);
    setMessage(
      !result.ok
        ? (result.message ?? "That question could not be sent.")
        : result.ran
          ? "That worked this time - no question needed."
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

  return {
    message,
    setMessage,
    busyActorId,
    submitMove,
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
    clearAllTerrain
  };
}

export type MapCommands = ReturnType<typeof useMapCommands>;
