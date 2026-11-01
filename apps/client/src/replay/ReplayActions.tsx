import { useState, type ReactNode } from "react";
import { Button, Field, IconCheck, IconMore, Input, Menu, MenuItem, Modal, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { apiRequest } from "../lib/api";
import { exportDocument, failure, readArchive, replayTitle, type ArchiveSummary } from "./replays";

/**
 * The GM's actions on one replay, shared by the list's beside panel and the viewer's head row: who sees it, its name,
 * its download and its deletion, each through today's routes. `dialogs` carries the confirm and the rename dialog, so
 * the caller renders it once.
 */
export function useReplayActions(
  token: string,
  refresh: () => void,
  onDeleted?: () => void
): Readonly<{
  busy: number | null;
  setShared: (archive: ArchiveSummary, shared: boolean) => Promise<void>;
  more: (archive: ArchiveSummary, options?: Readonly<{ share?: boolean }>) => ReactNode;
  dialogs: ReactNode;
}> {
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<ArchiveSummary | null>(null);

  const run = async (archive: ArchiveSummary, work: () => Promise<void>) => {
    setBusy(archive.id);
    try {
      await work();
    } catch (cause) {
      toast((cause as Error).message, { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const setShared = (archive: ArchiveSummary, shared: boolean) =>
    run(archive, async () => {
      await apiRequest(`/api/v1/replays/${archive.id}/visibility`, {
        token,
        body: { playerVisible: shared },
        failure
      });
      refresh();
    });

  const download = (archive: ArchiveSummary) =>
    run(archive, async () => exportDocument(archive.id, archive.endedAt, await readArchive(archive.id, token)));

  /** Permanent and confirmed, and the confirm says so. */
  const remove = async (archive: ArchiveSummary) => {
    const ok = await confirm({
      title: "Delete this replay?",
      body: `Every turn, roll and line of ${replayTitle(archive)} goes, and this cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;
    await run(archive, async () => {
      await apiRequest(`/api/v1/replays/${archive.id}`, { token, method: "DELETE", failure });
      toast("Replay deleted.", { tone: "success" });
      refresh();
      onDeleted?.();
    });
  };

  // The list keeps Players see it as its own switch beside the menu; the viewer's head row carries it in the menu.
  const more = (archive: ArchiveSummary, options: Readonly<{ share?: boolean }> = {}) => (
    <Menu trigger={<IconMore />} icon label="More actions for this replay" align="end">
      {options.share && (
        <MenuItem
          role="menuitemcheckbox"
          aria-checked={archive.playerVisible}
          disabled={busy === archive.id}
          icon={archive.playerVisible ? <IconCheck /> : <span className="replay-menu-unchecked" />}
          onClick={() => void setShared(archive, !archive.playerVisible)}
        >
          Players see it
        </MenuItem>
      )}
      <MenuItem onClick={() => setRenaming(archive)}>Rename…</MenuItem>
      <MenuItem onClick={() => void download(archive)}>Download JSON</MenuItem>
      <MenuItem tone="danger" onClick={() => void remove(archive)}>
        Delete replay
      </MenuItem>
    </Menu>
  );

  const dialogs = (
    <>
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
    </>
  );

  return { busy, setShared, more, dialogs };
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
