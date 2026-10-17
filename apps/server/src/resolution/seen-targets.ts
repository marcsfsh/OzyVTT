import type { ActionResolution } from "@vtt/domain";

/**
 * A resolution as a player may read it: every part that names a creature keeps only the creatures they may see. An
 * area catches whoever stands under it, and the reply to the caster's player must not list one hidden from them.
 */
export function withSeenTargets(resolution: ActionResolution, unseen: ReadonlySet<string>): ActionResolution {
  if (unseen.size === 0) return resolution;
  const seen = (id: string) => !unseen.has(id);
  const attackHidden = resolution.attack !== null && !seen(resolution.attack.targetId);
  return {
    ...resolution,
    attack: attackHidden ? null : resolution.attack,
    save: resolution.save
      ? { ...resolution.save, targets: resolution.save.targets.filter((target) => seen(target.targetId)) }
      : null,
    ...(resolution.effectsApplied
      ? { effectsApplied: resolution.effectsApplied.filter((effect) => seen(effect.targetId)) }
      : {}),
    ...(resolution.healing
      ? {
          healing: {
            ...resolution.healing,
            targets: resolution.healing.targets.filter((target) => seen(target.targetId))
          }
        }
      : {}),
    ...(resolution.damageTargets
      ? { damageTargets: resolution.damageTargets.filter((target) => seen(target.targetId)) }
      : {}),
    ...(resolution.reactionPrompts
      ? { reactionPrompts: resolution.reactionPrompts.filter((prompt) => seen(prompt.actorId)) }
      : {}),
    ...(resolution.effectsEnded
      ? { effectsEnded: resolution.effectsEnded.filter((ended) => seen(ended.actorId)) }
      : {}),
    // A line naming a hidden creature is the GM's; the reply's projection drops GM-only lines for players.
    ...(resolution.tableNarration
      ? {
          tableNarration: resolution.tableNarration.map((line) =>
            line.actorIds.every(seen) ? line : { ...line, gmOnly: true }
          )
        }
      : {}),
    // A push names its target only by name; it is the attack's, and an area never pushes.
    ...(attackHidden ? { push: null } : {})
  };
}
