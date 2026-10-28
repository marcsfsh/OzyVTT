import { type RefObject } from "react";
import { burst, canMove, comet, fadeIn, rel, useOnChange, wash } from "@vtt/ui";

/** Brings a row into its own scroll region's view, scrolling nothing else: the page never scrolls. */
function revealRow(row: HTMLElement): void {
  const region = row.closest<HTMLElement>(".scroll-y");
  if (!region) return;
  const top = rel(row, region).y;
  if (top < region.scrollTop) region.scrollTop = top;
  else if (top + row.offsetHeight > region.scrollTop + region.clientHeight)
    region.scrollTop = top + row.offsetHeight - region.clientHeight;
}

/** How long a row's light waits for its list to load after the change; the moment still ends inside 500 ms. */
const ROW_WAIT = 150;

/**
 * Runs `light` on the row once it is in the shell, looking each frame for up to `ROW_WAIT`: a list that remounts
 * loads its rows a moment after the address changes. `light` gets how long it waited. Returns the cancel.
 */
function whenRowShows(find: () => HTMLElement | null, light: (row: HTMLElement, waited: number) => void): () => void {
  const start = performance.now();
  let frame = 0;
  const look = () => {
    const row = find();
    const waited = performance.now() - start;
    if (row) light(row, waited);
    else if (waited < ROW_WAIT) frame = requestAnimationFrame(look);
  };
  look();
  return () => cancelAnimationFrame(frame);
}

/**
 * Open a record and Go back (ADR-0045) for a list whose rows open records at their own address: the Codex's pages and
 * the Compendium's tables. Opening falls from the bar onto the record as a wash while it fades in; there is no sideways
 * comet, since the record is deeper in the same section. Where the list stays beside the record, light also runs along
 * the row picked. Going back fades the list in and runs the light back along the row the record came from, so you
 * can see where you were.
 *
 * Rows carry `data-record-key` with the key `recordKey` takes for their record. The light reads the rows after the
 * change: where the record replaced the list, the row picked is gone, and light along it would cross the record.
 * Content never waits for it.
 */
export function useRecordLight(
  host: RefObject<HTMLElement | null>,
  recordKey: string | null,
  parts: Readonly<{ content: string; record?: string }>
): void {
  useOnChange(recordKey, (before, next) => {
    const shell = host.current;
    if (!shell || !canMove()) return;
    const content = shell.querySelector<HTMLElement>(parts.content);
    const rowOf = (key: string) =>
      shell.querySelector<HTMLElement>(`[data-record-key="${key.replace(/["\\]/g, "\\$&")}"]`);
    if (next !== null) {
      const record = (parts.record ? shell.querySelector<HTMLElement>(parts.record) : null) ?? content;
      if (record) {
        const box = rel(record, shell);
        wash(shell, { at: box.cx, top: box.y, h: 220, delay: 150, dur: 280 });
        fadeIn(record);
      }
      return whenRowShows(
        () => rowOf(next),
        (row) => {
          const box = rel(row, shell);
          comet(shell, { from: box.x, to: box.r, line: box.b - 1, thick: 3, dur: 220, delay: 0 });
          burst(shell, { at: box.r - 20, line: box.b - 1, delay: 170, w: 80, h: 8 });
        }
      );
    }
    if (before === null) return;
    if (content) fadeIn(content, { delay: 0 });
    return whenRowShows(
      () => rowOf(before),
      (row, waited) => {
        revealRow(row);
        const box = rel(row, shell);
        const delay = Math.max(0, 100 - waited);
        comet(shell, { from: box.r, to: box.x, line: box.b - 1, thick: 3, dur: 220, delay });
        burst(shell, { at: box.x + 20, line: box.b - 1, delay: delay + 180, w: 80, h: 8 });
      }
    );
  });
}
