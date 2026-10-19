/**
 * What a stat block's hit does that the engine doesn't run, reviewed against each printing and said to the GM with the
 * hit, so the action reads as applied in part and the table knows what to finish. Keyed `<creature>/<action>`. The
 * build's readers run the rest of each hit; `test/hit-rider-sentences.test.ts` holds every hit's sentences to a reader
 * or a note here.
 */
import type { ActorAction } from "@vtt/schemas";

const ARMOR_PENALTY =
  "Nonmagical armor the target wears takes a cumulative -1 penalty to the AC it offers, and is destroyed when the penalty reduces its AC to 10. Mending removes the penalty. Change the armor by hand.";
const HURL_FLAME =
  "A flammable object the target hit that isn't worn or carried starts burning; objects are the GM's to burn.";
const STABLE_POISON =
  "A target this damage drops to 0 Hit Points becomes Stable instead, and has the Poisoned condition for 1 hour, with the Paralyzed condition while Poisoned. Apply both by hand.";

const HIT_NOTES: Readonly<Record<string, string>> = {
  "allosaurus/claws":
    "After a charge that knocks the target Prone, the allosaurus can make one Bite attack against it; take it from the turn list.",
  "animated-rug-of-smothering/smother":
    "The rug smothers one creature at a time. While it grapples the target, the target is suffocating, and the rug halves the damage it takes (round down) while the target takes the same amount.",
  "barbed-devil/hurl-flame": HURL_FLAME,
  "black-pudding/dissolving-pseudopod": ARMOR_PENALTY,
  "darkmantle/crush":
    "While attached, the darkmantle moves with the target at Speed 0 and can attack only it, with Advantage. It detaches itself with 5 feet of its movement.",
  "stirge/proboscis":
    "While attached, the stirge can't make Proboscis attacks. It detaches with 5 feet of its movement, and the target or a creature within 5 feet can detach it with an action.",
  "cloaker/attach":
    "While attached, the cloaker can't make Attach attacks against other targets, and it halves the damage it takes (round down) while the target takes the same amount. It detaches with 5 feet of its movement, and the target or a creature within 5 feet can detach it with an action and a DC 14 Strength (Athletics) check.",
  "gray-ooze/pseudopod": ARMOR_PENALTY,
  "horned-devil/hurl-flame": HURL_FLAME,
  "phase-spider/bite": STABLE_POISON,
  "vampire-familiar/umbral-dagger": STABLE_POISON
};

/** The stat block's actions with what each hit leaves to the GM said beside its reminder. */
export function withHitNotes(slug: string, actions: readonly ActorAction[], used: Set<string>): ActorAction[] {
  return actions.map((action) => {
    const key = `${slug}/${action.id}`;
    const note = HIT_NOTES[key];
    if (!note) return action;
    used.add(key);
    return { ...action, reminder: (action.reminder ? `${action.reminder} ${note}` : note).slice(0, 600) };
  });
}

/** Every key the table names, for the build's check that each still names an action. */
export const HIT_NOTE_KEYS: readonly string[] = Object.keys(HIT_NOTES);
