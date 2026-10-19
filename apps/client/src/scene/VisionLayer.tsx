import { AREA_KINDS } from "./mapTools";

type Point = Readonly<{ x: number; y: number }>;
/** A wall as this view has it: the GM's carry what holds a door shut and the statistics of one that is an object. */
export type MapWall = Readonly<{
  id: string;
  kind: "wall" | "door" | "window";
  a: Point;
  b: Point;
  open?: boolean;
  door?: Readonly<{
    fastenings: ReadonlyArray<Readonly<{ kind: string; dc?: number; forceDc?: number }>>;
    arcaneLock?: unknown;
    hidden?: true;
  }>;
  object?: Readonly<{ armorClass: number; hitPoints: Readonly<{ current: number; maximum: number }> }>;
}>;
type Wall = MapWall;

/** Whether something holds the door shut: a fastening or an Arcane Lock. Only the GM's walls carry it. */
export const fastened = (wall: MapWall): boolean =>
  (wall.door?.fastenings.length ?? 0) > 0 || wall.door?.arcaneLock !== undefined;

/** What a door's handle is called: open or closed, and for the GM what holds it and whether players see it. */
function doorLabel(wall: MapWall): string {
  const parts = [wall.open === true ? "Open door" : "Closed door"];
  if (fastened(wall)) parts.push("held shut");
  if (wall.door?.hidden) parts.push("secret");
  return parts.join(" · ");
}
type Light = Readonly<{
  id: string;
  position: Point | null;
  actorId: string | null;
  brightFeet: number;
  dimFeet: number;
}>;
/** An area of light or obscurement as the scene stores it; a spell's template draws itself as its annotation. */
type Area = Readonly<{
  id: string;
  kind: string;
  shape:
    | Readonly<{ type: "rect"; x: number; y: number; width: number; height: number }>
    | Readonly<{ type: "circle"; x: number; y: number; radiusFeet: number }>
    | Readonly<{ type: "template"; annotationId: string }>
    | Readonly<{ type: "emanation"; actorId: string; radiusFeet: number }>;
}>;

/**
 * Dynamic vision's marks on the map: for the GM, every wall, door, window and light (tap targets for the Remove tool),
 * which doors are held shut and the hit points of the walls that are objects; for a player, the doors in sight. A
 * door's handle opens its menu (`DoorMenu`). While an action is being aimed, every wall in view takes a tap, so an
 * attack or a spell can be aimed at it. Handles keep a 44-pixel touch ring whatever the zoom.
 */
