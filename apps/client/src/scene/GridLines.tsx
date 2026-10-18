import type { GridCalibration } from "./gridPreview";

/**
 * The calibrated grid drawn over the map's art, so the GM can check it lines up with the printed squares. The server
 * keeps rotation at 0 (`grid-calibration.ts`), so the lines are upright.
 */
export function GridLines({
  calibration,
  width,
  height
}: Readonly<{ calibration: GridCalibration; width: number; height: number }>) {
  const { origin, cellSizePx } = calibration;
  if (!(cellSizePx > 0)) return null;
  const first = (start: number) => start - Math.floor(start / cellSizePx) * cellSizePx;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = first(origin.x); x <= width; x += cellSizePx) xs.push(x);
  for (let y = first(origin.y); y <= height; y += cellSizePx) ys.push(y);
  return (
    <g className="map-grid-lines" aria-hidden="true">
      {xs.map((x) => (
        <line key={`x${x}`} x1={x} y1={0} x2={x} y2={height} />
      ))}
      {ys.map((y) => (
        <line key={`y${y}`} x1={0} y1={y} x2={width} y2={y} />
      ))}
    </g>
  );
}
