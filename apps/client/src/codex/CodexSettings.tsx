import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Field, Input, Select, Skeleton, Switch } from "@vtt/ui";
import { codexApi, AUTOSAVE_INTERVAL_CHOICES, AUTOSAVE_INTERVAL_MAX, AUTOSAVE_INTERVAL_MIN, REVISION_WINDOW_MAX, REVISION_WINDOW_MIN, type CodexAutosaveSettings, type CodexRevisionHistorySettings, type CodexSettings as CodexSettingsRecord } from "./api";
import { useConfirm } from "../components/feedback";

/**
 * Codex-wide settings — **owner decision, 2026-07-30**, and the FOURTH destination laid over the content
 * region, on identical terms to the session log, the quest log and the reveal audit: the five mode tabs
 * already overflow a 375px strip, so codex-wide surfaces are reached from the ops row instead, and each
 * opener closes the others rather than leaving one stacked behind another.
 *
 * WHY IT EXISTS AT ALL. Completing the export bundle showed `codex_page_revisions` is unbounded: every page
 * save writes a row, nothing prunes, and a revision row weighs the same as a page row (both bodies). It is
 * worse than "per save" implies, because the editor autosaves on an 800ms debounce — a version is written on
 * every pause in typing, so an hour of writing produces hundreds of rows for one page. Measured at a
 * deliberately conservative 15 revisions per page, the export went from 1.24 MB to 20.8 MB.
 *
 * The controls started life inside the page editor's Revision history panel, on the argument that it is
 * where a GM is when they wonder why the list is short. The owner chose a real settings screen instead, and
 * that argument is served differently now: the panel keeps a read-only sentence naming the setting in force,
 * so the short list still explains itself, and the controls that CHANGE it live here.
 *
 * **This screen only ever holds settings, never records.** A destructive action is allowed here (deleting old
 * versions is a setting-shaped decision about how much history to keep) but it is the only one, and it
 * confirms with the real count rather than a generic warning.
 */
