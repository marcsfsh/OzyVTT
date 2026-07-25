import { useState } from "react";
import { Badge } from "@vtt/ui";
import { type CodexPageSummary } from "./api";
import { CodexIcon, EntityIcon } from "./icons";

/**
 * The campaign notebook's organizational tree: every page grouped into a collapsible nested-folder
 * hierarchy (folder paths like "NPCs/Villains"), Obsidian/OneNote style. Folders come from two sources
 * unioned together — each page's `folder` path AND explicit folder records (so an empty folder persists).
 * Within any folder, notes render ABOVE subfolders. Pages can be re-organized by drag-and-drop (desktop)
 * or a "move" affordance (touch), and folders sorted + renamed.
 */
export type FolderNode = { name: string; path: string; folders: Map<string, FolderNode>; pages: CodexPageSummary[] };
export type NotebookSort = "name-asc" | "name-desc" | "recent";
const DRAG_TYPE = "application/x-codex-page";

/** Walk/create the folder-node chain for a "A/B/C" path, returning the leaf node. */
function ensureFolder(root: FolderNode, folderPath: string): FolderNode {
  let node = root;
  let path = "";
  for (const segment of folderPath.split("/").map((s) => s.trim()).filter(Boolean)) {
    path = path ? `${path}/${segment}` : segment;
    let child = node.folders.get(segment);
    if (!child) { child = { name: segment, path, folders: new Map(), pages: [] }; node.folders.set(segment, child); }
    node = child;
  }
  return node;
}

/** Build the tree from pages AND explicit folder records (so a folder with no pages still appears). */
export function buildFolderTree(pages: readonly CodexPageSummary[], folderPaths: readonly string[] = []): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: new Map(), pages: [] };
  for (const path of folderPaths) ensureFolder(root, path); // empty folders first, so they persist without pages
  for (const page of pages) ensureFolder(root, page.folder ?? "").pages.push(page);
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
  onNewSubfolder: (path: string) => void;
  onRenameFolder: (path: string) => void;
  onDeleteFolder: (path: string) => void;
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
          <button type="button" className="codex-tree-folder-btn" aria-label={`New subfolder in ${folder.name}`} title="New subfolder" onClick={() => handlers.onNewSubfolder(folder.path)}><CodexIcon iconId="folder-plus" className="codex-tree-folder-ic" /></button>
          <button type="button" className="codex-tree-folder-btn" aria-label={`New note in ${folder.name}`} title="New note here" onClick={() => handlers.onNewInFolder(folder.path)}>＋</button>
          <button type="button" className="codex-tree-folder-btn" aria-label={`Rename ${folder.name}`} title="Rename folder" onClick={() => handlers.onRenameFolder(folder.path)}>✎</button>
          <button type="button" className="codex-tree-folder-btn" aria-label={`Delete ${folder.name}`} title="Delete folder" onClick={() => handlers.onDeleteFolder(folder.path)}><CodexIcon iconId="trash" className="codex-tree-folder-ic" /></button>
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
      {/* Notes belonging directly to this folder sort ABOVE its subfolders (the owner's preferred order). */}
      {pages.map((page) => (
        <div key={page.id} className="codex-tree-page-row" style={{ paddingInlineStart: `${depth * 14 + 20}px` }}>
          <button
            type="button" role="treeitem" aria-selected={page.id === handlers.selectedId}
            className={`codex-tree-page${page.id === handlers.selectedId ? " is-active" : ""}`}
            draggable
            onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, page.id); event.dataTransfer.effectAllowed = "move"; }}
            onClick={() => handlers.onSelect(page.id)}
          >
            {page.entityType !== "note" && <EntityIcon type={page.entityType} className="codex-tree-icon" />}
            <span className="codex-list-title">{page.title}</span>
            {page.revealedToPlayers && <Badge tone="success">Shown</Badge>}
          </button>
          <button type="button" className="codex-tree-page-move" aria-label={`Move ${page.title}`} title="Move to folder" onClick={() => handlers.onRequestMove(page.id)}>⋯</button>
        </div>
      ))}
      {folders.map((folder) => <FolderBranch key={folder.path} folder={folder} depth={depth} handlers={handlers} />)}
    </div>
  );
}
