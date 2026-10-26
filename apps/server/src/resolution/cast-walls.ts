import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { VisionWall } from "@vtt/domain";
import { arcaneLock, heldShutAgainst, isHiddenDoor, knockOn } from "../doors.js";
import { addEffect, makeEffect } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { laterRowOf } from "../item-actions.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { cutWall, disintegrateWall, nearestPointOf, raiseSpellWalls } from "../spell-walls.js";
import { policeBarrier } from "../zone-barriers.js";
import { pickedZoneRow } from "../spell-zones.js";
import { distance, type Point } from "../vision/geometry.js";
import { sceneSight } from "../vision/sight.js";
import { spellEffectDuration, spellOf } from "./concentration.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/**
 * What a cast does to the map's walls and doors (the spell's `walls`): the walls its placed area raises (Wall of Force,
 * Wall of Stone, Wall of Ice, Forcecage), and what it does to the door or wall it is aimed at: Knock unlocks it, Arcane
 * Lock locks it, Mage Hand and Thaumaturgy open or shut an unlocked door, Elementalism closes one, Stone Shape seals a
 * door or cuts a passage, Passwall cuts one for its duration, and Disintegrate destroys a wall of force or an object.
 * A door or wall aimed at must be on the live map, within the spell's range of the caster and, with dynamic vision on,
 * seen by it where the spell needs that.
 */

/** Spells whose walls Disintegrate destroys whole: creations of magical force. */
const FORCE_SPELLS: ReadonlySet<string> = new Set(["wall-of-force", "forcecage"]);
/** Spells that need the door or wall they act on to be seen ("an object that you can see", "a point that you can
 *  see"). */
const NEEDS_SIGHT: ReadonlySet<string> = new Set(["knock", "passwall", "disintegrate"]);
/** A touch reaches 5 feet. */
const TOUCH_FEET = 5;

type Walls = NonNullable<SpellReference["walls"]>;

function pixelsPerFootOf(ctx: ResolveContext): number | null {
  return ctx.state.combat.vision.measure?.pixelsPerFoot ?? null;
}

/** The spell's walls when this action casts it or is one of its later actions that acts on a door (Mage Hand). */
function wallsOf(ctx: ResolveContext): { spell: SpellReference; walls: Walls; later: boolean } | null {
  const spell = spellOf(ctx);
  const walls = spell?.walls;
  if (!spell || !walls) return null;
  return { spell, walls, later: laterRowOf(spell, ctx.action.id) !== undefined };
}

/** The wall the cast is aimed at, checked against the spell: the right kind, in range and seen. Throws before anything
 *  is spent. */
