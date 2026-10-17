import { useState } from "react";
import { Button, Field, IconChevronLeft, Input, Menu, MenuItem, Modal, RevealSwitch, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { apiRequest } from "../lib/api";
import {
  exportDocument,
  failure,
  readArchive,
  replayMeta,
  replayTitle,
  useReplays,
  type ArchiveSummary
} from "./replays";
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
  const [renaming, setRenaming] = useState<ArchiveSummary | null>(null);

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
      body: `${replayTitle(archive)} is gone, with every turn, roll and line of it. This cannot be undone.`,
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
              return (
                <li key={archive.id} className="replay-row">
                  <div className="replay-row-text">
                    <span className="replay-row-title">{replayTitle(archive)}</span>
                    <span className="replay-row-meta tabular">{replayMeta(archive)}</span>
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
                        <MenuItem onClick={() => setRenaming(archive)}>Rename…</MenuItem>
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
      {renaming && (
        <RenameReplay
          archive={renaming}
          token={token}
          onClose={() => setRenaming(null)}
          onRenamed={() => {
            setRenaming(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}

/** The GM names a replay. An empty name gives it back its scene and date. */
function RenameReplay({
  archive,
  token,
  onClose,
  onRenamed
}: Readonly<{ archive: ArchiveSummary; token: string; onClose: () => void; onRenamed: () => void }>) {
  const [name, setName] = useState(archive.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    try {
      await apiRequest(`/api/v1/encounters/${archive.id}/name`, {
        token,
        body: { name: name.trim() === "" ? null : name.trim() },
        failure: "That name could not be saved."
      });
      onRenamed();
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Rename the replay"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            Save name
          </Button>
        </>
      }
    >
      <Field
        label="Name"
        htmlFor="replay-name"
        help={`Players see this name once you share the replay. Leave it empty to call it ${archive.sceneName ?? "Fight"} again.`}
        error={error ?? undefined}
      >
        <Input
          id="replay-name"
          value={name}
          maxLength={80}
          placeholder={archive.sceneName ?? "Fight"}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
        />
      </Field>
    </Modal>
  );
}
