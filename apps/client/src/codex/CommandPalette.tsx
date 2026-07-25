import { useEffect, useMemo, useRef, useState } from "react";
import { codexApi, type CodexPageSummary } from "./api";

/**
 * The codex quick-switcher: jump to any page by name, switch surfaces, or create a page on the fly.
 * Opened with Cmd/Ctrl-K (or a toolbar button). Keyboard-first: type to filter, ↑/↓ to move, Enter to
 * run the highlighted action, Esc to close.
 */
type GotoTarget = "world" | "pages" | "atlas" | "journal" | "graph";
type Action =
  | { kind: "page"; id: string; label: string }
  | { kind: "create"; label: string; title: string }
  | { kind: "goto"; label: string; target: GotoTarget };

type CommandPaletteProps = Readonly<{
  gmToken: string;
  onOpenPage: (id: string) => void;
  onCreatePage: (title: string) => void;
  onGoto: (target: GotoTarget) => void;
  onClose: () => void;
}>;

const GOTO: ReadonlyArray<{ label: string; target: GotoTarget }> = [
  { label: "Go to World", target: "world" },
  { label: "Go to Pages", target: "pages" },
  { label: "Go to Atlas", target: "atlas" },
  { label: "Go to Journal", target: "journal" },
  { label: "Go to Graph", target: "graph" }
];

export function CommandPalette({ gmToken, onOpenPage, onCreatePage, onGoto, onClose }: CommandPaletteProps) {
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void codexApi.listPages(gmToken).then(setPages).catch(() => setPages([])); }, [gmToken]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const actions = useMemo<Action[]>(() => {
    const q = query.trim().toLowerCase();
    const matched = pages.filter((page) => !q || page.title.toLowerCase().includes(q)).slice(0, 8).map((page) => ({ kind: "page" as const, id: page.id, label: page.title }));
    const list: Action[] = [...matched];
    if (q && !pages.some((page) => page.title.toLowerCase() === q)) list.push({ kind: "create", label: `Create page “${query.trim()}”`, title: query.trim() });
    if (!q) list.push(...GOTO.map((entry) => ({ kind: "goto" as const, label: entry.label, target: entry.target })));
    return list;
  }, [pages, query]);

  useEffect(() => { setActive(0); }, [query]);

  const run = (action: Action | undefined) => {
    if (!action) return;
    if (action.kind === "page") onOpenPage(action.id);
    else if (action.kind === "create") onCreatePage(action.title);
    else onGoto(action.target);
    onClose();
  };

  return (
    <div className="codex-palette-scrim" onPointerDown={onClose}>
      <div className="codex-palette" role="dialog" aria-label="Codex command palette" onPointerDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="codex-palette-input"
          value={query}
          placeholder="Jump to a page, or type to create…"
          aria-label="Command palette"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, actions.length - 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
            else if (event.key === "Enter") { event.preventDefault(); run(actions[active]); }
            else if (event.key === "Escape") { event.preventDefault(); onClose(); }
          }}
        />
        <ul className="codex-palette-list">
          {actions.length === 0 && <li className="codex-palette-empty">No matches.</li>}
          {actions.map((action, index) => (
            <li key={`${action.kind}-${index}`}>
              <button type="button" className={`codex-palette-item${index === active ? " is-active" : ""}${action.kind !== "page" ? " is-action" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => run(action)}>
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