export function CodexSettingsView({ gmToken, onSettingsChanged }: Readonly<{ gmToken: string; onSettingsChanged?: (settings: CodexSettingsRecord) => void }>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [settings, setSettings] = useState<CodexSettingsRecord | null>(null);
  // CF-2 at the level of the whole surface: before the first read settles, this screen is not entitled to
  // claim what the codex's settings ARE — an unread switch rendered "off" is a guess presented as state.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** How many days of history to keep when trimming. Local to the action, deliberately not a stored setting. */
  const [trimDays, setTrimDays] = useState("30");

  const load = useCallback(async () => {
    try { const next = await codexApi.getSettings(gmToken); setSettings(next); onSettingsChanged?.(next); setError(null); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Couldn't read the codex settings."); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmToken]);
  useEffect(() => { void load(); }, [load]);

  /**
   * Written straight through on change, with no Save button: each is one value, and the response carries the
   * CLAMPED result, so a field shows what the server actually stored rather than what was typed at it.
   */
  const save = async (patch: Readonly<{ revisionHistory?: CodexRevisionHistorySettings; autosave?: CodexAutosaveSettings }>) => {
    if (!settings) return;
    const revisionHistory = patch.revisionHistory ?? { enabled: settings.revisionHistory.enabled, windowMinutes: settings.revisionHistory.windowMinutes };
    const autosave = patch.autosave ?? settings.autosave;
    // Optimistic on the writable fields only; the usage figures stay whatever the last read reported,
    // because a client that recomputed them would be guessing about a table it cannot see.
    setSettings((prev) => prev ? { revisionHistory: { ...prev.revisionHistory, ...revisionHistory }, autosave } : prev);
    setNotice(null);
    try {
      // The PUT is WHOLESALE — both groups are required, so a body carrying one is a 400. Every write
      // from this screen therefore sends the pair it is holding, not the field that changed.
      const next = await codexApi.setSettings(gmToken, { revisionHistory, autosave });
      // Keep the optimistic value if the answer is unusable rather than blanking the screen: the next
      // control the GM touches must still know what the codex holds.
      if (next) { setSettings(next); onSettingsChanged?.(next); }
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "That setting could not be saved.");
      // Re-read, so the control shows what the codex holds rather than a value that never landed.
      try { const fresh = await codexApi.getSettings(gmToken); setSettings(fresh); onSettingsChanged?.(fresh); } catch { /* the error above already says it did not save */ }
    }
  };

  const history = settings?.revisionHistory ?? null;
  const autosave = settings?.autosave ?? null;

  /**
   * The one destructive action on this screen (owner decision, 2026-07-30).
   *
   * `olderThanDays: 0` deletes EVERYTHING, and that is arithmetic rather than a magic value — nothing is
   * younger than zero days old. It is still reached by its own button and its own confirm, never by winding
   * the day field down to 0, because the two are different decisions and one of them is unrecoverable.
   *
   * The confirm names the real count. "This cannot be undone" over an unknown number is a warning a GM
   * learns to click through; "delete 1,412 versions" is one they read.
   */
  const trim = async (olderThanDays: number) => {
    const kept = history?.versionCount ?? 0;
    const what = olderThanDays === 0
      ? `Delete all ${kept.toLocaleString()} saved version${kept === 1 ? "" : "s"} across every page?`
      : `Delete saved versions older than ${olderThanDays} day${olderThanDays === 1 ? "" : "s"}, across every page?`;
    if (!(await confirm({
      title: olderThanDays === 0 ? "Delete all version history" : "Delete old versions",
      body: `${what} Your pages are not changed. Only the earlier versions are deleted. This cannot be undone.`,
      confirmLabel: olderThanDays === 0 ? "Delete all versions" : "Delete them",
      danger: true
    }))) return;
    setBusy(true);
    setNotice(null);
    try {
      const { deleted } = await codexApi.deleteRevisions(gmToken, olderThanDays);
      setNotice(`Deleted ${deleted.toLocaleString()} saved version${deleted === 1 ? "" : "s"}.`);
      await load();
      setError(null);
    } catch (trimError) { setError(trimError instanceof Error ? trimError.message : "Those versions could not be deleted."); }
    finally { setBusy(false); }
  };

  const days = Math.max(1, Math.trunc(Number(trimDays) || 0));

  return (
    <>
      {/* No exit row: since D1 the sidebar is always on screen, so every section is one tap from every
          other one and a per-surface "back" would be a second navigation system. */}
      <div className="codex-settings">
        <header className="codex-audit-head">
          <h3 className="codex-audit-title">Settings</h3>
          <p className="codex-audit-scope">These apply to the whole Codex, for every page.</p>
        </header>

        {error && <Alert tone="danger" title="Codex settings">{error}</Alert>}
        {notice && <p className="notice notice-success" role="status">{notice}</p>}
        {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}

        {/* D6: the autosave setting, above version history because it governs the thing a GM notices
            first — whether their typing is being kept. */}
        {!loading && autosave && (
          <section className="codex-settings-section">
            <h4 className="codex-audit-h">Autosave</h4>
            <p className="codex-settings-lede">The Codex saves your edits as you type. Turn it off to save each record yourself.</p>
            <Switch checked={autosave.enabled} onChange={(enabled) => void save({ autosave: { ...autosave, enabled } })} label="Autosave" />
            {autosave.enabled ? (
              <Field label="Save after a pause of" htmlFor="autosave-interval" help="Longer intervals save fewer versions and risk losing more unsaved work.">
                <Select id="autosave-interval" value={String(autosave.intervalSeconds)}
                  onChange={(event) => {
                    // Clamped here as well as on the server, so the control cannot ask for a value that
                    // comes back changed; the server's answer is still what lands in state.
                    const typed = Math.trunc(Number(event.target.value));
                    const intervalSeconds = Number.isFinite(typed) ? Math.min(AUTOSAVE_INTERVAL_MAX, Math.max(AUTOSAVE_INTERVAL_MIN, typed)) : AUTOSAVE_INTERVAL_MIN;
                    void save({ autosave: { ...autosave, intervalSeconds } });
                  }}>
                  {AUTOSAVE_INTERVAL_CHOICES.map((seconds) => <option key={seconds} value={seconds}>{intervalLabel(seconds)}</option>)}
                  {/* A value set outside the picker (say, by an integration) renders as its own option, so
                      the control never claims a cadence the codex is not actually running. */}
                  {!AUTOSAVE_INTERVAL_CHOICES.includes(autosave.intervalSeconds) && (
                    <option value={autosave.intervalSeconds}>{autosave.intervalSeconds} seconds (custom)</option>
                  )}
                </Select>
              </Field>
            ) : (
              <p className="codex-composer-hint">Editors show a Save button and warn you before you leave with unsaved changes.</p>
            )}
          </section>
        )}

        {!loading && history && (
          <section className="codex-settings-section">
            <h4 className="codex-audit-h">Version history</h4>
            <p className="codex-settings-lede">
              Every time a page is saved, the Codex can keep the previous version. Pages autosave as you
              type, so version history grows quickly.
            </p>

            <Switch checked={history.enabled}
              onChange={(enabled) => void save({ revisionHistory: { enabled, windowMinutes: history.windowMinutes } })}
              label="Keep version history" />

            {history.enabled ? (
              <>
                <Field label="Save a version at most once every" htmlFor="rev-window"
                  help="Minutes. 0 keeps every save. At most this much work can be lost if you go back a version.">
                  <Input id="rev-window" type="number" inputMode="numeric" min={REVISION_WINDOW_MIN} max={REVISION_WINDOW_MAX}
                    value={String(history.windowMinutes)}
                    onChange={(event) => {
                      // Clamped here as well as on the server, so the field cannot ask for something that
                      // comes back changed; the server's answer is still what lands in state.
                      const typed = Math.trunc(Number(event.target.value));
                      const windowMinutes = Number.isFinite(typed) ? Math.min(REVISION_WINDOW_MAX, Math.max(REVISION_WINDOW_MIN, typed)) : REVISION_WINDOW_MIN;
                      void save({ revisionHistory: { enabled: history.enabled, windowMinutes } });
                    }} />
                </Field>
                {/* With a window set, the newest version is normally BEHIND the page as it stands — the one
                    thing about the history list that would otherwise read as a bug. */}
                {history.windowMinutes > 0 && (
                  <p className="codex-composer-hint">A page always keeps what you last typed. The newest saved version can be up to {history.windowMinutes} minutes behind it.</p>
                )}
              </>
            ) : (
              <p className="codex-composer-hint">New versions are not being saved. The ones you already have are kept, and can still be restored from a page's History.</p>
            )}

            {/* What it currently costs, so "should I trim this?" is answerable here rather than by exporting
                the codex and looking at the file size. */}
            <p className="codex-settings-usage">
              <Badge>{history.versionCount.toLocaleString()} saved version{history.versionCount === 1 ? "" : "s"}</Badge>
              {" "}<span className="codex-revision-when">about {formatBytes(history.versionBytes)} of text</span>
            </p>

            <div className="codex-settings-danger">
              <h4 className="codex-audit-h">Delete old versions</h4>
              <p className="codex-composer-hint">This removes earlier versions only. Your pages are not changed.</p>
              <Field label="Delete versions older than" htmlFor="rev-trim" help="Days.">
                <Input id="rev-trim" type="number" inputMode="numeric" min={1} value={trimDays} disabled={busy}
                  onChange={(event) => setTrimDays(event.target.value)} />
              </Field>
              <div className="codex-settings-actions">
                <Button variant="secondary" disabled={busy || history.versionCount === 0} onClick={() => void trim(days)}>
                  {busy ? "Deleting…" : `Delete versions older than ${days} day${days === 1 ? "" : "s"}`}
                </Button>
                {/* Its OWN button and its own confirm. Winding the field above down to zero must not be a
                    route to deleting everything — the two are different decisions and one is unrecoverable. */}
                <Button variant="destructive" disabled={busy || history.versionCount === 0} onClick={() => void trim(0)}>
                  Delete all version history
                </Button>
              </div>
            </div>
          </section>
        )}
      </div>
      {confirmDialog}
    </>
  );
}

/** The four cadences the picker offers, said in words rather than as a bare number of seconds. */
function intervalLabel(seconds: number): string {
  if (seconds === 1) return "1 second";
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds === 60) return "1 minute";
  return `${Math.round(seconds / 60)} minutes`;
}

/** Human-readable size for the history figure. Approximate on purpose — it is text length, not disk usage. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.trunc(bytes))} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
