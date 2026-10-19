/**
 * What a stat block's Shape-Shift does as data (`ActorAction.shapeShift`), read once from the SRD 5.2.1 printings when
 * the bundle is built: the forms each one prints, with the size and speeds that change and what a form can't do, the
 * actions printed for some forms only ("Bite (Wolf or Hybrid Form Only)"), and a lycanthrope's curse.
 */
import type { ActorAction, OnHitRider, PrintedForm, ShapeShift } from "@vtt/schemas";

/** A printed form with nothing but a new size ("into a Large wolf-humanoid hybrid"). */
const sized = (id: string, name: string, size: NonNullable<PrintedForm["size"]>): PrintedForm => ({
  id,
  name,
  size,
  modifiers: []
});

/** A printed form that only moves differently ("a rat (Speed 20 ft.)"). */
const moving = (id: string, name: string, speeds: NonNullable<PrintedForm["speeds"]>): PrintedForm => ({
  id,
  name,
  speeds,
  modifiers: []
});

/** "Its game statistics, other than its size, are the same in each form. Any equipment it is wearing or carrying isn't
 *  transformed." */
const printedShift = (printed: PrintedForm[]): ShapeShift => ({ from: "printed", printed, keeps: [], gear: "worn" });

const ALL_DAMAGE = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder"
] as const;

/**
 * Each stat block's Shape-Shift, keyed by its slug (the action is `shape-shift` in each). Forms are the printed ones;
 * the true form is always offered beside them.
 * - doppelganger, night hag: "into a Medium or Small Humanoid".
 * - imp: "a rat (Speed 20 ft.), a raven (20 ft., Fly 60 ft.), or a spider (20 ft., Climb 20 ft.)".
 * - mimic: "a Medium or Small object".
 * - oni: "a Small or Medium Humanoid or a Large Giant".
 * - quasit: "a bat (Speed 10 ft., Fly 40 ft.), a centipede (40 ft., Climb 40 ft.), or a toad (40 ft., Swim 40 ft.)".
 * - succubus: "a Medium or Small Humanoid ... its Fly Speed is available only in its true form".
 * - vampire: "If the vampire isn't in sunlight or running water ... a Tiny bat (Speed 5 ft., Fly Speed 30 ft.) or a
 *   Medium cloud of mist (Speed 5 ft., Fly Speed 20 ft. [hover])". The bat can't speak; the mist can't take actions or
 *   speak, can enter an enemy's space and stop there, and "has Resistance to all damage, except the damage it takes
 *   from sunlight". Misty Escape: at 0 Hit Points it "uses Shape-Shift to become mist", and lives on in it for 2 hours.
 *   Running water stays the GM's.
 * - the lycanthropes: a hybrid and an animal form at the sizes printed.
 */
const SHAPE_SHIFTS: Readonly<Record<string, ShapeShift>> = {
  doppelganger: printedShift([
    sized("medium-humanoid", "Medium Humanoid", "medium"),
    sized("small-humanoid", "Small Humanoid", "small")
  ]),
  imp: printedShift([
    moving("rat", "Rat", { walk: 20 }),
    moving("raven", "Raven", { walk: 20, fly: 60 }),
    moving("spider", "Spider", { walk: 20, climb: 20 })
  ]),
  mimic: printedShift([
    sized("medium-object", "Medium object", "medium"),
    sized("small-object", "Small object", "small")
  ]),
  "night-hag": printedShift([
    sized("small-humanoid", "Small Humanoid", "small"),
    sized("medium-humanoid", "Medium Humanoid", "medium")
  ]),
  oni: printedShift([
    sized("small-humanoid", "Small Humanoid", "small"),
    sized("medium-humanoid", "Medium Humanoid", "medium"),
    sized("large-giant", "Large Giant", "large")
  ]),
  quasit: printedShift([
    moving("bat", "Bat", { walk: 10, fly: 40 }),
    moving("centipede", "Centipede", { walk: 40, climb: 40 }),
    moving("toad", "Toad", { walk: 40, swim: 40 })
  ]),
  succubus: printedShift([
    { ...sized("medium-humanoid", "Medium Humanoid", "medium"), speeds: { walk: 30 } },
    { ...sized("small-humanoid", "Small Humanoid", "small"), speeds: { walk: 30 } }
  ]),
  vampire: {
    ...printedShift([
      { id: "bat", name: "Bat", size: "tiny", speeds: { walk: 5, fly: 30 }, noSpeech: true, modifiers: [] },
      {
        id: "mist",
        name: "Mist",
        size: "medium",
        speeds: { walk: 5, fly: 20, hover: true },
        noActions: true,
        noSpeech: true,
        sharesSpaces: true,
        modifiers: [{ type: "damage-resistance", damageTypes: [...ALL_DAMAGE] }]
      }
    ]),
    notInSunlight: true,
    escapesAtZero: { form: "mist", hours: 2 }
  },
  werebear: printedShift([sized("hybrid", "Hybrid", "large"), sized("bear", "Bear", "large")]),
  wereboar: printedShift([sized("hybrid", "Hybrid", "medium"), sized("boar", "Boar", "small")]),
  wererat: printedShift([sized("hybrid", "Hybrid", "medium"), sized("rat", "Rat", "small")]),
  weretiger: printedShift([sized("hybrid", "Hybrid", "large"), sized("tiger", "Tiger", "large")]),
  werewolf: printedShift([sized("hybrid", "Hybrid", "large"), sized("wolf", "Wolf", "medium")])
};

