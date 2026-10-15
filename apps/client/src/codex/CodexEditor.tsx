import { useCallback, useMemo } from "react";
import { GmOnlyTag, MarkdownEditor } from "@vtt/ui";
import { CodexMarkdown } from "./CodexMarkdown";
import { pageLinkKey } from "@vtt/domain";
import { uploadCodexAsset } from "./api";

/**
 * The Codex's wrapper around `MarkdownEditor`: `CodexMarkdown` as the reader (viewer-safe redlinks and
 * `codex-asset:` images), the page list for `[[` autocomplete, asset uploads, and the violet GM-layer
 * chrome. Every Codex writing surface uses it. Autocomplete and navigation handle page targets only.
 */
export type CodexEditorProps = Readonly<{
  token: string;
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Page titles for `[[` autocomplete; pass the shell's page feed. */
  pages: ReadonlyArray<Readonly<{ id: string; title: string }>>;
  /** A page shouldn't offer to link to itself. */
  excludePageId?: string;
  /** Follow a rendered `[[link]]`. Page targets only. */
  onNavigate: (target: string) => void;
  /** GM-layer instances take the violet chrome and the "GM only" tag. */
  gmLayer?: boolean;
  /** Titles that exist, so an unresolved link renders as a redlink rather than a working one. */
  knownTitles?: ReadonlySet<string>;
  /**
   * Take the frame's height instead of the primitive's 14rem floor. Only for a mount inside an unbroken flex
   * column with a definite height; elsewhere it would collapse the field.
   */
  fill?: boolean;
  rows?: number;
  id?: string;
}>;

export function CodexEditor({
  token,
  value,
  onChange,
  ariaLabel,
  placeholder,
  pages,
  excludePageId,
  onNavigate,
  gmLayer = false,
  knownTitles,
  fill = false,
  rows,
  id
}: CodexEditorProps) {
  const suggest = useCallback(
    (query: string) => {
      const needle = query.trim().toLowerCase();
      return pages
        .filter((page) => page.id !== excludePageId && page.title.toLowerCase().includes(needle))
        .slice(0, 6)
        .map((page) => ({ id: page.id, label: page.title }));
    },
    [pages, excludePageId]
  );

  const titles = useMemo(
    () => knownTitles ?? new Set(pages.map((page) => pageLinkKey(page.title))),
    [knownTitles, pages]
  );

  return (
    <div className={`codex-editor-surface${fill ? " is-fill" : ""}${gmLayer ? " is-gm codex-gm-block" : ""}`}>
      <MarkdownEditor
        id={id}
        value={value}
        onChange={onChange}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        rows={rows}
        suggest={suggest}
        renderPreview={(markdown) => (
          <CodexMarkdown text={markdown} onNavigate={onNavigate} token={token} knownTitles={titles} />
        )}
        onUploadImage={async (file) => {
          const asset = await uploadCodexAsset(token, file);
          return `\n![${file.name.replace(/\.[^.]+$/, "")}](codex-asset:${asset.id})\n`;
        }}
        overlay={gmLayer ? <GmOnlyTag floating /> : undefined}
      />
    </div>
  );
}
