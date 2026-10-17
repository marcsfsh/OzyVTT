type Point = Readonly<{ x: number; y: number }>;
type Wall = Readonly<{ id: string; kind: "wall" | "door" | "window"; a: Point; b: Point; open?: boolean }>;
type Light = Readonly<{
  id: string;
  position: Point | null;
  actorId: string | null;
  brightFeet: number;
  dimFeet: number;
}>;

/**
 * Dynamic vision's marks on the map: for the GM, every wall, door, window and light (tap targets for the Remove tool);
 * for a player, the doors in sight, whose handle opens or closes one beside their character. Handles keep a 44-pixel
 * touch ring whatever the zoom.
 */
export function VisionLayer({
  role,
  walls,
  lights = [],
  tokenPositions,
  pixelsPerFoot,
  cellSizePx,
  showWalls,
  erasing,
  onToggleDoor
}: Readonly<{
  role: "gm" | "player";
  walls: readonly Wall[];
  lights?: readonly Light[];
  /** Where each placed token stands, for the lights creatures carry. */
  tokenPositions: ReadonlyMap<string, Point>;
  pixelsPerFoot: number | null;
  cellSizePx: number;
  /** Draw walls and windows (the GM while editing or with vision on); doors are always drawn. */
  showWalls: boolean;
  /** The Remove tool is on: walls and lights take taps. */
  erasing: boolean;
  /** A door's handle from the keyboard; taps reach the map's gestures. */
  onToggleDoor: (wallId: string, open: boolean) => void;
}>) {
  const handle = Math.max(6, cellSizePx * 0.18);
  return (
    <g className={`vision-layer${erasing ? " erasing" : ""}`}>
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
        if (wall.kind !== "door" && !showWalls) return null;
        const middle = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
        const state = wall.kind === "door" ? (wall.open === true ? " open" : wall.open === false ? " closed" : "") : "";
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
            {wall.kind === "door" && !erasing && (
              <g
                className="vision-door-handle"
                data-door-id={wall.id}
                data-door-open={wall.open === true ? "true" : "false"}
                role="button"
                tabIndex={0}
                aria-label={wall.open === true ? "Close the door" : "Open the door"}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onToggleDoor(wall.id, wall.open !== true);
                }}
              >
                <title>{wall.open === true ? "Close the door" : "Open the door"}</title>
                <circle className="vision-door-ring" cx={middle.x} cy={middle.y} r={handle} />
                <circle className="vision-hit" cx={middle.x} cy={middle.y} r={handle} />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
