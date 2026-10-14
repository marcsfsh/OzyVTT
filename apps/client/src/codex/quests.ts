import type { BadgeTone } from "@vtt/ui";
import type { CodexQuestStatus } from "./api";

/** Shared quest reading rules, typed so both the GM row and the player projection satisfy them. */

/** Status reads as a word; the badge tone is only a scanning aid. */
export const QUEST_STATUS_LABEL: Readonly<Record<CodexQuestStatus, string>> = {
  "not-started": "Not started",
  active: "Active",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled"
};

/** Lifecycle order (not alphabetical), and the only order a status picker offers. */
export const QUEST_STATUS_ORDER: readonly CodexQuestStatus[] = ["not-started", "active", "completed", "failed", "canceled"];

/**
 * Decorative only; `QUEST_STATUS_LABEL` carries the meaning. Both quiet states are `neutral`: a canceled
 * quest was dropped, not lost, so it must not wear `danger`.
 */
export function questStatusTone(status: CodexQuestStatus): BadgeTone {
  return status === "completed" ? "success" : status === "failed" ? "danger" : status === "active" ? "info" : "neutral";
}

export type QuestStatusRef = Readonly<{ status: CodexQuestStatus }>;

/** Open means not finished: `not-started` or `active`. New quests start `not-started`, so a fresh lead shows on Home. */
export function openQuests<T extends QuestStatusRef>(quests: readonly T[]): readonly T[] {
  return quests.filter((quest) => quest.status === "not-started" || quest.status === "active");
}

export function questProgress(objectives: readonly Readonly<{ done: boolean }>[]): Readonly<{ done: number; total: number; label: string }> {
  const done = objectives.filter((objective) => objective.done).length;
  // Words, not "2/5", so it reads aloud.
  return { done, total: objectives.length, label: `${done} of ${objectives.length} done` };
}
