import { useState } from "react";
import { formatWorldDate, type CodexChronicleRecord, type GmCodexCalendar } from "@vtt/domain";
import { useConfirm } from "../../components/feedback";
import { codexApi, journalApi } from "../api";
import { revealAheadOfPlayers } from "../chronicle";

/** Per device: whether to warn before revealing a record dated ahead of the players. Absent means on. */
const REVEAL_WARN_KEY = "codex.warn-reveal-ahead";
const readWarn = (): boolean => {
  try {
    return localStorage.getItem(REVEAL_WARN_KEY) !== "off";
  } catch {
    return true;
  }
};
const writeWarn = (on: boolean) => {
  try {
    localStorage.setItem(REVEAL_WARN_KEY, on ? "on" : "off");
  } catch {
    /* private mode: the choice lasts until the page closes */
  }
};

/**
 * What the GM does to a chronicle record from anywhere in Story: show or hide it, delete it, and confirm a
 * downtime's move of the date. Showing a record dated past the players' date warns first, since it tells players
 * the date moved; the warning has its own off switch and a way back on.
 */
export function useChronicleActions(
  gmToken: string,
  calendar: GmCodexCalendar | null,
  reload: () => void | Promise<void>,
  onError: (message: string) => void
) {
  const { confirm, dialog } = useConfirm();
  const [warn, setWarn] = useState(readWarn);

  const reveal = async (record: CodexChronicleRecord, revealed: boolean) => {
    if (revealed && warn && revealAheadOfPlayers(record, calendar)) {
      const dated =
        record.inWorldLabel ??
        (record.inWorldDate && calendar ? formatWorldDate(calendar, record.inWorldDate) : "a later date");
      const seen = calendar?.publishedDate ? formatWorldDate(calendar, calendar.publishedDate) : "no date yet";
      const proceed = await confirm({
        title: "This is dated ahead of the players",
        body: `Players' date is still ${seen}. Showing this record tells them the date has reached ${dated}. Publish the date first if you don't want that.`,
        confirmLabel: "Show anyway",
        suppress: {
          label: "Stop warning me about this",
          onChange: (suppressed) => {
            if (suppressed) {
              setWarn(false);
              writeWarn(false);
            }
          }
        }
      });
      if (!proceed) return;
    }
    try {
      if (record.kind === "event") await codexApi.revealPage(gmToken, record.id, revealed);
      else await journalApi.reveal(gmToken, record.id, revealed);
      await reload();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Couldn't change who sees that record.");
    }
  };

  const remove = async (record: CodexChronicleRecord) => {
    if (
      !(await confirm({
        title: "Delete record",
        body: "Delete this record from the chronicle? This cannot be undone.",
        confirmLabel: "Delete",
        danger: true
      }))
    )
      return false;
    try {
      await journalApi.remove(gmToken, record.id);
      await reload();
      return true;
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Couldn't delete that record.");
      return false;
    }
  };

  /** Moves the GM's date by a downtime's days; the whole chronicle is read again, since every row's dating moves. */
  const applyDowntime = async (record: CodexChronicleRecord) => {
    try {
      await journalApi.applyDowntime(gmToken, record.id);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Couldn't move your date.");
    }
    await reload();
  };

  const warnAgain = () => {
    setWarn(true);
    writeWarn(true);
  };

  return { reveal, remove, applyDowntime, warn, warnAgain, dialog };
}
