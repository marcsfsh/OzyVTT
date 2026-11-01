import { useState } from "react";
import {
  Button,
  Field,
  IconChevronLeft,
  IconEye,
  IconEyeOff,
  IconMore,
  Input,
  Menu,
  MenuItem,
  Modal,
  RevealSwitch,
  useToast,
  EmptyState
} from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { apiRequest } from "../lib/api";
import { useMediaQuery } from "../lib/useMediaQuery";
import {
  durationOf,
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
  const phone = useMediaQuery("(max-width: 760px)");
  const [chosenId, setChosenId] = useState<number | null>(null);
  const chosen = archives?.find((archive) => archive.id === chosenId) ?? archives?.[0] ?? null;

  const setShared = async (archive: ArchiveSummary, shared: boolean) => {
    setBusy(archive.id);
    try {
      await apiRequest(`/api/v1/replays/${archive.id}/visibility`, {
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
      body: `Every turn, roll and line of ${replayTitle(archive)} goes, and this cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;
    setBusy(archive.id);
    try {
      await apiRequest(`/api/v1/replays/${archive.id}`, { token, method: "DELETE", failure });
      toast("Replay deleted.", { tone: "success" });
      refresh();
    } catch (cause) {
      toast((cause as Error).message, { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  /* Heading (and the player's way back) stay fixed; the rows are the one scroll region. Rows are
     plain `<li>`s with rules drawn in `replay.css`, and no cards. */
  return (
    <section className="replay-panel replay-list-page pane-frame pane-scene frame-col anim-view">
      {/* The GM's list sits under Prep's bar, which names it, so it has no title row (theme spec 2.2). A player's page
          is below the table, so it keeps Back and its own name (rule 12). */}
      {role === "player" ? (
        <header className="replay-list-head">
          {onBack && (
            <Button variant="ghost" className="replay-list-back" onClick={onBack}>
              <IconChevronLeft /> Back to the table
            </Button>
          )}
          <h2>Replays</h2>
          {/* Why their list may be short. */}
          <p>The encounters your GM has shared with the party.</p>
          {error && <p className="replay-error">{error}</p>}
        </header>
      ) : (
        error && <p className="replay-error">{error}</p>
      )}
      <div className="replay-list-body scroll-y frame-fill">
        {archives === null && <p>Loading replays…</p>}
        {/* No door: the list fills itself when a fight ends. */}
        {archives !== null && archives.length === 0 && !error && (
          <EmptyState>
            {role === "gm"
              ? "No replays yet. Every encounter that ends is kept here."
              : "Your GM hasn't shared an encounter yet."}
          </EmptyState>
        )}
        {archives !== null && archives.length > 0 && (
          <div className="replay-split">
            {/* The list as a table (E3 replays spec 2.1), newest first; the chosen row is lit and its replay sits
                beside it on a laptop. A phone's row opens the replay's page. */}
            <table className="replay-table">
              <thead>
                <tr>
                  <th scope="col">Replay</th>
                  <th scope="col">Fought</th>
                  <th scope="col">Turns</th>
                  <th scope="col">Length</th>
                  {role === "gm" && (
                    <th scope="col">
                      <span className="nh-sr-only">Players see it</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {archives.map((archive) => (
                  <tr key={archive.id} className={chosen?.id === archive.id ? "is-on" : undefined}>
                    <td>
                      <button
                        type="button"
                        className="replay-table-open interactive"
                        aria-pressed={chosen?.id === archive.id}
                        onClick={() => (phone ? onOpen(archive.id) : setChosenId(archive.id))}
                      >
                        <b>{replayTitle(archive)}</b>
                        {archive.name && archive.encounterName && <small>{archive.encounterName}</small>}
                      </button>
                    </td>
                    <td className="tabular">{new Date(archive.endedAt).toLocaleDateString()}</td>
                    <td className="tabular">{archive.turnCount}</td>
                    <td className="tabular">{durationOf(archive.startedAt, archive.endedAt) ?? "Unknown"}</td>
                    {role === "gm" && (
                      <td>
                        {archive.playerVisible ? (
                          <>
                            <IconEye />
                            <span className="nh-sr-only">Players see it</span>
                          </>
                        ) : (
                          <>
                            <IconEyeOff />
                            <span className="nh-sr-only">Hidden from players</span>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!phone && chosen && (
              <aside className="replay-beside" aria-label={replayTitle(chosen)}>
                <div className="replay-beside-head">
                  <h3>{replayTitle(chosen)}</h3>
                  {role === "gm" && (
                    <Menu trigger={<IconMore />} icon label="More actions for this replay" align="end">
                      <MenuItem onClick={() => setRenaming(chosen)}>Rename…</MenuItem>
                      <MenuItem onClick={() => void download(chosen)}>Download JSON</MenuItem>
                      <MenuItem tone="danger" onClick={() => void remove(chosen)}>
                        Delete replay
                      </MenuItem>
                    </Menu>
                  )}
                </div>
                <p className="replay-beside-line tabular">{replayMeta(chosen)}</p>
                {role === "gm" && (
                  <span className="replay-beside-reveal">
                    <RevealSwitch
                      revealed={chosen.playerVisible}
                      ariaLabel="Show this replay to players"
                      disabled={busy === chosen.id}
                      onChange={(shared) => void setShared(chosen, shared)}
                    />
                    <span aria-hidden="true">{chosen.playerVisible ? "Players see it" : "Hidden from players"}</span>
                  </span>
                )}
                <Button variant="primary" onClick={() => onOpen(chosen.id)}>
                  Watch
                </Button>
              </aside>
            )}
          </div>
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
      await apiRequest(`/api/v1/replays/${archive.id}/name`, {
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
        help={`Players see this name once you share the replay. Leave it empty to call it ${archive.encounterName ?? "Encounter"} again.`}
        error={error ?? undefined}
      >
        <Input
          id="replay-name"
          value={name}
          maxLength={80}
          placeholder={archive.encounterName ?? "Encounter"}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
        />
      </Field>
    </Modal>
  );
}
