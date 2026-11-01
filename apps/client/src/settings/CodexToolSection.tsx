import { Group } from "@vtt/ui";
import { BackupView } from "../codex/BackupView";
import { CodexSettingsView } from "../codex/CodexSettings";
import { CODEX_TOOLS, type CodexToolId } from "./codexTools";

/**
 * One of the Codex's tools as a page of Settings (F time spec 2.6): its name and line at the head, then the tool's
 * rows from the Codex's own Backup and Settings views, which keep their routes, words and confirms.
 */
export function CodexToolSection({ tool, gmToken }: Readonly<{ tool: CodexToolId; gmToken: string }>) {
  const meta = CODEX_TOOLS.find((each) => each.id === tool)!;
  return (
    <section className={`settings-section settings-section--codex-${tool}`} aria-labelledby="settings-codex-title">
      <header className="settings-head">
        <h2 id="settings-codex-title" className="settings-head-title">
          {meta.label}
        </h2>
        <p className="settings-section-line">{meta.hint}</p>
      </header>
      <Group className="settings-panel">
        {tool === "autosave" || tool === "history" ? (
          <CodexSettingsView gmToken={gmToken} part={tool} />
        ) : (
          <BackupView gmToken={gmToken} part={tool} onChanged={() => undefined} />
        )}
      </Group>
    </section>
  );
}
