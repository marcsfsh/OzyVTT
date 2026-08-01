import { useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./util";
import { Textarea } from "./forms";
import { IconButton } from "./Button";
import { SegmentedControl } from "./SegmentedControl";
import "./MarkdownEditor.css";

/**
 * D13 — **one editor everywhere.**
 *
 * The Codex's writing experience (toolbar, `[[link]]` autocomplete, image drop/paste, an Edit↔View
 * switch) lived inside `PageEditor` and nowhere else, so session prep, quest bodies and journal entries
 * were bare textareas: typing `[[` in one of them silently did nothing. Extracting it here — as a
 * primitive, per the repo rule that a new control goes to `@vtt/ui` + `/styleguide`, never inline in a
 * feature — is what lets every writing surface behave the same way.
 *
 * Deliberately **markdown-agnostic**: it renders no markdown itself. `renderPreview` is supplied by the
 * caller, which is what keeps the Codex's viewer-safe redlink renderer (and its GM-layer violet chrome)
 * out of the design system.
 */

export interface MarkdownSuggestion { id: string; label: string }

export interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Turns markdown into nodes. Omitted hides the Edit/View switch — an editor with no reader. */
  renderPreview?: (markdown: string) => ReactNode;
  /** `[[` autocomplete. Page targets only in v1; other target syntaxes still parse and persist. */
  suggest?: (query: string) => readonly MarkdownSuggestion[];
  /** Enables drop/paste of an image; returns the markdown to insert at the caret. */
  onUploadImage?: (file: File) => Promise<string>;
  /** Extra chrome inside the editor frame — the Codex hangs its violet "GM only" tag here. */
  overlay?: ReactNode;
  rows?: number;
  className?: string;
  id?: string;
}

/** Insert or wrap markdown at the selection, returning the new value + the caret to restore. */
export function applyMarkdownFormat(value: string, start: number, end: number, kind: string): { value: string; caret: number } {
  const selected = value.slice(start, end);
  const wrap = (marker: string) => ({ value: `${value.slice(0, start)}${marker}${selected || ""}${marker}${value.slice(end)}`, caret: start + marker.length + (selected.length || 0) });
  const linePrefix = (prefix: string) => {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    return { value: `${value.slice(0, lineStart)}${prefix}${value.slice(lineStart)}`, caret: end + prefix.length };
  };
  switch (kind) {
    case "bold": return wrap("**");
    case "italic": return wrap("*");
    case "strike": return wrap("~~");
    case "code": return wrap("`");
    case "heading": return linePrefix("## ");
    case "bullet": return linePrefix("- ");
    case "numbered": return linePrefix("1. ");
    case "quote": return linePrefix("> ");
    case "rule": return { value: `${value.slice(0, start)}\n---\n${value.slice(end)}`, caret: start + 5 };
    case "wikilink": return { value: `${value.slice(0, start)}[[${selected || ""}]]${value.slice(end)}`, caret: start + 2 + selected.length };
    default: return { value, caret: end };
  }
}

/**
 * The toolbar's marks. Letterforms (B / I / S / H) are set in the body face and are genuinely letters,
 * so they stay text; everything that would otherwise be a *symbol* character is an SVG path, per the
 * design language's §0 rule — a primitive must not render a glyph as text, because Manrope has no glyph
 * for most of them and the platform substitutes a face at the wrong size (and, on phones, emoji).
 */
function Mark({ children }: Readonly<{ children: ReactNode }>) {
  return <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">{children}</svg>;
}

