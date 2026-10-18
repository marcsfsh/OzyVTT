import { useEffect, useState } from "react";
import { Badge, AudienceChip, HIDDEN } from "@vtt/ui";
import { storedGmToken } from "../lib/gm-token";
import { socket } from "../socket";
import { listAllHomebrew, type HomebrewRecordSummary } from "./api";
import "./marks.css";

/**
 * Homebrew where it meets the table. Every catalog row carries its `source`, so the Homebrew mark needs nothing more.
 * Who sees a record is never in a catalog row, so the GM's pickers and bestiary read it from the GM's own homebrew
 * list by id, and a player's screen never asks.
 */

export type HomebrewMark = Pick<HomebrewRecordSummary, "audience" | "characterIds" | "state">;

let cache: ReadonlyMap<string, HomebrewMark> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<(marks: ReadonlyMap<string, HomebrewMark>) => void>();

function load(force = false) {
  const token = storedGmToken();
  if (!token || (cache && !force)) return;
  loading ??= listAllHomebrew(token).then(
    (rows) => {
      loading = null;
      cache = new Map(
        rows
          .filter((row) => !row.deletedAt)
          .map((row) => [row.id, { audience: row.audience, characterIds: row.characterIds, state: row.state }])
      );
      for (const listener of listeners) listener(cache);
    },
    () => {
      loading = null;
    }
  );
}

/** The GM's homebrew by id, kept current by the content-free ping. Empty, and never fetched, when `enabled` is false. */
export function useHomebrewMarks(enabled: boolean): ReadonlyMap<string, HomebrewMark> {
  const [marks, setMarks] = useState<ReadonlyMap<string, HomebrewMark>>(() => (enabled && cache) || new Map());
  useEffect(() => {
    if (!enabled) return;
    if (cache) setMarks(cache);
    listeners.add(setMarks);
    load();
    const onChanged = () => load(true);
    socket.on("homebrew:changed", onChanged);
    return () => {
      listeners.delete(setMarks);
      socket.off("homebrew:changed", onChanged);
    };
  }, [enabled]);
  return enabled ? marks : EMPTY;
}

const EMPTY: ReadonlyMap<string, HomebrewMark> = new Map();

/** The mark a homebrew row carries wherever it is listed. */
export function HomebrewBadge() {
  return <Badge tone="primary">Homebrew</Badge>;
}

/** Homebrew, and for the GM a Hidden record marked as the Codex marks one. */
export function HomebrewMarks({
  source,
  mark
}: Readonly<{ source: string | undefined; mark?: HomebrewMark | undefined }>) {
  if (source !== "homebrew") return null;
  return (
    <span className="hb-marks">
      <HomebrewBadge />
      {mark?.audience === "hidden" && <AudienceChip value={HIDDEN} party={[]} />}
    </span>
  );
}
