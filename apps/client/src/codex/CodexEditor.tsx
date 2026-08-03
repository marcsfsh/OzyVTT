import { useCallback, useMemo } from "react";
import { GmOnlyTag, MarkdownEditor } from "@vtt/ui";
import { CodexMarkdown } from "./CodexMarkdown";
import { uploadCodexAsset, pageLinkKey } from "./api";

/**
 * D13 — the Codex's wrapper around the shared `MarkdownEditor` primitive.
 *
 * The primitive is deliberately codex-agnostic; this is where the Codex's own knowledge is wired in:
 * `CodexMarkdown` as the reader (which is what keeps viewer-safe redlinks and `codex-asset:` images
 * working), the page list as `[[` autocomplete, the asset upload route, and the violet GM-layer chrome.
 *
 * **Every writing surface in the suite now mounts this** — page bodies, session prep and recap, quest
 * bodies, the journal composer and its edit path. That is the whole of D13: before it, typing `[[` in a
 * session's prep did nothing at all, and a quest body rendered as plain text for players while the same
 * markdown rendered properly on a page.
 *
 * **Ruling R10:** autocomplete and click-navigation handle **page targets only**. `[[map:…]]` and
 * `[[marker:…]]` still parse and persist server-side (no regression) but get no UI exposure in v1.
 */
export type CodexEditorProps = Readonly<{
  token: string;
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Page titles for `[[` autocomplete. Pass the shell's one page feed — never a second fetch. */
  pages: ReadonlyArray<Readonly<{ id: string; title: string }>>;
  /** Excluded from the suggestions: a page should not offer to link to itself. */
  excludePageId?: string;
  /** Follow a rendered `[[link]]`. Page targets only (R10). */
  onNavigate: (target: string) => void;
  /** GM-layer instances take the violet chrome and the "GM only" tag. */
  gmLayer?: boolean;
  /** Titles that exist, so an unresolved link renders as a redlink rather than a working one. */
  knownTitles?: ReadonlySet<string>;
  rows?: number;
  id?: string;
}>;

export function CodexEditor({
  token, value, onChange, ariaLabel, placeholder, pages, excludePageId, onNavigate, gmLayer = false, knownTitles, rows, id
}: CodexEditorProps) {
  const suggest = useCallback((query: string) => {
    const needle = query.trim().toLowerCase();
    return pages
      .filter((page) => page.id !== excludePageId && page.title.toLowerCase().includes(needle))
      .slice(0, 6)
      .map((page) => ({ id: page.id, label: page.title }));
  }, [pages, excludePageId]);

  const titles = useMemo(
    () => knownTitles ?? new Set(pages.map((page) => pageLinkKey(page.title))),
    [knownTitles, pages]
  );

  return (
    <div className={`codex-editor-surface${gmLayer ? " is-gm codex-gm-block" : ""}`}>
      <MarkdownEditor
        id={id}
        value={value}
        onChange={onChange}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        rows={rows}
        suggest={suggest}
        renderPreview={(markdown) => <CodexMarkdown text={markdown} onNavigate={onNavigate} token={token} knownTitles={titles} />}
        onUploadImage={async (file) => {
          const asset = await uploadCodexAsset(token, file);
          return `\n![${file.name.replace(/\.[^.]+$/, "")}](codex-asset:${asset.id})\n`;
        }}
        overlay={gmLayer ? <GmOnlyTag floating /> : undefined}
      />
    </div>
  );
}