export function VisionLayer({
  role,
  walls,
  lights = [],
  areas = [],
  tokenPositions,
  pixelsPerFoot,
  cellSizePx,
  showWalls,
  erasing,
  aiming = false,
  onDoorMenu
}: Readonly<{
  role: "gm" | "player";
  walls: readonly Wall[];
  lights?: readonly Light[];
  /** Areas of light and obscurement (the GM's view). */
  areas?: readonly Area[];
  /** Where each placed token stands, for the lights creatures carry. */
  tokenPositions: ReadonlyMap<string, Point>;
  pixelsPerFoot: number | null;
  cellSizePx: number;
  /** Draw walls and windows (the GM while editing or with vision on); doors are always drawn. */
  showWalls: boolean;
  /** The Remove tool is on: walls and lights take taps. */
  erasing: boolean;
  /** An action is being aimed: walls take taps as its target. */
  aiming?: boolean;
  /** A door's handle from the keyboard opens its menu there; taps reach the map's gestures. */
  onDoorMenu: (wallId: string, x: number, y: number) => void;
}>) {
  const handle = Math.max(6, cellSizePx * 0.18);
  return (
    <g className={`vision-layer${erasing ? " erasing" : ""}`}>
      {role === "gm" &&
        areas.map((area) => {
          const label = AREA_KINDS.find((entry) => entry.id === area.kind)?.label ?? area.kind;
          const className = `vision-area vision-area-${area.kind}`;
          const shape = area.shape;
          if (shape.type === "rect")
            return (
              <g key={area.id} data-area-id={area.id}>
                <title>{label}</title>
                <rect className={className} x={shape.x} y={shape.y} width={shape.width} height={shape.height} />
                {erasing && (
                  <rect className="vision-hit" x={shape.x} y={shape.y} width={shape.width} height={shape.height} />
                )}
              </g>
            );
          const at =
            shape.type === "circle"
              ? shape
              : shape.type === "emanation"
                ? tokenPositions.get(shape.actorId)
                : undefined;
          if (!at || pixelsPerFoot === null || shape.type === "template") return null;
          const radius = shape.radiusFeet * pixelsPerFoot;
          return (
            <g key={area.id} data-area-id={area.id}>
              <title>{label}</title>
              <circle className={className} cx={at.x} cy={at.y} r={radius} />
              {erasing && <circle className="vision-hit" cx={at.x} cy={at.y} r={radius} />}
            </g>
          );
        })}
      {role === "gm" &&
        lights.map((light) => {
          const at = light.position ?? (light.actorId ? tokenPositions.get(light.actorId) : undefined);
          if (!at) return null;
          const bright = pixelsPerFoot === null ? 0 : light.brightFeet * pixelsPerFoot;
          const dim = pixelsPerFoot === null ? 0 : (light.brightFeet + light.dimFeet) * pixelsPerFoot;
          return (
            <g key={light.id} className="vision-light" data-light-id={light.id}>
              <title>{`Light · ${light.brightFeet} ft bright, ${light.dimFeet} ft dim`}</title>
              {dim > 0 && <circle className="vision-light-dim" cx={at.x} cy={at.y} r={dim} />}
              {bright > 0 && <circle className="vision-light-bright" cx={at.x} cy={at.y} r={bright} />}
              {light.position && <circle className="vision-light-glyph" cx={at.x} cy={at.y} r={handle} />}
              {light.position && erasing && <circle className="vision-hit" cx={at.x} cy={at.y} r={handle} />}
            </g>
          );
        })}
      {walls.map((wall) => {
        if (wall.kind !== "door" && !showWalls && !aiming) return null;
        const middle = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
        const state =
          wall.kind === "door"
            ? `${wall.open === true ? " open" : wall.open === false ? " closed" : ""}${fastened(wall) ? " fastened" : ""}${wall.door?.hidden ? " secret" : ""}`
            : "";
        const label = doorLabel(wall);
        return (
          <g
            key={wall.id}
            className={`vision-wall vision-wall-${wall.kind}${state}`}
            {...(role === "gm" ? { "data-wall-id": wall.id } : {})}
          >
            {(showWalls || role === "gm") && (
              <line className="vision-wall-line" x1={wall.a.x} y1={wall.a.y} x2={wall.b.x} y2={wall.b.y} />
            )}
            {role === "gm" && erasing && (
              <line className="vision-hit" x1={wall.a.x} y1={wall.a.y} x2={wall.b.x} y2={wall.b.y} />
            )}
            {aiming && !erasing && (
              <line
                className="vision-aim-hit"
                data-wall-target={wall.id}
                x1={wall.a.x}
                y1={wall.a.y}
                x2={wall.b.x}
                y2={wall.b.y}
              />
            )}
            {role === "gm" && wall.object && (
              <text
                className="vision-object-hp"
                x={middle.x}
                y={middle.y - handle * 1.6}
                textAnchor="middle"
                style={{ fontSize: Math.max(10, cellSizePx * 0.24) }}
              >
                {`${wall.object.hitPoints.current}/${wall.object.hitPoints.maximum} HP`}
              </text>
            )}
            {wall.kind === "door" && !erasing && (
              <g
                className="vision-door-handle"
                data-door-id={wall.id}
                data-door-open={wall.open === true ? "true" : "false"}
                role="button"
                tabIndex={0}
                aria-label={label}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  const box = event.currentTarget.getBoundingClientRect();
                  onDoorMenu(wall.id, box.left, box.bottom);
                }}
              >
                <title>{label}</title>
                <circle className="vision-door-ring" cx={middle.x} cy={middle.y} r={handle} />
                {fastened(wall) && (
                  <rect
                    className="vision-door-lock"
                    x={middle.x - handle * 0.35}
                    y={middle.y - handle * 0.35}
                    width={handle * 0.7}
                    height={handle * 0.7}
                  />
                )}
                <circle className="vision-hit" cx={middle.x} cy={middle.y} r={handle} />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
