/**
 * What a stat block's hit does that the engine doesn't run, reviewed against each printing and said to the GM with the
 * hit, so the action reads as applied in part and the table knows what to finish. Keyed `<creature>/<action>`. The
 * build's readers run the rest of each hit; `test/hit-rider-sentences.test.ts` holds every hit's sentences to a reader
 * or a note here.
 */
import type { ActorAction } from "@vtt/schemas";

const HURL_FLAME =
  "A flammable object the target hit that isn't worn or carried starts burning; objects are the GM's to burn.";

const HIT_NOTES: Readonly<Record<string, string>> = {
  "barbed-devil/hurl-flame": HURL_FLAME,
  "horned-devil/hurl-flame": HURL_FLAME
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