const TOOLBAR: ReadonlyArray<Readonly<{ kind: string; label: string; glyph: ReactNode }>> = [
  { kind: "bold", label: "Bold", glyph: <span className="nh-mdeditor-letter nh-mdeditor-letter--bold">B</span> },
  { kind: "italic", label: "Italic", glyph: <span className="nh-mdeditor-letter nh-mdeditor-letter--italic">I</span> },
  { kind: "strike", label: "Strikethrough", glyph: <span className="nh-mdeditor-letter nh-mdeditor-letter--strike">S</span> },
  { kind: "code", label: "Inline code", glyph: <Mark><path d="M8.6 5.6 10 7 5.4 11.6 10 16.2l-1.4 1.4-6-6zm6.8 0 6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6z" /></Mark> },
  { kind: "heading", label: "Heading", glyph: <span className="nh-mdeditor-letter nh-mdeditor-letter--bold">H</span> },
  { kind: "bullet", label: "Bullet list", glyph: <Mark><path d="M4.4 5.4a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zm0 6.9a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zm0 6.9a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM9 6.1h11v2.1H9zm0 6.9h11v2.1H9zm0 6.9h11V22H9z" /></Mark> },
  { kind: "numbered", label: "Numbered list", glyph: <Mark><path d="M3 5.2h1.4v4.2H3zM3 4h2.6v1.2H3zm.1 8.6h2.7v1.1L4.4 15h1.5v1.1H3v-1.1l1.4-1.3H3.1zM3 19.2h2.6v3.4H3v-1h1.6v-.5H3.2v-.9h1.4v-.4H3zM9 6.1h11v2.1H9zm0 6.9h11v2.1H9zm0 6.9h11V22H9z" /></Mark> },
  { kind: "quote", label: "Quote", glyph: <Mark><path d="M4 6h5.4v6.2a5.6 5.6 0 0 1-4 5.4l-.8-1.9a3.4 3.4 0 0 0 2.4-2.7H4zm10.6 0H20v6.2a5.6 5.6 0 0 1-4 5.4l-.8-1.9a3.4 3.4 0 0 0 2.4-2.7h-3z" /></Mark> },
  { kind: "rule", label: "Divider", glyph: <Mark><path d="M3 11h18v2H3z" /></Mark> },
  { kind: "wikilink", label: "Link to another page", glyph: <Mark><path d="M6 3.4h4v2.1H8.1v13H10v2.1H6zm8 0h4v17.2h-4v-2.1h1.9v-13H14z" /></Mark> }
];

/** When the caret sits inside an unclosed `[[…`, return the open bracket's offset + the typed query. */
export function wikiLinkContext(value: string, caret: number): { start: number; query: string } | null {
  const prefix = value.slice(0, caret);
  const open = prefix.lastIndexOf("[[");
  if (open === -1) return null;
  const query = prefix.slice(open + 2);
  if (/[[\]\n]/.test(query)) return null;
  return { start: open, query };
}

