import { Badge } from "@vtt/ui";
import { type CodexPageSummary } from "./api";
import { entityIcon } from "./entities";

/**
 * The campaign notebook's organizational tree: every page grouped into a collapsible nested-folder
 * hierarchy (folder paths like "NPCs/Villains"), Obsidian/OneNote style. Pure/derived - the folder
 * structure lives entirely in each page's `folder` path, so there are no folder records to manage.
 */
export type FolderNode = { name: string; path: string; folders: Map<string, FolderNode>; pages: CodexPageSummary[] };

export function buildFolderTree(pages: readonly CodexPageSummary[]): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: new Map(), pages: [] };
  for (const page of pages) {
    const segments = (page.folder ?? "").split("/").map((segment) => segment.trim()).filter(Boolean);
    let node = root;
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let child = node.folders.get(segment);
      if (!child) { child = { name: segment, path, folders: new Map(), pages: [] }; node.folders.set(segment, child); }
      node = child;
    }
    node.pages.push(page);
  }
  return root;
}

function countPages(node: FolderNode): number {
  let total = node.pages.length;
  for (const child of node.folders.values()) total += countPages(child);
  return total;
}

type NotebookTreeProps = Readonly<{
  node: FolderNode;
  depth?: number;
  collapsed: ReadonlySet<string>;
  selectedId: string | null;
  onToggle: (path: string) => void;
  onSelect: (pageId: string) => void;
  onNewInFolder: (path: string) => void;
}>;

export function NotebookTree({ node, depth = 0, collapsed, selectedId, onToggle, onSelect, onNewInFolder }: NotebookTreeProps) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  const pages = [...node.pages].sort((a, b) => a.title.localeCompare(b.title));
  return (
    <div className="codex-tree" role={depth === 0 ? "tree" : "group"}>
      {folders.map((folder) => {
        const open = !collapsed.has(folder.path);
        return (
          <div key={folder.path} className="codex-tree-branch" role="treeitem" aria-expanded={open}>
            <div className="codex-tree-folder-row" style={{ paddingInlineStart: `${depth * 14 + 6}px` }}>
              <button type="button" className="codex-tree-folder" onClick={() => onToggle(folder.path)}>
                <span className="codex-tree-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
                <span className="codex-tree-folder-name">{folder.name}</span>
                <span className="codex-tree-count">{countPages(folder)}</span>
              </button>
              <button type="button" className="codex-tree-folder-add" aria-label={`New note in ${folder.name}`} title={`New note in ${folder.name}`} onClick={() => onNewInFolder(folder.path)}>＋</button>
            </div>
            {open && <NotebookTree node={folder} depth={depth + 1} collapsed={collapsed} selectedId={selectedId} onToggle={onToggle} onSelect={onSelect} onNewInFolder={onNewInFolder} />}
          </div>
        );
      })}
      {pages.map((page) => (
        <button key={page.id} type="button" role="treeitem" aria-selected={page.id === selectedId} className={`codex-tree-page${page.id === selectedId ? " is-active" : ""}`} style={{ paddingInlineStart: `${depth * 14 + 20}px` }} onClick={() => onSelect(page.id)}>
          {page.entityType !== "note" && <span className="codex-tree-icon" aria-hidden="true">{entityIcon(page.entityType)}</span>}
          <span className="codex-list-title">{page.title}</span>
          {page.revealedToPlayers && <Badge tone="success">Shown</Badge>}
        </button>
      ))}
    </div>
  );
}
