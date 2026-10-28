import type { Actor, EffectInstance, GameState } from "@vtt/domain";

/**
 * A creature's form while it lasts (SRD Rules Glossary, Shape-Shifting), read and undone from the game state alone.
 * The definition a form gives its bearer is stored with the campaign as `form-<actorId>` and the bearer's
 * `definitionId` points at it, so every rule that reads the bearer's stat block reads the form. The form's effect
 * keeps the definition it had before, and ending the effect gives it back (`revertForm`).
 */

export type CreatureSize = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";

/** The sizes in order, smallest first. */
export const SIZES: readonly CreatureSize[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

/** Square-grid footprint per size: Tiny, Small and Medium share one cell. */
export const SIZE_FOOTPRINT: Readonly<Record<CreatureSize, number>> = {
  tiny: 1,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4
};

const FORM_PREFIX = "form-";

/** The stored definition id of the form a creature has taken. */
export const formDefinitionId = (actorId: string): string => `${FORM_PREFIX}${actorId}`;

/** Whether a stored definition is a creature's form, which comes and goes with it. */
export const isFormDefinitionId = (definitionId: string): boolean => definitionId.startsWith(FORM_PREFIX);

/** The effect holding the form a creature has taken, if any. One form at a time: taking another ends the first. */
export function formEffectOf(actor: Pick<Actor, "effects">): EffectInstance | undefined {
  return actor.effects.find((effect) => effect.form !== undefined);
}

/** The definition a creature has in its true form: the one its form replaced, else its own. */
export function trueDefinitionIdOf(actor: Pick<Actor, "effects" | "definitionId">): string | undefined {
  return formEffectOf(actor)?.form?.trueDefinitionId ?? actor.definitionId;
}

/** The id of the form a creature is in (`true` for its true form): a printed form's, else the stat block's. */
export function currentFormId(actor: Pick<Actor, "effects">): string {
  const form = formEffectOf(actor)?.form;
  return form ? (form.printedId ?? form.statBlockId ?? "form") : "true";
}

/** Its gear melded into its form and gives nothing while it lasts (Polymorph: "can't use or otherwise benefit from any
 *  of that equipment"). */
export function gearMerged(actor: Pick<Actor, "effects">): boolean {
  return formEffectOf(actor)?.form?.gear === "merged";
}

/** Whether an effect changes its bearer's size. */
const changesSize = (effect: EffectInstance): boolean =>
  effect.sizeChange !== undefined || effect.form?.size !== undefined;

/**
 * The bearer's size from what changes it, in the order it applies: its own size, then a form's (a werewolf's Large
 * hybrid), then a set size (Large Form), then each step (Enlarge, Reduce), kept between Tiny and Gargantuan. The size it
 * had before any of them is kept on each such effect (`ownSize`), so the last to end gives it back. Its tokens take the
 * new footprint (`resizeTokens`). `ending` is an effect just removed, whose kept size is the fallback.
 */
export function refreshSize(state: GameState, actor: Actor, ending?: EffectInstance): void {
  const changing = actor.effects.filter(changesSize);
  const own = changing.find((effect) => effect.ownSize !== undefined)?.ownSize ?? ending?.ownSize;
  if (own === undefined) return;
  const ownSize = (own.size ?? "medium") as CreatureSize;
  let size = ownSize;
  const form = changing.find((effect) => effect.form?.size !== undefined)?.form;
  if (form?.size) size = form.size;
  for (const effect of changing) if (effect.sizeChange?.to) size = effect.sizeChange.to;
  const steps = changing.reduce((sum, effect) => sum + (effect.sizeChange?.step ?? 0), 0);
  size = SIZES[Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(size) + steps))]!;
  const cells = changing.length === 0 ? (own.sizeCells ?? SIZE_FOOTPRINT[ownSize]) : SIZE_FOOTPRINT[size];
  const previousCells = actor.sizeCells ?? 1;
  if (changing.length === 0) {
    if (own.size === undefined) delete actor.size;
    else actor.size = own.size;
    if (own.sizeCells === undefined) delete actor.sizeCells;
    else actor.sizeCells = own.sizeCells;
  } else {
    actor.size = size;
    actor.sizeCells = cells;
  }
  resizeTokens(state, actor.id, previousCells, actor.sizeCells ?? 1, actor.size as CreatureSize | undefined);
}

/** What a one-cell token is drawn at within its cell (`token-placement.ts`), by size. */
const SINGLE_CELL_DIAMETER: Readonly<Record<"tiny" | "small" | "medium", number>> = {
  tiny: 0.5,
  small: 0.66,
  medium: 0.82
};

const rounded = (value: number) => Math.round(value * 1_000) / 1_000;