export function checkWallTarget(ctx: ResolveContext): void {
  const { input, state, attacker } = ctx;
  if (input.wallId === undefined) return;
  const cast = wallsOf(ctx);
  if (!cast || (!cast.walls.door && !cast.walls.cuts && !cast.walls.disintegrates))
    throw new CommandRejectedError(`${ctx.action.name} doesn't act on a door or a wall.`);
  const wall = state.combat.vision.walls.find((candidate) => candidate.id === input.wallId);
  // A secret door is wall to a player.
  const asDoor = wall?.kind === "door" && !(isHiddenDoor(wall) && ctx.deps.initiatorRole === "player");
  const fits =
    wall !== undefined &&
    ((asDoor && cast.walls.door !== undefined) ||
      (!asDoor && cast.walls.cuts !== undefined) ||
      (cast.walls.disintegrates === true &&
        (wall.kind === "door" || wall.object !== undefined || wall.source !== undefined)));
  if (!wall || !fits)
    throw new CommandRejectedError(
      cast.walls.door && !cast.walls.cuts ? "Choose a door on the map." : "Choose a door or a wall on the map."
    );
  const at = nearestPointOf(state, wall, attacker.id);
  const pixelsPerFoot = pixelsPerFootOf(ctx);
  const casterAt = state.combat.tokens.find((token) => token.actorId === attacker.id);
  if (at && pixelsPerFoot && casterAt?.position) {
    const range = cast.spell.range.text === "Touch" ? TOUCH_FEET : (cast.spell.range.distance ?? null);
    const half = ((casterAt.gridSizePx ?? casterAt.sizePx) * casterAt.sizeCells) / 2;
    const feet = Math.max(0, distance(casterAt.position, at) - half) / pixelsPerFoot;
    if (range !== null && feet > range + DISTANCE_TOLERANCE_FEET) {
      const said = policeBarrier(
        state,
        input.override ?? null,
        "range.out-of-range",
        `That ${asDoor ? "door" : "wall"} is ${Math.round(feet)} ft away, beyond ${cast.spell.name}'s ${range} ft.`
      );
      if (said) ctx.warnings.push(said);
    }
    if (NEEDS_SIGHT.has(cast.spell.id)) {
      const sight = sceneSight(state, {
        ...(ctx.deps.resolveDefinition ? { definition: ctx.deps.resolveDefinition } : {}),
        ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
      });
      // Look at the wall's face from the caster's side, a pixel short of the wall itself.
      const gap = distance(casterAt.position, at);
      const face: Point =
        gap > 1 ? { x: at.x + (casterAt.position.x - at.x) / gap, y: at.y + (casterAt.position.y - at.y) / gap } : at;
      if (sight.enabled && !sight.seesPoint(attacker.id, face)) {
        const said = policeBarrier(
          state,
          input.override ?? null,
          "target.unseen",
          `${attacker.name} can't see that ${asDoor ? "door" : "wall"}.`
        );
        if (said) ctx.warnings.push(said);
      }
    }
  }
  // Mage Hand and Invisible Hand open only "an unlocked door".
  if (asDoor && (cast.walls.door === "open-or-close" || cast.walls.door === "close")) {
    const held = wall.open === true ? null : heldShutAgainst(state, wall, null);
    if (held && cast.walls.door === "open-or-close") throw new CommandRejectedError(held);
  }
}

/** What keeps the cast's walls and gaps: its Concentration, the effect it left on its caster, or, for a spell with
 *  neither (Passwall's hour), a marker of its own on the caster for the spell's duration. */
function keeperOf(ctx: ResolveContext, spell: SpellReference): { castId: string | null; effectId: string | null } {
  const { attacker, input, state } = ctx;
  if (ctx.castId !== null) return { castId: ctx.castId, effectId: null };
  const marker = `${input.commandId}:spell`;
  if (attacker.effects.some((effect) => effect.id === marker)) return { castId: null, effectId: marker };
  const level = ctx.plan.castLevel ?? spell.level;
  const duration = spellEffectDuration(spell, level);
  if (duration.type === "manual") return { castId: null, effectId: null };
  const id = `${input.commandId}:walls`;
  addEffect(
    state,
    attacker.id,
    makeEffect({
      id,
      name: spell.name,
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: ctx.action.id,
      startedRound: state.combat.round,
      duration,
      spell: { id: spell.id, level }
    })
  );
  return { castId: null, effectId: id };
}

