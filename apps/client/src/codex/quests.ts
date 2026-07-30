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
  active: "Active",
  completed: "Completed",
  failed: "Failed"
};

/** Decorative only; `QUEST_STATUS_LABEL` is what carries the meaning (design-language R2). */
export function questStatusTone(status: CodexQuestStatus): BadgeTone {
  return status === "completed" ? "success" : status === "failed" ? "danger" : "info";
}

/** The minimum needed to say whether a quest is still open. Satisfied by BOTH projections. */
export type QuestStatusRef = Readonly<{ status: CodexQuestStatus }>;

/**
 * "Open" is `active`, and nothing else — the same predicate the store's `codex_quests_status` index
 * exists to serve. `completed` and `failed` are both *finished*: a failed quest is no longer something
 * the party can still do, so a dashboard headed "Open quests" must not keep offering it.
 *
 * Applied identically for both audiences, which is why it lives here rather than at each call site:
 * `status` is player-facing on a quest (unlike a session's), so there is no role-specific half of this
 * rule that the two callers could legitimately answer differently.
 */
export function openQuests<T extends QuestStatusRef>(quests: readonly T[]): readonly T[] {
  return quests.filter((quest) => quest.status === "active");
}

/** How far along a quest is. `total === 0` means "no objectives", which renders as no progress at all. */
export function questProgress(objectives: readonly Readonly<{ done: boolean }>[]): Readonly<{ done: number; total: number; label: string }> {
  const done = objectives.filter((objective) => objective.done).length;
  // Words, not "2/5": the readout has to survive being read aloud, and it is short enough at 375px.
  return { done, total: objectives.length, label: `${done} of ${objectives.length} done` };
}
