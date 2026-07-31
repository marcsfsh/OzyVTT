import { useRef, useState } from "react";
import { Alert, Button, Field, Panel, PanelHeader, SegmentedControl, useToast } from "@vtt/ui";
import { codexApi, type CodexImportBundle, type CodexImportCounts } from "./api";
import { newId } from "../lib/ids";

/**
 * D16 — Backup: the download, the restore, and the "bring in notes" import, told apart.
 *
 * These were two ghost buttons in the old ops row labelled "Import" and "Export", and they did not mean
 * what a GM would guess: Export downloaded a full bundle that nothing could read back, and Import turned
 * markdown files into pages. Now the round trip is real, and the two are separate panels with separate
 * words — a full backup you can restore, and a way to bring outside notes in.
 *
 * **Restore is destructive by design.** The guardrails are the server's transactionality (a bad bundle
 * is a 400 with the codex completely untouched, so a retry is safe) and a real-count confirm here.
 */
export function BackupView({ gmToken, onChanged }: Readonly<{ gmToken: string; onChanged: () => void }>) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<{ bundle: CodexImportBundle; counts: Partial<CodexImportCounts>; name: string } | null>(null);
  const [notesSide, setNotesSide] = useState<"gm" | "player">("gm");
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const notesInputRef = useRef<HTMLInputElement>(null);

  const download = async () => {
    setError(null);
    try {
      const bundle = await codexApi.exportBundle(gmToken);
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `codex-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      URL.revokeObjectURL(url);
      toast("Backup downloaded.", { tone: "success" });
    } catch (exportError) { setError(exportError instanceof Error ? exportError.message : "Couldn't download the backup."); }
  };

  /** Parse the file for the confirm's counts only. The bytes POSTed back are the file's own, unedited. */
  const pickRestore = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setIssues([]);
    try {
      const parsed = JSON.parse(await file.text()) as CodexImportBundle & { codex?: Record<string, unknown[]> };
      if (!parsed || typeof parsed !== "object" || !parsed.codex) throw new Error("That file isn't a Codex backup.");
      const codex = parsed.codex as Record<string, unknown>;
      const size = (key: string) => (Array.isArray(codex[key]) ? (codex[key] as unknown[]).length : undefined);
      setPending({
        // Sent VERBATIM: `bundleVersion` is passed through as found — absent is legal (a backup taken
        // before the feature existed restores) and a wrong version is the server's 400 to give, not ours.
        bundle: { codex: parsed.codex, ...(parsed.exportedAt ? { exportedAt: parsed.exportedAt } : {}), ...(parsed.bundleVersion !== undefined ? { bundleVersion: parsed.bundleVersion } : {}), commandId: newId() },
        counts: { pages: size("pages"), maps: size("maps"), markers: size("markers"), journal: size("journal"), sessions: size("sessions"), quests: size("quests") },
        name: file.name
      });
    } catch (parseError) { setError(parseError instanceof Error ? parseError.message : "Couldn't read that file."); }
  };

  const restore = async () => {
    if (!pending || busy) return;
    setBusy(true); setError(null); setIssues([]);
    try {
      const result = await codexApi.importBundle(gmToken, pending.bundle);
      setPending(null);
      // The toast echoes the SERVER's counts — the database's own post-import rows — not our parse.
      toast(`Codex restored — ${result.counts.pages} pages, ${result.counts.journal} journal entries, ${result.counts.maps} maps.`, { tone: "success" });
      onChanged();
    } catch (importError) {
      const failure = importError as { message?: string; details?: { issues?: ReadonlyArray<{ path?: string; message?: string }> } };
      setError(failure.message ?? "The restore failed.");
      setIssues((failure.details?.issues ?? []).map((issue) => [issue.path, issue.message].filter(Boolean).join(": ")));
    } finally { setBusy(false); }
  };

  const importNotes = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    let imported = 0; const failed: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const title = file.name.replace(/\.(md|markdown|txt)$/i, "").trim();
        await codexApi.createPage(gmToken, {
          title: title || "Imported page",
          // G23: the destination is a CHOICE now. It used to land silently on the player-facing side,
          // which is the one place in the Codex where "secret by default" quietly did not hold.
          ...(notesSide === "gm" ? { gmBody: text } : { playerBody: text }),
          commandId: newId()
        });
        imported += 1;
      } catch { failed.push(file.name); }
    }
    onChanged();
    if (failed.length) setError(`Brought in ${imported} of ${files.length}. Couldn't read: ${failed.join(", ")}.`);
    else toast(`Brought in ${imported} page${imported === 1 ? "" : "s"}.`, { tone: "success" });
  };

  const countLine = (counts: Partial<CodexImportCounts>) =>
    ([["pages", "page"], ["maps", "map"], ["markers", "pin"], ["journal", "journal entry"], ["sessions", "session"], ["quests", "quest"]] as const)
      .map(([key, noun]) => (counts[key] === undefined ? null : `${counts[key]} ${noun}${counts[key] === 1 ? "" : noun === "journal entry" ? "s" : "s"}`))
      .filter(Boolean).join(", ");

  return (
    <div className="codex-backup">
      {error && <Alert tone="danger" title="Backup">{error}{issues.length > 0 && <ul className="codex-backup-issues">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</Alert>}

      <Panel>
        <PanelHeader title="Download backup" />
        <p>One file with everything: pages, maps, pins, journal, sessions, quests, calendar, settings and version history.</p>
        <Button variant="primary" onClick={() => void download()}>Download backup</Button>
      </Panel>

      <Panel>
        <PanelHeader title="Restore backup" />
        <p className="codex-composer-hint">Download a backup first — restore replaces everything.</p>
        <Button variant="secondary" onClick={() => restoreInputRef.current?.click()}>Choose a backup file…</Button>
        <input ref={restoreInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { void pickRestore(event.target.files?.[0]); event.target.value = ""; }} />
        {pending && (
          <div className="codex-backup-confirm" role="alertdialog" aria-label="Restore this backup?">
            <h4>Restore this backup?</h4>
            <p>It replaces your entire Codex with the contents of <strong>{pending.name}</strong> — {countLine(pending.counts) || "its own records"}. This cannot be undone.</p>
            <div className="codex-conn-formactions">
              <Button variant="destructive" disabled={busy} onClick={() => void restore()}>Replace everything</Button>
              <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Bring in notes" />
        <p>Turn Markdown or text files into pages — one page per file. This adds pages; it never replaces anything.</p>
        <Field label="Import into" htmlFor="codex-notes-side" help="New pages start hidden from players either way.">
          <SegmentedControl ariaLabel="Which side to import into" value={notesSide} onChange={(value) => setNotesSide(value as "gm" | "player")}
            options={[{ value: "gm", label: "GM-only side" }, { value: "player", label: "Player-facing side" }]} />
        </Field>
        <Button variant="secondary" onClick={() => notesInputRef.current?.click()}>Choose files…</Button>
        <input ref={notesInputRef} type="file" accept=".md,.markdown,.txt" multiple hidden onChange={(event) => { void importNotes(event.target.files); event.target.value = ""; }} />
      </Panel>
    </div>
  );
}