export function MarkdownEditor({
  value, onChange, ariaLabel, placeholder, renderPreview, suggest, onUploadImage, overlay, rows, className, id
}: MarkdownEditorProps) {
  const [preview, setPreview] = useState(false);
  const [wiki, setWiki] = useState<{ start: number; query: string; index: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => (wiki && suggest ? suggest(wiki.query.trim()) : []), [wiki, suggest]);

  const format = (kind: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const next = applyMarkdownFormat(value, textarea.selectionStart, textarea.selectionEnd, kind);
    onChange(next.value);
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(next.caret, next.caret); });
  };
  const insertAtCursor = (snippet: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    onChange(`${value.slice(0, start)}${snippet}${value.slice(end)}`);
    const caret = start + snippet.length;
    requestAnimationFrame(() => { textarea?.focus(); textarea?.setSelectionRange(caret, caret); });
  };
  const upload = async (file: File | undefined) => {
    if (!file || !onUploadImage) return;
    try { insertAtCursor(await onUploadImage(file)); } catch { /* the caller surfaces upload failures */ }
  };
  const syncWiki = (next: string, caret: number) => {
    if (!suggest) return;
    const context = wikiLinkContext(next, caret);
    setWiki(context ? { start: context.start, query: context.query, index: 0 } : null);
  };
  const insertWiki = (title: string) => {
    const textarea = textareaRef.current;
    if (!textarea || !wiki) return;
    const before = value.slice(0, wiki.start);
    const after = value.slice(textarea.selectionStart);
    const closing = after.startsWith("]]") ? "" : "]]";
    onChange(`${before}[[${title}${closing}${after}`);
    setWiki(null);
    const caret = before.length + 2 + title.length + 2;
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(caret, caret); });
  };

  return (
    <div className={cx("nh-mdeditor", className)}>
      <div className="nh-mdeditor-bar">
        {!preview && (
          <div className="nh-mdeditor-toolbar" role="toolbar" aria-label="Formatting">
            {TOOLBAR.map((tool) => (
              <IconButton key={tool.kind} label={tool.label} size="sm" onClick={() => format(tool.kind)}>
                {tool.glyph}
              </IconButton>
            ))}
            {onUploadImage && <>
              <IconButton label="Insert image" size="sm" onClick={() => imageInputRef.current?.click()}>
                <Mark><path fillRule="evenodd" d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm2 2v7.6l3.6-3.6 3 3 2-2L20 15V6zM8.2 7.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z" /></Mark>
              </IconButton>
              <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
            </>}
          </div>
        )}
        {renderPreview && (
          <SegmentedControl ariaLabel="Edit or read" value={preview ? "view" : "edit"} className="nh-mdeditor-mode"
            onChange={(next) => setPreview(next === "view")}
            options={[{ value: "edit", label: "Edit" }, { value: "view", label: "View" }]} />
        )}
      </div>

      {preview && renderPreview
        ? <div className="nh-mdeditor-preview">{overlay}{value.trim() ? renderPreview(value) : <p className="nh-mdeditor-empty">Nothing to read yet.</p>}</div>
        : <div className="nh-mdeditor-frame"
            onDrop={(event) => { const file = event.dataTransfer?.files?.[0]; if (file && file.type.startsWith("image/")) { event.preventDefault(); void upload(file); } }}
            onDragOver={(event) => { if (onUploadImage) event.preventDefault(); }}
            onPaste={(event) => {
              const items = event.clipboardData?.items;
              for (let index = 0; items && index < items.length; index += 1) {
                if (items[index].type.startsWith("image/")) { const file = items[index].getAsFile(); if (file) { event.preventDefault(); void upload(file); return; } }
              }
            }}>
            <Textarea ref={textareaRef} id={id} className="nh-mdeditor-input" value={value} aria-label={ariaLabel} placeholder={placeholder} rows={rows}
              onChange={(event) => { onChange(event.target.value); syncWiki(event.target.value, event.target.selectionStart ?? 0); }}
              onKeyDown={(event) => {
                if (!wiki || suggestions.length === 0) return;
                if (event.key === "ArrowDown") { event.preventDefault(); setWiki((prev) => prev && { ...prev, index: Math.min(prev.index + 1, suggestions.length - 1) }); }
                else if (event.key === "ArrowUp") { event.preventDefault(); setWiki((prev) => prev && { ...prev, index: Math.max(prev.index - 1, 0) }); }
                else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); insertWiki(suggestions[Math.min(wiki.index, suggestions.length - 1)].label); }
                else if (event.key === "Escape") { event.preventDefault(); setWiki(null); }
              }}
              onKeyUp={(event) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) syncWiki(event.currentTarget.value, event.currentTarget.selectionStart ?? 0); }}
              onClick={(event) => syncWiki(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
              onBlur={() => window.setTimeout(() => setWiki(null), 150)} />
            {overlay}
            {wiki && suggestions.length > 0 && (
              <ul className="nh-mdeditor-suggest" role="listbox" aria-label="Link to page">
                {suggestions.map((candidate, index) => (
                  <li key={candidate.id} role="option" aria-selected={index === wiki.index}>
                    <button type="button" className={cx("nh-mdeditor-suggestitem", index === wiki.index && "is-active")}
                      onMouseDown={(event) => event.preventDefault()} onClick={() => insertWiki(candidate.label)}>{candidate.label}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>}
    </div>
  );
}
