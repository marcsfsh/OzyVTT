// Movement over a square grid (SRD 5.2.1 "Difficult Terrain", "Moving Around Other Creatures"). The server
// charges a move with this and the map's drag preview draws it, so both count the same path. Everything is in
// grid cells; callers convert from image pixels with their calibration.

/** A cell by its column and row; the cell spans [column, column + 1) x [row, row + 1) in grid space. */
export type GridCell = Readonly<{ column: number; row: number }>;

/** The top-left cell a footprint covers, from the token's centre in grid space. Odd footprints centre on a
 *  cell, even ones on a grid intersection, as token placement snaps them. */
export function footprintOrigin(center: Readonly<{ column: number; row: number }>, sizeCells: number): GridCell {
  const size = Math.max(1, Math.round(sizeCells));
  return size % 2 === 1
    ? { column: Math.floor(center.column) - (size - 1) / 2, row: Math.floor(center.row) - (size - 1) / 2 }
    : { column: Math.round(center.column) - size / 2, row: Math.round(center.row) - size / 2 };
}

/** The centre of a footprint whose top-left cell is `origin`, in grid space. */
export function footprintCenter(origin: GridCell, sizeCells: number): Readonly<{ column: number; row: number }> {
  const size = Math.max(1, Math.round(sizeCells));
  return { column: origin.column + size / 2, row: origin.row + size / 2 };
}

const SIZE_RANK: Readonly<Record<string, number>> = { tiny: 0, small: 1, medium: 2, large: 3, huge: 4, gargantuan: 5 };

/** What another creature's space is to a mover (SRD "Moving around Other Creatures"): an ally's or a Tiny creature's
 *  is open ground; anyone else's is Difficult Terrain, and the mover may pass through it only when that creature is
 *  Incapacitated or two sizes larger or smaller. */
export type SpacePassage = "open" | "difficult" | "blocked";

export function spacePassage(
  input: Readonly<{ ally: boolean; incapacitated: boolean; moverSize?: string; occupantSize?: string }>
): SpacePassage {
  if (input.ally || input.occupantSize === "tiny") return "open";
  const gap = Math.abs(
    (SIZE_RANK[input.moverSize ?? "medium"] ?? 2) - (SIZE_RANK[input.occupantSize ?? "medium"] ?? 2)
  );
  return input.incapacitated || gap >= 2 ? "difficult" : "blocked";
}

export type MovementPath = Readonly<{
  /** Footprint origins from start to end, both included. */
  steps: readonly GridCell[];
  /** Movement spent, in cells: one per step, two for a step into difficult terrain, and `extraPerStep` more on every
   *  step (crawling, climbing or swimming without the speed, dragging a grappled creature). */
  costCells: number;
  /** How many steps entered difficult terrain (each cost one extra cell). */
  difficultSteps: number;
  /** No way there: creatures the mover can't pass, or the map's edge, close it off. `steps` is empty. */
  blocked?: true;
}>;

type Node = { key: number; column: number; row: number; cost: number; priority: number; tie: number };

/** Keeps the cheapest node on top; ties go to the smaller tie-break, then to the earlier-pushed node, so the
 *  path is the same on every machine. */
class Queue {
  private readonly items: Node[] = [];
  get size() {
    return this.items.length;
  }
  private less(a: Node, b: Node) {
    return a.priority !== b.priority ? a.priority < b.priority : a.tie !== b.tie ? a.tie < b.tie : a.key < b.key;
  }
  push(node: Node) {
    const items = this.items;
    items.push(node);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(items[index]!, items[parent]!)) break;
      [items[index], items[parent]] = [items[parent]!, items[index]!];
      index = parent;
    }
  }
  pop(): Node | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && this.less(items[left]!, items[smallest]!)) smallest = left;
        if (right < items.length && this.less(items[right]!, items[smallest]!)) smallest = right;
        if (smallest === index) break;
        [items[index], items[smallest]] = [items[smallest]!, items[index]!];
        index = smallest;
      }
    }
    return top;
  }
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];

/**
 * The cheapest path a footprint can take from `from` to `to` (both top-left cells), stepping to any of the
 * eight neighbouring positions. A step costs one cell, or two when any cell of the footprint's new position is
 * difficult; the extra cost doesn't stack. Among equally cheap paths it keeps closest to the straight line, so
 * the preview reads naturally. Null when the search gives up (`maxNodes`), and callers then fall back to the
 * straight-line count.
 */