/**
 * The creature's tokens take its new footprint on the live map and in prepared scenes. The corner of its space nearest
 * the map's origin stays where it was, so a creature that grows spreads right and down from its space and one that
 * shrinks keeps that corner cell (the GM moves it where the room says otherwise). A calibrated map draws a one-cell
 * token by its size; a gridless one scales the token by the footprint.
 */
export function resizeTokens(
  state: GameState,
  actorId: string,
  previousCells: number,
  cells: number,
  size: CreatureSize | undefined
): void {
  const resize = (token: GameState["combat"]["tokens"][number]) => {
    if (token.actorId !== actorId) return token;
    const grid = token.gridSizePx;
    const sizePx =
      grid !== null
        ? rounded(
            cells === 1
              ? grid * SINGLE_CELL_DIAMETER[size === "tiny" || size === "small" ? size : "medium"]
              : grid * (cells - 0.08)
          )
        : rounded((token.sizePx * cells) / Math.max(1, token.sizeCells));
    if (cells === token.sizeCells && sizePx === token.sizePx) return token;
    const shift = grid !== null && token.position !== null ? ((cells - previousCells) * grid) / 2 : 0;
    const position =
      token.position === null
        ? null
        : { x: rounded(Math.max(0, token.position.x + shift)), y: rounded(Math.max(0, token.position.y + shift)) };
    return { ...token, sizeCells: cells, sizePx, position };
  };
  state.combat.tokens = state.combat.tokens.map(resize);
  state.combat.encounters = state.combat.encounters.map((scene) =>
    scene.combat.tokens.some((token) => token.actorId === actorId)
      ? { ...scene, combat: { ...scene.combat, tokens: scene.combat.tokens.map(resize) } }
      : scene
  );
}

/**
 * The bearer returns to its true form as the effect holding its form ends (SRD Shape-Shifting): its own definition,
 * Speed and Armor Class come back, the stored form goes, any Temporary Hit Points the form gave that are left vanish,
 * and its size is worked out again. Conditions and other effects stay, as they carried over.
 */
export function revertForm(state: GameState, actor: Actor, effect: EffectInstance): string | null {
  const form = effect.form;
  if (!form) return null;
  const formId = formDefinitionId(actor.id);
  if (actor.definitionId === formId && form.trueDefinitionId !== undefined) actor.definitionId = form.trueDefinitionId;
  if (!actor.effects.some((other) => other.form !== undefined))
    state.definitions = state.definitions.filter((entry) => entry.id !== formId);
  if (form.trueStats?.speedFeet !== undefined) actor.speedFeet = form.trueStats.speedFeet;
  if (form.trueStats?.armorClass !== undefined) actor.armorClass = form.trueStats.armorClass;
  let vanished = false;
  if (form.temporaryHitPoints !== undefined && actor.hp.temporary > 0) {
    actor.hp = { ...actor.hp, temporary: 0 };
    vanished = true;
  }
  if (changesSize(effect)) refreshSize(state, actor, effect);
  return vanished
    ? `${actor.name} returns to its true form, and the Temporary Hit Points of ${form.name} vanish.`
    : `${actor.name} returns to its true form.`;
}

/** The size a size change gives a creature of `size` (Large Form: Large; Enlarge: one larger). */
export function changedSize(size: CreatureSize, change: Readonly<{ to?: string; step?: number }>): CreatureSize {
  if (change.to) return change.to as CreatureSize;
  return SIZES[Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(size) + (change.step ?? 0)))]!;
}

/**
 * Whether a creature has room on the live map to grow to `cells` across (Large Form: "if you're in a big enough
 * space"): the space it would take, spreading right and down from its own, must hold no other creature's token. The
 * name of a creature in the way, or null. `ignored` leaves out creatures the asker can't know are there.
 */
export function blockerOfGrowth(
  state: GameState,
  actorId: string,
  cells: number,
  ignored: (actorId: string) => boolean = () => false
): string | null {
  const token = state.combat.tokens.find((entry) => entry.actorId === actorId);
  if (!token?.position || token.gridSizePx === null || cells <= token.sizeCells) return null;
  const grid = token.gridSizePx;
  const left = token.position.x - (token.sizeCells * grid) / 2;
  const top = token.position.y - (token.sizeCells * grid) / 2;
  const box = { left, top, right: left + cells * grid, bottom: top + cells * grid };
  const slack = grid * 0.05;
  for (const other of state.combat.tokens) {
    if (other.actorId === actorId || !other.position || ignored(other.actorId)) continue;
    const half = (other.sizeCells * grid) / 2;
    const overlaps =
      other.position.x + half > box.left + slack &&
      other.position.x - half < box.right - slack &&
      other.position.y + half > box.top + slack &&
      other.position.y - half < box.bottom - slack;
    if (overlaps) return state.actors.find((actor) => actor.id === other.actorId)?.name ?? "Another creature";
  }
  return null;
}
