import { sessionPath, templatePath } from "../routes";
import { useCodexShell, useGmCodex } from "../shell/context";
import { TemplatesView } from "./TemplatesView";

/** Prep templates as the GM's Codex section, from the GM menu. No player view: templates reach no player. */
export function GmTemplatesSection() {
  const { token, recordId, go } = useCodexShell();
  const { feeds, autosave } = useGmCodex();
  return (
    <TemplatesView
      gmToken={token}
      autosave={autosave}
      sessions={feeds.sessions}
      templateId={recordId}
      onSelectTemplate={(id) => go(templatePath(id), { replace: true })}
      onOpenSession={(id) => go(sessionPath(id))}
      onSessionsChanged={feeds.sessionFeed.reload}
    />
  );
}
