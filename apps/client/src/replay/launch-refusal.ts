/**
 * WHY A LAUNCH WAS REFUSED, AND THEREFORE WHERE THE WAY OUT IS.
 *
 * `activateNewScene` can decline "Launch from here" for exactly two reasons, and both used to arrive
 * as a transient error toast on a screen that offered no way to satisfy either. "Remove a prepared
 * scene first" is the worse of the two: the Replays tab has no scene list, so the demand was
 * unreachable from where it was made and the action read as simply broken. (The leak that used to
 * FIRE that refusal after a handful of launches is fixed in `scenes.ts`; a GM with twenty
 * hand-prepared scenes can still meet it honestly, and then they need the door.)
 *
 * Classified from the server's own sentences rather than guessed at from client-side state - the
 * server owns the decision (CLAUDE.md rule 2) and this only reads its answer.
 *
 * ITS OWN MODULE, not a helper inside `ReplayPanel.tsx`, so `launch-refusal.mirror.test.ts` can
 * import it from the `node` project: that test imports the SERVER's `scenes.ts` (which reaches for
 * `node:sqlite`) and runs without a DOM, and pulling in the panel would drag `router.ts` and its
 * module-scope `window` along with it.
 */
export type LaunchRefusal = "scene-room" | "history-review" | "other";

export function launchRefusalOf(message: string | undefined): LaunchRefusal {
  if (!message) return "other";
  if (/remove a prepared scene/i.test(message)) return "scene-room";
  if (/reviewing the combat history/i.test(message)) return "history-review";
  return "other";
}
