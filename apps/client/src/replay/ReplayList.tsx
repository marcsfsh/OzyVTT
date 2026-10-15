import { useState } from "react";
import { Button, IconChevronLeft, Menu, MenuItem, RevealSwitch, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { apiRequest } from "../lib/api";
import { dateOnly, durationOf, exportDocument, failure, readArchive, useReplays, type ArchiveSummary } from "./replays";
import "./replay.css";

export function ReplayList({
  role,
  token,
  onOpen,
  onBack
}: Readonly<{
  role: "gm" | "player";
  token: string;
  onOpen: (archiveId: number) => void;
  /** A player reaches this list at its own address, so its way back to the table is a frame row. */
  onBack?: () => void;
}>) {
  const { archives, error, refresh } = useReplays(token);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  const setShared = async (archive: ArchiveSummary, shared: boolean) => {
    setBusy(archive.id);
    try {
      await apiRequest(`/api/v1/encounters/${archive.id}/visibility`, {
        token,
        body: { playerVisible: shared },
        failure
      });
      refresh();
    } catch (cause) {
      toast((cause as Error).message, { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const download = async (archive: ArchiveSummary) => {
    setBusy(archive.id);
    try {
      exportDocument(archive.id, archive.endedAt, await readArchive(archive.id, token));
    } catch (cause) {
      toast((cause as Error).message, { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  /** Permanent and confirmed, and the confirm says so. */
  const remove = async (archive: ArchiveSummary) => {
    const ok = await confirm({
      title: "Delete this replay?",
      body: `The replay of the fight that ended ${dateOnly(archive.endedAt)} is gone — every turn, every roll, every line. This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;
    setBusy(archive.id);
    try {
      await apiRequest(`/api/v1/encounters/${archive.id}`, { token, method: "DELETE", failure });
      toast("Replay deleted.", { tone: "success" });
      refresh();
    } catch (cause) {
      toast((cause as Error).message, { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  /* Heading (and the player's way back) stay fixed; the rows are the one scroll region. Rows are
     plain `<li>`s with rules drawn in `replay.css`, not cards. */
  return (
    <section className="replay-panel replay-list-page pane-frame pane-scene scanlines frame-col anim-view">
      <div className="pane-sky" aria-hidden="true" />
      <header className="replay-list-head neon-beam">
        {onBack && (
          <Button variant="ghost" className="replay-list-back" onClick={onBack}>
            <IconChevronLeft /> Back to the table
          </Button>
        )}
        <h2>Replays</h2>
        {/* Player only: why their list may be short. */}
        {role === "player" && <p>The fights your GM has shared with the party.</p>}
        {error && <p className="replay-error">{error}</p>}
      </header>
      <div className="replay-list-body scroll-y frame-fill">
        {archives === null && <p>Loading replays…</p>}
        {/* No door: the list fills itself when a fight ends. */}
        {archives !== null && archives.length === 0 && !error && (
          <div className="scene-empty">
            <p>
              {role === "gm"
                ? "No replays yet. Every fight that ends is kept here."
                : "Your GM hasn’t shared a fight yet."}
            </p>
          </div>
        )}
        {archives !== null && archives.length > 0 && (
          <ul className="replay-rows">
            {archives.map((archive) => {
              const duration = durationOf(archive.startedAt, archive.endedAt);
              return (
                <li key={archive.id} className="replay-row">
                  <div className="replay-row-text">
                    <span className="replay-row-title">{dateOnly(archive.endedAt)}</span>
                    <span className="replay-row-meta tabular">
                      {archive.turnCount} turns{duration ? ` · ${duration}` : ""}
                    </span>
                  </div>
                  {role === "gm" && (
                    <RevealSwitch
                      revealed={archive.playerVisible}
                      ariaLabel="Show this replay to players"
                      disabled={busy === archive.id}
                      onChange={(shared) => void setShared(archive, shared)}
                    />
                  )}
                  <div className="replay-row-actions">
                    <Button variant="secondary" size="sm" onClick={() => onOpen(archive.id)}>
                      Watch
                    </Button>
                    {role === "gm" && (
                      <Menu trigger="More" label="More actions for this replay" align="end">
                        <MenuItem onClick={() => void download(archive)}>Download JSON</MenuItem>
                        <MenuItem tone="danger" onClick={() => void remove(archive)}>
                          Delete replay
                        </MenuItem>
                      </Menu>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {dialog}
    </section>
  );
}