/** The stat block's Shape-Shift as data, or null for an action that isn't one. */
export function shapeShiftOf(slug: string, actionId: string): Pick<ActorAction, "shapeShift"> | null {
  const shift = actionId === "shape-shift" ? SHAPE_SHIFTS[slug] : undefined;
  return shift ? { shapeShift: structuredClone(shift) } : null;
}

/** The words a printing uses for a creature's true form ("Humanoid or Hybrid Form Only", "Bat or Vampire Form Only"). */
const TRUE_FORM_WORDS = new Set(["humanoid", "vampire"]);

/**
 * The forms an action works in, from its printed limit ("Wolf or Hybrid Form Only", in the upstream `limited_to_form`
 * field or the name's parentheses), as printed form ids with `true` for the true form. Null for an action with none,
 * and for a limit that isn't a form ("Requires Soul Bag").
 */
export function formOnlyOf(slug: string, limit: string | null | undefined, name: string): string[] | null {
  if (!SHAPE_SHIFTS[slug]) return null;
  const printed = limit ?? name.match(/\(([^)]*Form Only)\)/)?.[1];
  const words = printed?.match(/^(.*) Form Only$/)?.[1];
  if (!words) return null;
  const ids = words
    .split(/\s+or\s+|,\s*/)
    .map((word) => word.trim().toLowerCase())
    .map((word) => (TRUE_FORM_WORDS.has(word) ? "true" : word));
  const known = new Set(["true", ...(SHAPE_SHIFTS[slug]!.printed ?? []).map((form) => form.id)]);
  return ids.every((id) => known.has(id)) ? [...new Set(ids)] : null;
}

/** The effect tag a lycanthrope's curse leaves, naming the stat block the cursed creature becomes. */
export const lycanthropyTag = (slug: string) => `lycanthropy-${slug}`;

/**
 * A lycanthrope's Bite: "If the target is a Humanoid, it is subjected to the following effect. Constitution Saving
 * Throw: DC 12. Failure: The target is cursed. If the cursed target drops to 0 Hit Points, it instead becomes a
 * Werewolf under the DM's control and has 10 Hit Points." The save opens on the hit, against Humanoids only; the curse
 * is an effect whose tag the engine reads at 0 Hit Points. The success's 24-hour immunity stays the GM's.
 */
export function lycanthropeCurseOf(slug: string, name: string, description: string): OnHitRider | null {
  const match = description.match(
    /If the target is a Humanoid, it is subjected to the following effect\. Constitution Saving Throw: DC (\d+)\. Failure: The target is cursed\./
  );
  if (!match) return null;
  return {
    conditions: [],
    name: `Lycanthropy (${name})`.slice(0, 60),
    tags: [lycanthropyTag(slug)],
    creatureTypes: ["humanoid"],
    save: { ability: "con", dc: Number.parseInt(match[1]!, 10) },
    reminder: `A creature that succeeds is immune to this ${name.toLowerCase()}'s curse for 24 hours.`
  };
}
