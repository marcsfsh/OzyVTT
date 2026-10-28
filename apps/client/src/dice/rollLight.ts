import { burst, canMove, comet, countUp, fadeIn, flash, pop, rel } from "@vtt/ui";

type Die = Readonly<{ sides: number; face: number; kept: boolean }>;

/** Where a roll card draws the parts its light needs. */
export type RollParts = Readonly<{ dice: string; total: string; nat?: string }>;

/** The d20 that counts, and the one that doesn't when two were rolled (Advantage, Disadvantage). */
export function d20s(dice: readonly Die[]): { kept: number | null; dropped: number | null } {
  const twenties = dice.flatMap((die, index) => (die.sides === 20 ? [{ ...die, index }] : []));
  const kept = twenties.find((die) => die.kept);
  const dropped = twenties.length === 2 ? twenties.find((die) => !die.kept) : undefined;
  return { kept: kept?.index ?? null, dropped: dropped?.index ?? null };
}

/** NAT 20 or NAT 1 when the kept d20 shows one, for the tag beside the check. */
export function natural(dice: readonly Die[]): "NAT 20" | "NAT 1" | null {
  const { kept } = d20s(dice);
  const face = kept === null ? null : dice[kept]?.face;
  return face === 20 ? "NAT 20" : face === 1 ? "NAT 1" : null;
}

/**
 * A roll landing on its card (ADR-0045, group 4): a comet runs along the card's top edge from the die to the total,
 * which counts up as the burst lands. A natural 20 flashes the card for two frames and lands a gold burst twice as
 * wide; a natural 1 sends the light back to the die and dims the total briefly. With two d20s, light runs from the
 * one that doesn't count to the one that does. `card` must be positioned; its dice are in the roll's order.
 */
export function rollLands(card: HTMLElement, dice: readonly Die[], total: number, parts: RollParts): void {
  if (!canMove()) return;
  const sum = card.querySelector<HTMLElement>(parts.total);
  if (!sum) return;
  const faces = [...card.querySelectorAll<HTMLElement>(parts.dice)];
  const { kept, dropped } = d20s(dice);
  const keptFace = kept === null ? null : (dice[kept]?.face ?? null);
  const keptEl = kept === null ? faces[0] : faces[kept];
  const at = rel(sum, card);
  const dx = keptEl ? rel(keptEl, card).cx : 0;
  const tag = parts.nat ? card.querySelector<HTMLElement>(parts.nat) : null;
  const droppedEl = dropped === null ? undefined : faces[dropped];
  if (droppedEl && keptEl) {
    const ox = rel(droppedEl, card).cx;
    comet(card, { from: ox, to: dx, line: 0, delay: 160, dur: 200 });
    // One start keyframe: it settles on the discarded die's own dimming.
    droppedEl.animate([{ offset: 0, opacity: 1 }], { duration: 200, delay: 160, fill: "backwards" });
    burst(card, { at: dx, line: 0, delay: 330, w: 90 });
    void countUp(sum, 0, total, { delay: 300, dur: 260 });
    pop(card, { x: at.cx, y: at.cy, size: 90, delay: 420 });
  } else if (keptFace === 1) {
    comet(card, { from: at.cx, to: dx, line: 0, delay: 40, dur: 230, tone: "red" });
    void countUp(sum, 0, total, { delay: 40, dur: 200 });
    sum.animate([{ opacity: 1 }, { offset: 0.4, opacity: 0.3 }, { opacity: 1 }], { duration: 380, delay: 240 });
  } else {
    comet(card, { from: dx, to: at.cx, line: 0, delay: 0, dur: 230 });
    burst(card, {
      at: at.cx,
      line: 0,
      delay: 200,
      w: keptFace === 20 ? 240 : 110,
      tone: keptFace === 20 ? "gold" : undefined
    });
    void countUp(sum, 0, total, { delay: 60, dur: 300 });
  }
  if (keptFace === 20) {
    flash(card, { delay: 200 });
    pop(card, { x: at.cx, y: at.cy, size: 150, delay: 240, dur: 280, tone: "gold" });
  }
  if (tag) fadeIn(tag, { delay: keptFace === 1 ? 240 : 200, dur: 140 });
}
