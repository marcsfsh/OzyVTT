/**
 * A stat block action whose uses come in a printed order, each with its own effect (a sphinx of valor's Roar: "Whenever
 * it roars, the roar has a different effect, as detailed below (the sequence resets when it takes a Long Rest)"):
 * each step is a choice printed inside the action (`partOf`), taken as its pool's use of that number (`useNumber`),
 * and the Multiattack that uses the action may take any of them in its place.
 */
import type { ActorAction } from "@vtt/schemas";

type Step = Readonly<{
  id: string;
  name: string;
  save: NonNullable<ActorAction["save"]>;
  damage: ActorAction["damage"];
}>;

const ROARS: readonly Step[] = [
  {
    // "Failure: The target has the Frightened condition for 1 minute."
    id: "first-roar",
    name: "First Roar",
    save: {
      ability: "wis",
      dc: 20,
      successDamage: "none",
      failureConditions: ["frightened"],
      failureDuration: { type: "rounds", rounds: 10 }
    },
    damage: []
  },
  {
    // "Failure: The target has the Paralyzed condition, and it repeats the save at the end of each of its turns,
    // ending the effect on itself on a success. After 1 minute, it succeeds automatically."
    id: "second-roar",
    name: "Second Roar",
    save: {
      ability: "wis",
      dc: 20,
      successDamage: "none",
      failureConditions: ["paralyzed"],
      repeatSave: true,
      failureDuration: { type: "rounds", rounds: 10 }
    },
    damage: []
  },
  {
    // "Failure: 44 (8d10) Thunder damage, and the target has the Prone condition. Success: Half damage only."
    id: "third-roar",
    name: "Third Roar",
    save: { ability: "con", dc: 20, successDamage: "half", failureConditions: ["prone"] },
    damage: [{ formula: "8d10", type: "thunder" }]
  }
];

const SEQUENCES: Readonly<Record<string, Readonly<{ actionId: string; steps: readonly Step[] }>>> = {
  "sphinx-of-valor": { actionId: "roar", steps: ROARS }
};

/** The stat block's actions with each sequence's steps printed inside it, and its Multiattack taking any of them. */
export function withSequences(slug: string, actions: readonly ActorAction[]): ActorAction[] {
  const sequence = SEQUENCES[slug];
  const parent = sequence ? actions.find((action) => action.id === sequence.actionId) : undefined;
  if (!sequence || !parent?.uses) return [...actions];
  const steps = sequence.steps.map((step, index): ActorAction => ({
    id: `${parent.id}-${step.id}`,
    name: `${parent.name.replace(/\s*\(.*\)$/, "")}: ${step.name}`,
    activation: parent.activation,
    description: parent.description,
    save: structuredClone(step.save),
    damage: structuredClone(step.damage),
    // "Each enemy in a 500-foot Emanation originating from the sphinx", and "The sphinx emits a magical roar".
    ...(parent.area ? { area: { ...parent.area } } : {}),
    targets: { who: "enemies" },
    magical: true,
    uses: { ...parent.uses!, pool: parent.id },
    useNumber: index + 1,
    partOf: parent.id
  }));
  const ids = steps.map((step) => step.id);
  return actions.flatMap((action) => {
    if (action === parent) {
      const { save: _save, reminder: _reminder, ...entry } = action;
      return [{ ...entry, damage: [] }, ...steps];
    }
    if (!action.multiattack?.some((component) => component.actionId === parent.id)) return [action];
    return [
      {
        ...action,
        multiattack: action.multiattack.map((component) =>
          component.actionId === parent.id ? { ...component, or: [...(component.or ?? []), ...ids] } : component
        )
      }
    ];
  });
}

/** Every stat block a sequence names, for the build's check that each still has its action. */
export const SEQUENCE_SLUGS: readonly string[] = Object.keys(SEQUENCES);