/** Applies the cast's walls: raises them on its placed area, or acts on the door or wall it is aimed at. */
export function applyCastWalls(ctx: ResolveContext): void {
  const cast = wallsOf(ctx);
  if (!cast) return;
  const { state, attacker, input } = ctx;
  const { spell, walls } = cast;
  const level = ctx.plan.castLevel ?? spell.level;
  const pixelsPerFoot = pixelsPerFootOf(ctx);
  const told = (text: string) =>
    ctx.tableNarration.push(tableLineOf(ctx, { kind: "effect", text, actorId: attacker.id }));

  if (walls.raises && input.placedArea && pixelsPerFoot && !cast.later) {
    const keeper = keeperOf(ctx, spell);
    const full = spellEffectDuration(spell, level);
    // The form the cast picked (Wall of Stone's thin panels, Wall of Force's globe) and the panels it prints.
    const row = pickedZoneRow(spell, input.option);
    const form = walls.raises.forms?.find((candidate) => candidate.option === input.option);
    const events = raiseSpellWalls(state, {
      commandId: input.commandId,
      casterId: attacker.id,
      spellId: spell.id,
      level,
      raises: {
        ...walls.raises,
        ...(form?.panelFeet !== undefined ? { panelFeet: form.panelFeet } : {}),
        ...(form?.panel ? { panel: form.panel } : {})
      },
      area: input.placedArea,
      widthFeet: (row?.area ?? spell.area)?.widthFeet ?? null,
      pixelsPerFoot,
      ...keeper,
      ...(full.type === "rounds"
        ? { fullDuration: { rounds: full.remaining, minutes: Math.ceil(full.remaining / 10) } }
        : full.type === "minutes"
          ? { fullDuration: { rounds: full.remaining * 10, minutes: full.remaining } }
          : {}),
      ...(ctx.deps.resolveDefinition ? { resolveDefinition: ctx.deps.resolveDefinition } : {})
    });
    for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
  }

  if (input.wallId === undefined) return;
  const wall: VisionWall | undefined = state.combat.vision.walls.find((candidate) => candidate.id === input.wallId);
  if (!wall) return;
  const at = nearestPointOf(state, wall, attacker.id) ?? { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
  const asDoor = wall.kind === "door" && !(isHiddenDoor(wall) && ctx.deps.initiatorRole === "player");

  if (walls.disintegrates && pixelsPerFoot) {
    const events = disintegrateWall(state, wall.id, at, pixelsPerFoot, FORCE_SPELLS);
    for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
    told(`${spell.name} turns ${asDoor ? "the door" : "the wall"} to dust.`);
    return;
  }
  if (asDoor && walls.door) {
    switch (walls.door) {
      case "knock":
        told(knockOn(state, wall.id));
        return;
      case "arcane-lock":
        // The creatures the caster designates: the ones it named as the cast's targets.
        arcaneLock(
          state,
          wall.id,
          attacker.id,
          ctx.targets.map((target) => target.id)
        );
        told(`${attacker.name} locks the door with Arcane Lock.`);
        return;
      case "open-or-close":
      case "close": {
        const open = walls.door === "close" ? false : wall.open !== true;
        writeOpen(ctx, wall.id, open);
        told(`The door ${open ? "flies open" : "slams shut"}.`);
        return;
      }
      case "seal":
        writeOpen(ctx, wall.id, false, true);
        told(`${attacker.name} shapes the stone and seals the door shut.`);
        return;
    }
  }
  if (!asDoor && walls.cuts && pixelsPerFoot) {
    const keeper = walls.cuts.lasting ? null : keeperOf(ctx, spell);
    cutWall(
      state,
      wall.id,
      at,
      walls.cuts.feet,
      pixelsPerFoot,
      keeper && (keeper.castId || keeper.effectId)
        ? {
            casterId: attacker.id,
            spellId: spell.id,
            level,
            ...(keeper.castId ? { castId: keeper.castId } : {}),
            ...(keeper.effectId ? { effectId: keeper.effectId } : {})
          }
        : undefined
    );
    told(`A passage opens through the wall.`);
  }
}

function writeOpen(ctx: ResolveContext, wallId: string, open: boolean, seal = false): void {
  const vision = ctx.state.combat.vision;
  ctx.state.combat = {
    ...ctx.state.combat,
    vision: {
      ...vision,
      walls: vision.walls.map((wall) =>
        wall.id !== wallId
          ? wall
          : {
              ...wall,
              open,
              ...(seal
                ? {
                    door: {
                      ...(wall.door ?? { fastenings: [] }),
                      fastenings: [...(wall.door?.fastenings ?? []), { kind: "sealed" as const }].slice(-6)
                    }
                  }
                : {})
            }
      )
    }
  };
}
