import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Field, Input, Select, Skeleton, Switch } from "@vtt/ui";
import {
  codexApi,
  AUTOSAVE_INTERVAL_CHOICES,
  AUTOSAVE_INTERVAL_MAX,
  AUTOSAVE_INTERVAL_MIN,
  REVISION_WINDOW_MAX,
  REVISION_WINDOW_MIN,
  type CodexAutosaveSettings,
  type CodexRevisionHistorySettings,
  type CodexSettings as CodexSettingsRecord
} from "./api";
import { useConfirm } from "../components/feedback";

/**
 * Codex-wide settings: autosave and version history. Holds settings only, never records; its one
 * destructive action (trimming old versions) confirms with the real count.
 */
export function CodexSettingsView({
  gmToken,
  onSettingsChanged
}: Readonly<{ gmToken: string; onSettingsChanged?: (settings: CodexSettingsRecord) => void }>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [settings, setSettings] = useState<CodexSettingsRecord | null>(null);
  // Until the first read settles, don't show a guessed state.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Days of history to keep when trimming. Local to the action, not a stored setting. */
  const [trimDays, setTrimDays] = useState("30");

  const load = useCallback(async () => {
    try {
      const next = await codexApi.getSettings(gmToken);
      setSettings(next);
      onSettingsChanged?.(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Couldn't read the codex settings.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmToken]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Written through on change; the response carries the clamped value the server stored. */
  const save = async (
    patch: Readonly<{ revisionHistory?: CodexRevisionHistorySettings; autosave?: CodexAutosaveSettings }>
  ) => {
    if (!settings) return;
    const revisionHistory = patch.revisionHistory ?? {
      enabled: settings.revisionHistory.enabled,
      windowMinutes: settings.revisionHistory.windowMinutes
    };
    const autosave = patch.autosave ?? settings.autosave;
    // Optimistic on writable fields only; usage figures stay as last reported by the server.
    setSettings((prev) =>
      prev ? { revisionHistory: { ...prev.revisionHistory, ...revisionHistory }, autosave } : prev
    );
    setNotice(null);
    try {
      // The PUT is wholesale, so send both groups every time.
      const next = await codexApi.setSettings(gmToken, { revisionHistory, autosave });
      // Keep the optimistic value if the answer is unusable, rather than blanking the screen.
      if (next) {
        setSettings(next);
        onSettingsChanged?.(next);
      }
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "That setting could not be saved.");
      // Re-read so the control shows what the codex actually holds.
      try {
        const fresh = await codexApi.getSettings(gmToken);
        setSettings(fresh);
        onSettingsChanged?.(fresh);
      } catch {
        /* the error above already says it did not save */
      }
    }
  };

  const history = settings?.revisionHistory ?? null;
  const autosave = settings?.autosave ?? null;

  /** `olderThanDays: 0` deletes everything, reached only by its own button and confirm. */
  const trim = async (olderThanDays: number) => {
    const kept = history?.versionCount ?? 0;
    const what =
      olderThanDays === 0
        ? `Delete all ${kept.toLocaleString()} saved version${kept === 1 ? "" : "s"} across every page?`
        : `Delete saved versions older than ${olderThanDays} day${olderThanDays === 1 ? "" : "s"}, across every page?`;
    if (
      !(await confirm({
        title: olderThanDays === 0 ? "Delete all version history" : "Delete old versions",
        body: `${what} Your pages are not changed. Only the earlier versions are deleted. This cannot be undone.`,
        confirmLabel: olderThanDays === 0 ? "Delete all versions" : "Delete them",
        danger: true
      }))
    )
      return;
    setBusy(true);
    setNotice(null);
    try {
      const { deleted } = await codexApi.deleteRevisions(gmToken, olderThanDays);
      setNotice(`Deleted ${deleted.toLocaleString()} saved version${deleted === 1 ? "" : "s"}.`);
      await load();
      setError(null);
    } catch (trimError) {
      setError(trimError instanceof Error ? trimError.message : "Those versions could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  const days = Math.max(1, Math.trunc(Number(trimDays) || 0));

  return (
    <>
      <div className="codex-settings">
        <header className="codex-audit-head">
          <h3 className="codex-audit-title">Settings</h3>
          <p className="codex-audit-scope">These apply to the whole Codex, for every page.</p>
        </header>

        {error && (
          <Alert tone="danger" title="Codex settings">
            {error}
          </Alert>
        )}
        {notice && (
          <p className="notice notice-success" role="status">
            {notice}
          </p>
        )}
        {loading && (
          <div className="codex-list-loading">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} variant="text" />
            ))}
          </div>
        )}

        {/* Autosave first: it governs what a GM notices first. */}
        {!loading && autosave && (
          <section className="codex-settings-section">
            <h4 className="codex-audit-h">Autosave</h4>
            <p className="codex-settings-lede">
              The Codex saves your edits as you type. Turn it off to save each record yourself.
            </p>
            <Switch
              checked={autosave.enabled}
              onChange={(enabled) => void save({ autosave: { ...autosave, enabled } })}
              label="Autosave"
            />
            {autosave.enabled ? (
              <Field
                label="Save after a pause of"
                htmlFor="autosave-interval"
                help="Longer intervals save fewer versions and risk losing more unsaved work."
              >
                <Select
                  id="autosave-interval"
                  value={String(autosave.intervalSeconds)}
                  onChange={(event) => {
                    // Clamped like the server; the server's answer still lands in state.
                    const typed = Math.trunc(Number(event.target.value));
                    const intervalSeconds = Number.isFinite(typed)
                      ? Math.min(AUTOSAVE_INTERVAL_MAX, Math.max(AUTOSAVE_INTERVAL_MIN, typed))
                      : AUTOSAVE_INTERVAL_MIN;
                    void save({ autosave: { ...autosave, intervalSeconds } });
                  }}
                >
                  {AUTOSAVE_INTERVAL_CHOICES.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {intervalLabel(seconds)}
                    </option>
                  ))}
                  {/* A value set outside the picker renders as its own option. */}
                  {!AUTOSAVE_INTERVAL_CHOICES.includes(autosave.intervalSeconds) && (
                    <option value={autosave.intervalSeconds}>{autosave.intervalSeconds} seconds (custom)</option>
                  )}
                </Select>
              </Field>
            ) : (
              <p className="codex-composer-hint">
                Editors show a Save button and warn you before you leave with unsaved changes.
              </p>
            )}
          </section>
        )}

        {!loading && history && (
          <section className="codex-settings-section">
            <h4 className="codex-audit-h">Version history</h4>
            <p className="codex-settings-lede">
              Every time a page is saved, the Codex can keep the previous version. Pages autosave as you type, so
              version history grows quickly.
            </p>

            <Switch
              checked={history.enabled}
              onChange={(enabled) => void save({ revisionHistory: { enabled, windowMinutes: history.windowMinutes } })}
              label="Keep version history"
            />

            {history.enabled ? (
              <>
                <Field
                  label="Save a version at most once every"
                  htmlFor="rev-window"
                  help="Minutes. 0 keeps every save. At most this much work can be lost if you go back a version."
                >
                  <Input
                    id="rev-window"
                    type="number"
                    inputMode="numeric"
                    min={REVISION_WINDOW_MIN}
                    max={REVISION_WINDOW_MAX}
                    value={String(history.windowMinutes)}
                    onChange={(event) => {
                      // Clamped like the server; the server's answer still lands in state.
                      const typed = Math.trunc(Number(event.target.value));
                      const windowMinutes = Number.isFinite(typed)
                        ? Math.min(REVISION_WINDOW_MAX, Math.max(REVISION_WINDOW_MIN, typed))
                        : REVISION_WINDOW_MIN;
                      void save({ revisionHistory: { enabled: history.enabled, windowMinutes } });
                    }}
                  />
                </Field>
                {/* With a window set, the newest version normally lags the page; say so. */}
                {history.windowMinutes > 0 && (
                  <p className="codex-composer-hint">
                    A page always keeps what you last typed. The newest saved version can be up to{" "}
                    {history.windowMinutes} minutes behind it.
                  </p>
                )}
              </>
            ) : (
              <p className="codex-composer-hint">
                New versions are not being saved. The ones you already have are kept, and can still be restored from a
                page's History.
              </p>
            )}

            {/* What history currently costs. */}
            <p className="codex-settings-usage">
              <Badge>
                {history.versionCount.toLocaleString()} saved version{history.versionCount === 1 ? "" : "s"}
              </Badge>{" "}
              <span className="codex-revision-when">about {formatBytes(history.versionBytes)} of text</span>
            </p>

            <div className="codex-settings-danger">
              <h4 className="codex-audit-h">Delete old versions</h4>
              <p className="codex-composer-hint">This removes earlier versions only. Your pages are not changed.</p>
              <Field label="Delete versions older than" htmlFor="rev-trim" help="Days.">
                <Input
                  id="rev-trim"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={trimDays}
                  disabled={busy}
                  onChange={(event) => setTrimDays(event.target.value)}
                />
              </Field>
              <div className="codex-settings-actions">
                <Button
                  variant="secondary"
                  disabled={busy || history.versionCount === 0}
                  onClick={() => void trim(days)}
                >
                  {busy ? "Deleting…" : `Delete versions older than ${days} day${days === 1 ? "" : "s"}`}
                </Button>
                {/* Its own button and confirm; the day field above can't reach zero. */}
                <Button
                  variant="destructive"
                  disabled={busy || history.versionCount === 0}
                  onClick={() => void trim(0)}
                >
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

/** The picker's presets in words. */
function intervalLabel(seconds: number): string {
  if (seconds === 1) return "1 second";
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds === 60) return "1 minute";
  return `${Math.round(seconds / 60)} minutes`;
}

/** Approximate on purpose: text length, not disk usage. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.trunc(bytes))} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
