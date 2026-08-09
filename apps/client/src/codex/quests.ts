import type { BadgeTone } from "@vtt/ui";
import type { CodexQuestStatus } from "./api";

/**
 * M10's shared quest reading rules — what a quest's STATUS is called, and what "open" means.
 *
 * Pure functions, no JSX, for exactly the reason `sessions.ts` is: three surfaces read a quest (the
 * Campaign dashboard card, the GM's quest destination, and the player's copy of the dashboard) and they
 * are deliberately separate implementations. What must not drift is the *meaning* — which quests count
 * as still open, and how far along one is.
 *
 * Everything here is structurally typed on the narrowest shape that answers the question, so the GM
 * record (`CodexQuest`) and the PLAYER projection (`PlayerCodexQuest`) both satisfy it. That is not a
 * convenience: a helper that demanded `gmBody` would be one the player's dashboard could not use, and
 * the fix for that is always to widen the projection, never to fork the rule.
 */

/** The status vocabulary, one place. R2: status reads as a WORD — the badge tone below is a scanning aid only. */
export const QUEST_STATUS_LABEL: Readonly<Record<CodexQuestStatus, string>> = {
  "not-started": "Not started",
  active: "Active",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled"
};

/**
 * LIFECYCLE order, and the only order a status picker offers: not started → active → the three ways of
 * being finished. Every `<option>` list is built from this array rather than hand-written, because two
 * hand-written lists is exactly how one surface ends up offering four statuses and another five.
 *
 * Not alphabetical, deliberately. A GM reads this list to move a quest ALONG, and "Active, Canceled,
 * Completed, Failed, Not started" scatters the two open states to opposite ends of it.
 */
export const QUEST_STATUS_ORDER: readonly CodexQuestStatus[] = ["not-started", "active", "completed", "failed", "canceled"];

/**
 * Decorative only; `QUEST_STATUS_LABEL` is what carries the meaning (design-language R2).
 *
 * Five states, four tones, and the pairings say what the badge is for at a glance: `success` for done,
 * `danger` for lost, `info` for the live one — and `neutral` for BOTH quiet states. A quest nobody has
 * begun and a quest nobody will finish are the two that want no attention: `not-started` has not earned
 * the live badge yet, and `canceled` must not wear `danger`, because a quest the party chose to drop is
 * not a failure and colouring it like one would be the tone silently disagreeing with the word beside it.
 */
export function questStatusTone(status: CodexQuestStatus): BadgeTone {
  return status === "completed" ? "success" : status === "failed" ? "danger" : status === "active" ? "info" : "neutral";
}

/** The minimum needed to say whether a quest is still open. Satisfied by BOTH projections. */
export type QuestStatusRef = Readonly<{ status: CodexQuestStatus }>;

/**
 * **"Open" is NOT FINISHED — `not-started` or `active`.** It used to be `active` and nothing else, and
 * that reading was retired when those two statuses arrived (5d).
 *
 * The question a card headed "Open quests" answers is "what is still on the party's plate", and the
 * three terminal states are the ones that leave it: `completed` and `failed` are both settled, and
 * `canceled` is a quest the GM took off the table on purpose — a dashboard that kept offering any of
 * them would be listing work nobody is going to do. A quest nobody has *started* is the opposite: it is
 * the newest thing on the plate, and it is the state every quest is now created in, so excluding it
 * would mean a GM writes down a lead and watches it never appear on Home. That single consequence is
 * what decided this: the phrase is "open", not "in progress", and a lead is open.
 *
 * Applied identically for both audiences, which is why it lives here rather than at each call site:
 * `status` is player-facing on a quest (unlike a session's), so there is no role-specific half of this
 * rule that the two callers could legitimately answer differently.
 *
 * Existing campaigns see no change from the widening: migration v26 rewrites no stored status, so no
 * quest that was closed yesterday can be open today.
 */
export function openQuests<T extends QuestStatusRef>(quests: readonly T[]): readonly T[] {
  return quests.filter((quest) => quest.status === "not-started" || quest.status === "active");
}

/** How far along a quest is. `total === 0` means "no objectives", which renders as no progress at all. */
export function questProgress(objectives: readonly Readonly<{ done: boolean }>[]): Readonly<{ done: number; total: number; label: string }> {
  const done = objectives.filter((objective) => objective.done).length;
  // Words, not "2/5": the readout has to survive being read aloud, and it is short enough at 375px.
  return { done, total: objectives.length, label: `${done} of ${objectives.length} done` };
}
