import { ABILITY_IDS, scoresOf } from "./monster-build";
import { actionsOf, activationOf } from "./monster-actions";
import type { Draft } from "../schema";

const words = (list: readonly string[]) => (list.length === 0 ? null : list.join(", "));
const named = (items: unknown) =>
  Array.isArray(items)
    ? items
        .map((item) => (item && typeof item === "object" ? String((item as { name?: unknown }).name ?? "").trim() : ""))
        .filter(Boolean)
    : [];

/**
 * A step's current answer in one line, under its name in the studio's rail (compendium spec 2.4): "AC 17 · HP 27 ·
 * 30 ft.", the six scores, the actions' names. Null where the step has nothing to say yet.
 */
export function stepAnswer(type: string, stepId: string, draft: Draft): string | null {
  if (type !== "monster") return null;
  switch (stepId) {
    case "identity": {
      const parts = [draft.size, draft.type ?? draft.creatureType].filter(
        (part) => typeof part === "string" && part
      ) as string[];
      return parts.length ? parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") : null;
    }
    case "defences": {
      const ac = typeof draft.armorClass === "number" ? `AC ${draft.armorClass}` : null;
      const maximum = (draft.hitPoints as { maximum?: unknown } | undefined)?.maximum;
      const hp = typeof maximum === "number" ? `HP ${maximum}` : null;
      const speed = typeof draft.speedFeet === "number" ? `${draft.speedFeet} ft.` : null;
      const line = [ac, hp, speed].filter(Boolean).join(" · ");
      return line || null;
    }
    case "abilities": {
      const scores = scoresOf(draft);
      return ABILITY_IDS.map((id) => scores[id]).join(" ");
    }
    case "traits":
      return words(named(draft.traits));
    case "actions":
    case "bonus-actions":
    case "reactions":
    case "legendary": {
      const activation =
        stepId === "actions"
          ? "action"
          : stepId === "bonus-actions"
            ? "bonus-action"
            : stepId === "reactions"
              ? "reaction"
              : "legendary";
      return words(
        actionsOf(draft)
          .filter((action) => activationOf(action) === activation)
          .map((action) => String(action.name ?? "").trim())
          .filter(Boolean)
      );
    }
    default:
      return null;
  }
}
