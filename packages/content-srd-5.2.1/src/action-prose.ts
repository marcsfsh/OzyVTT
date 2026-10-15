/**
 * What an action's prose says that play needs as data. Read where an action enters the system (the content
 * build, a homebrew save, an import), so the engine never reads prose while a fight runs.
 */
import type { ActionArea, ActorAction } from "@vtt/schemas";

/**
 * The area of effect a description names. SRD 2024 phrasing is consistent enough to pattern-match ("60-foot
 * Cone", "60-foot-long, 5-foot-wide Line", "20-foot-radius Sphere", "15-foot Emanation", "10-foot Cube").
 * Null when it names none, and the GM targets tokens directly. A line that omits its width is 5 feet wide.
 */
export function areaOfProse(description: string): ActionArea | null {
  const line = /(\d+)-foot(?:-long)?(?:,?\s*(\d+)-foot-wide)?\s+Line/i.exec(description);
  if (line) return { shape: "line", sizeFeet: Number(line[1]), widthFeet: line[2] ? Number(line[2]) : 5 };
  const cone = /(\d+)-foot\s+Cone/i.exec(description);
  if (cone) return { shape: "cone", sizeFeet: Number(cone[1]), widthFeet: null };
  const radial = /(\d+)-foot(?:-radius)?\s+(Sphere|Emanation)/i.exec(description);
  if (radial)
    return {
      shape: radial[2].toLowerCase() === "emanation" ? "emanation" : "sphere",
      sizeFeet: Number(radial[1]),
      widthFeet: null
    };
  const cube = /(\d+)-foot\s+Cube/i.exec(description);
  if (cube) return { shape: "cube", sizeFeet: Number(cube[1]), widthFeet: null };
  return null;
}

/** The action with its prose facts filled: the area (an authored one wins), and whether it is a Multiattack whose
 *  attacks nothing structured names. The same object when nothing changes. */
export function withProseFacts<Action extends ActorAction>(action: Action): Action {
  const area = action.area ?? areaOfProse(action.description);
  const untracked = /multiattack/i.test(action.name) && !action.multiattack;
  if (area === (action.area ?? null) && untracked === (action.untrackedMultiattack === true)) return action;
  const { untrackedMultiattack: _previous, ...rest } = action;
  return {
    ...rest,
    ...(area ? { area } : {}),
    ...(untracked ? { untrackedMultiattack: true as const } : {})
  } as Action;
}
