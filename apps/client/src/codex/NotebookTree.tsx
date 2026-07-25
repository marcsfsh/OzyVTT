import { useState } from "react";
import { Badge } from "@vtt/ui";
import { type CodexPageSummary } from "./api";
import { entityIcon } from "./entities";

/**
 * The campaign notebook's organizational tree: every page grouped into a collapsible nested-folder
 * hierarchy (folder paths like "NPCs/Villains"), Obsidian/OneNote style. The folder structure lives
 * entirely in each page's `folder` path, so there are no folder records to manage. Pages can be
 * re-organized by drag-and-drop (desktop) or a "move" affordance (touch), and folders sorted + renamed.
 */
export type FolderNode = { name: string; path: string; folders: Map<string, FolderNode>; pages: CodexPageSummary[] };
export type NotebookSort = "name-asc" | "name-desc" | "recent";
const DRAG_TYPE = "application/x-codex-page";

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

type Handlers = Readonly<{
  collapsed: ReadonlySet<string>;
  selectedId: string | null;
  sort: NotebookSort;
  onToggle: (path: string) => void;
  onSelect: (pageId: string) => void;
  onNewInFolder: (path: string) => void;
  onRenameFolder: (path: string) => void;
  onMovePage: (pageId: string, folderPath: string | null) => void;
  onRequestMove: (pageId: string) => void;
}>;

function sortFolders(node: FolderNode, sort: NotebookSort): FolderNode[] {
  const dir = sort === "name-desc" ? -1 : 1;
  return [...node.folders.values()].sort((a, b) => dir * a.name.localeCompare(b.name));
}
function sortPages(node: FolderNode, sort: NotebookSort): CodexPageSummary[] {
  if (sort === "recent") return [...node.pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const dir = sort === "name-desc" ? -1 : 1;
  return [...node.pages].sort((a, b) => dir * a.title.localeCompare(b.title));
}

/** A folder branch that highlights itself as a drop target while a page is dragged over it. */
function FolderBranch({ folder, depth, handlers }: Readonly<{ folder: FolderNode; depth: number; handlers: Handlers }>) {
  const [over, setOver] = useState(false);
  const open = !handlers.collapsed.has(folder.path);
  return (
    <div className="codex-tree-branch" role="treeitem" aria-expanded={open}>
      <div
        className={`codex-tree-folder-row${over ? " is-drop" : ""}`}
        style={{ paddingInlineStart: `${depth * 14 + 6}px` }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setOver(false); const id = event.dataTransfer.getData(DRAG_TYPE); if (id) handlers.onMovePage(id, folder.path); }}
      >
        <button type="button" className="codex-tree-folder" onClick={() => handlers.onToggle(folder.path)}>
          <span className="codex-tree-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="codex-tree-folder-name">{folder.name}</span>
          <span className="codex-tree-count">{countPages(folder)}</span>
        </button>
        <div className="codex-tree-folder-actions">
          <button type="button" className="codex-tree-folder-btn" aria-label={`Rename ${folder.name}`} title="Rename folder" onClick={() => handlers.onRenameFolder(folder.path)}>✎</button>
          <button type="button" className="codex-tree-folder-btn" aria-label={`New note in ${folder.name}`} title="New note here" onClick={() => handlers.onNewInFolder(folder.path)}>＋</button>
        </div>
      </div>
      {open && <NotebookTree node={folder} depth={depth + 1} {...handlers} />}
    </div>
  );
}

type NotebookTreeProps = Handlers & Readonly<{ node: FolderNode; depth?: number }>;

export function NotebookTree({ node, depth = 0, ...handlers }: NotebookTreeProps) {
  const folders = sortFolders(node, handlers.sort);
  const pages = sortPages(node, handlers.sort);
  // The top-level container is the drop target for "move to the top level" (clear a page's folder).
  const rootDrop = depth === 0
    ? {
        onDragOver: (event: React.DragEvent) => { if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault(); },
        onDrop: (event: React.DragEvent) => { const id = event.dataTransfer.getData(DRAG_TYPE); if (id) handlers.onMovePage(id, null); }
      }
    : {};
  return (
    <div className="codex-tree" role={depth === 0 ? "tree" : "group"} {...rootDrop}>
      {folders.map((folder) => <FolderBranch key={folder.path} folder={folder} depth={depth} handlers={handlers} />)}
      {pages.map((page) => (
        <div key={page.id} className="codex-tree-page-row" style={{ paddingInlineStart: `${depth * 14 + 20}px` }}>
          <button
            type="button" role="treeitem" aria-selected={page.id === handlers.selectedId}
            className={`codex-tree-page${page.id === handlers.selectedId ? " is-active" : ""}`}
            draggable
            onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, page.id); event.dataTransfer.effectAllowed = "move"; }}
            onClick={() => handlers.onSelect(page.id)}
          >
            {page.entityType !== "note" && <span className="codex-tree-icon" aria-hidden="true">{entityIcon(page.entityType)}</span>}
            <span className="codex-list-title">{page.title}</span>
            {page.revealedToPlayers && <Badge tone="success">Shown</Badge>}
          </button>
          <button type="button" className="codex-tree-page-move" aria-label={`Move ${page.title}`} title="Move to folder" onClick={() => handlers.onRequestMove(page.id)}>⋯</button>
        </div>
      ))}
    </div>
  );
}
