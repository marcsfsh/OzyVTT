import { useRef, useState } from "react";
import { Alert, Button, Field, Modal, Panel, PanelHeader, SegmentedControl, useToast } from "@vtt/ui";
import type { CodexImportCounts } from "@vtt/domain";
import { codexApi, type CodexImportBundle } from "./api";
import { BODY_LAYER, type BodyLayer } from "./TwoLayerBodyTabs";
import { newId } from "../lib/ids";

/**
 * Backup: download, restore, and importing outside notes. Restore is destructive; the guardrails are the
 * server's single transaction (a bad bundle changes nothing), its refusal of a bundle with no known section,
 * and a confirm listing every section's count, zeros included. Server 400s name the bad row, so
 * `error.message` is shown verbatim.
 */
export function BackupView({ gmToken, onChanged }: Readonly<{ gmToken: string; onChanged: () => void }>) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<{
    bundle: CodexImportBundle;
    counts: Partial<CodexImportCounts>;
    name: string;
  } | null>(null);
  const [notesSide, setNotesSide] = useState<BodyLayer>("gm");
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const notesInputRef = useRef<HTMLInputElement>(null);

  const download = async () => {
    setError(null);
    try {
      const bundle = await codexApi.exportBundle(gmToken);
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `codex-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast("Backup downloaded.", { tone: "success" });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Couldn't download the backup.");
    }
  };

  /** Parses the file for the confirm's counts only; the bytes posted back are the file's own. */
  const pickRestore = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setIssues([]);
    try {
      const parsed = JSON.parse(await file.text()) as CodexImportBundle & { codex?: Record<string, unknown[]> };
      if (!parsed || typeof parsed !== "object" || !parsed.codex) throw new Error("That file isn't a Codex backup.");
      const codex = parsed.codex as Record<string, unknown>;
      const size = (key: string) => (Array.isArray(codex[key]) ? (codex[key] as unknown[]).length : undefined);
      setPending({
        // Sent verbatim: a missing `bundleVersion` is legal, and a wrong one is the server's 400 to give.
        bundle: {
          codex: parsed.codex,
          ...(parsed.exportedAt ? { exportedAt: parsed.exportedAt } : {}),
          ...(parsed.bundleVersion !== undefined ? { bundleVersion: parsed.bundleVersion } : {}),
          commandId: newId()
        },
        counts: {
          pages: size("pages"),
          maps: size("maps"),
          markers: size("markers"),
          journal: size("journal"),
          sessions: size("sessions"),
          quests: size("quests")
        },
        name: file.name
      });
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Couldn't read that file.");
    }
  };

  const restore = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const result = await codexApi.importBundle(gmToken, pending.bundle);
      setPending(null);
      // The server's own post-import counts.
      toast(
        `Codex restored: ${result.counts.pages} pages, ${result.counts.journal} journal entries, ${result.counts.maps} maps.`,
        { tone: "success" }
      );
      onChanged();
    } catch (importError) {
      const failure = importError as {
        message?: string;
        details?: { issues?: ReadonlyArray<{ path?: string; message?: string }> };
      };
      setError(failure.message ?? "The restore failed.");
      setIssues((failure.details?.issues ?? []).map((issue) => [issue.path, issue.message].filter(Boolean).join(": ")));
    } finally {
      setBusy(false);
    }
  };

  const importNotes = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    let imported = 0;
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const title = file.name.replace(/\.(md|markdown|txt)$/i, "").trim();
        await codexApi.createPage(gmToken, {
          title: title || "Imported page",
          // The GM picks the destination layer.
          ...(notesSide === "gm" ? { gmBody: text } : { playerBody: text }),
          commandId: newId()
        });
        imported += 1;
      } catch {
        failed.push(file.name);
      }
    }
    onChanged();
    if (failed.length) setError(`Brought in ${imported} of ${files.length}. Couldn't read: ${failed.join(", ")}.`);
    else toast(`Brought in ${imported} page${imported === 1 ? "" : "s"}.`, { tone: "success" });
  };

  /** Every section, always, including empty ones: a missing section is `0` because that's what the restore leaves. */
  const RESTORE_SECTIONS = [
    { key: "pages", one: "page", many: "pages" },
    { key: "maps", one: "map", many: "maps" },
    { key: "markers", one: "pin", many: "pins" },
    { key: "journal", one: "journal entry", many: "journal entries" },
    { key: "sessions", one: "session", many: "sessions" },
    { key: "quests", one: "quest", many: "quests" }
  ] as const satisfies ReadonlyArray<{ key: keyof CodexImportCounts; one: string; many: string }>;
  const countOf = (counts: Partial<CodexImportCounts>, key: keyof CodexImportCounts) => counts[key] ?? 0;
  const countLine = (counts: Partial<CodexImportCounts>) =>
    RESTORE_SECTIONS.map(({ key, one, many }) => {
      const value = countOf(counts, key);
      return `${value} ${value === 1 ? one : many}`;
    }).join(", ");

  return (
    <div className="codex-backup">
      {error && (
        <Alert tone="danger" title="Backup">
          {error}
          {issues.length > 0 && (
            <ul className="codex-backup-issues">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <Panel>
        <PanelHeader title="Download backup" />
        <p>
          One file with everything: pages, maps, pins, journal, sessions, quests, calendar, settings and version
          history.
        </p>
        <Button variant="primary" onClick={() => void download()}>
          Download backup
        </Button>
      </Panel>

      <Panel>
        <PanelHeader title="Restore backup" />
        <p className="codex-composer-hint">Download a backup first. Restoring replaces everything in the Codex.</p>
        <Button variant="secondary" onClick={() => restoreInputRef.current?.click()}>
          Choose a backup file
        </Button>
        <input
          ref={restoreInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            void pickRestore(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {/* `Modal` (focus trap, Escape, scrim), because `useConfirm`'s single-string body can't hold the inventory. */}
        <Modal
          open={!!pending}
          onClose={() => setPending(null)}
          size="sm"
          title="Restore this backup?"
          ariaLabel="Restore this backup?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={busy} onClick={() => void restore()}>
                Replace everything
              </Button>
            </>
          }
        >
          {pending && (
            <>
              <p>
                It replaces your entire Codex with the contents of <strong>{pending.name}</strong>. This cannot be
                undone.
              </p>
              {/* A list, so a zero stands out. */}
              <p className="codex-backup-inventory">That file contains {countLine(pending.counts)}.</p>
            </>
          )}
        </Modal>
      </Panel>

      <Panel>
        <PanelHeader title="Bring in notes" />
        <p>Turns Markdown or text files into pages, one page per file. This adds pages and replaces nothing.</p>
        {/* Can't use `TwoLayerBodyTabs`: it chooses an import destination (GM first, the default) inside a
            `Field`. It shares `BODY_LAYER`'s words instead. */}
        <Field label="Import into" htmlFor="codex-notes-side" help="New pages start hidden from players either way.">
          <SegmentedControl
            ariaLabel="Which layer to import into"
            value={notesSide}
            onChange={(value) => setNotesSide(value as BodyLayer)}
            options={[BODY_LAYER.gm, BODY_LAYER.player]}
          />
        </Field>
        <Button variant="secondary" onClick={() => notesInputRef.current?.click()}>
          Choose files
        </Button>
        <input
          ref={notesInputRef}
          type="file"
          accept=".md,.markdown,.txt"
          multiple
          hidden
          onChange={(event) => {
            void importNotes(event.target.files);
            event.target.value = "";
          }}
        />
      </Panel>
    </div>
  );
}