export function movementPath(
  input: Readonly<{
    from: GridCell;
    to: GridCell;
    sizeCells: number;
    /** Whether entering this cell costs double. */
    isDifficult: (column: number, row: number) => boolean;
    /** Whether a footprint may stand on this cell, such as being on the map at all. Every cell is open when absent. */
    isOpen?: (column: number, row: number) => boolean;
    /** Cells added to every step's cost (1 while crawling, climbing or swimming without the speed). */
    extraPerStep?: number;
    maxNodes?: number;
  }>
): MovementPath | null {
  const size = Math.max(1, Math.round(input.sizeCells));
  const { from, to } = input;
  const straight = Math.max(Math.abs(to.column - from.column), Math.abs(to.row - from.row));
  if (straight === 0) return { steps: [from], costCells: 0, difficultSteps: 0 };
  // No path costs more than walking straight through difficult ground (2 per step), so nothing cheaper lies
  // further than that from the start.
  const radius = straight * 2 + 1;
  const width = radius * 2 + 1;
  const keyOf = (column: number, row: number) => (row - from.row + radius) * width + (column - from.column + radius);
  const inBox = (column: number, row: number) =>
    Math.abs(column - from.column) <= radius && Math.abs(row - from.row) <= radius;

  const openCache = new Map<number, boolean>();
  const footprintFits = (column: number, row: number) => {
    if (!input.isOpen) return true;
    const key = keyOf(column, row);
    const cached = openCache.get(key);
    if (cached !== undefined) return cached;
    let open = true;
    for (let dc = 0; dc < size && open; dc++)
      for (let dr = 0; dr < size && open; dr++) open = input.isOpen(column + dc, row + dr);
    openCache.set(key, open);
    return open;
  };
  const difficultCache = new Map<number, boolean>();
  const enteringIsDifficult = (column: number, row: number) => {
    const key = keyOf(column, row);
    const cached = difficultCache.get(key);
    if (cached !== undefined) return cached;
    let difficult = false;
    for (let dc = 0; dc < size && !difficult; dc++)
      for (let dr = 0; dr < size && !difficult; dr++) difficult = input.isDifficult(column + dc, row + dr);
    difficultCache.set(key, difficult);
    return difficult;
  };
  // Distance from the straight segment, in grid units, to prefer the natural-looking route among equal costs.
  const dx = to.column - from.column;
  const dy = to.row - from.row;
  const length = Math.hypot(dx, dy);
  const offLine = (column: number, row: number) =>
    Math.abs((column - from.column) * dy - (row - from.row) * dx) / length;
  const heuristic = (column: number, row: number) => Math.max(Math.abs(to.column - column), Math.abs(to.row - row));

  const best = new Map<number, number>();
  const parent = new Map<number, number>();
  const extra = new Map<number, number>();
  const startKey = keyOf(from.column, from.row);
  best.set(startKey, 0);
  extra.set(startKey, 0);
  const queue = new Queue();
  queue.push({
    key: startKey,
    column: from.column,
    row: from.row,
    cost: 0,
    priority: heuristic(from.column, from.row),
    tie: 0
  });
  const goalKey = keyOf(to.column, to.row);
  const limit = input.maxNodes ?? 40_000;
  const extraPerStep = Math.max(0, input.extraPerStep ?? 0);
  let expanded = 0;

  while (queue.size > 0) {
    const node = queue.pop()!;
    if (node.cost !== best.get(node.key)) continue;
    if (node.key === goalKey) break;
    if (++expanded > limit) return null;
    for (const [stepColumn, stepRow] of NEIGHBOURS) {
      const column = node.column + stepColumn;
      const row = node.row + stepRow;
      if (!inBox(column, row) || !footprintFits(column, row)) continue;
      const difficult = enteringIsDifficult(column, row);
      const cost = node.cost + (difficult ? 2 : 1) + extraPerStep;
      const key = keyOf(column, row);
      const known = best.get(key);
      if (known !== undefined && known <= cost) continue;
      best.set(key, cost);
      parent.set(key, node.key);
      extra.set(key, (extra.get(node.key) ?? 0) + (difficult ? 1 : 0));
      queue.push({ key, column, row, cost, priority: cost + heuristic(column, row), tie: offLine(column, row) });
    }
  }

  const cost = best.get(goalKey);
  // The whole box was searched and nothing reached the goal: the way is shut, not merely long.
  if (cost === undefined)
    return queue.size === 0 ? { steps: [], costCells: 0, difficultSteps: 0, blocked: true } : null;
  const steps: GridCell[] = [];
  for (let key: number | undefined = goalKey; key !== undefined; key = parent.get(key)) {
    const column = (key % width) - radius + from.column;
    const row = Math.floor(key / width) - radius + from.row;
    steps.push({ column, row });
    if (key === startKey) break;
  }
  steps.reverse();
  return { steps, costCells: cost, difficultSteps: extra.get(goalKey) ?? 0 };
}

/** Whether a point lies in any of the rects, edges included. */
export function pointInRects(
  point: Readonly<{ x: number; y: number }>,
  rects: ReadonlyArray<Readonly<{ x: number; y: number; width: number; height: number }>>
): boolean {
  return rects.some(
    (rect) =>
      point.x >= rect.x - 1e-6 &&
      point.y >= rect.y - 1e-6 &&
      point.x <= rect.x + rect.width + 1e-6 &&
      point.y <= rect.y + rect.height + 1e-6
  );
}
