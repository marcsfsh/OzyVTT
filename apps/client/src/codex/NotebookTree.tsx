import { useState } from "react";
import { IconChevron, IconDrag, IconPencil, Menu, MenuItem, VisibilityBadge } from "@vtt/ui";
import type { CodexPageSummary } from "@vtt/domain";
import { CodexIcon, EntityIcon } from "./icons";

/**
 * The notebook tree: pages grouped into nested folders ("NPCs/Villains"). Folders are the union of page
 * folder paths and explicit folder records, so an empty folder persists. Pages sort above subfolders.
 * Reorganize by drag-and-drop (desktop) or the move action (touch).
 */
export type FolderNode = { name: string; path: string; folders: Map<string, FolderNode>; pages: CodexPageSummary[] };
export type NotebookSort = "name-asc" | "name-desc" | "recent";
const DRAG_TYPE = "application/x-codex-page";
const FOLDER_DRAG_TYPE = "application/x-codex-folder";
// The folder being dragged. `getData` is unavailable during dragOver, and this is needed there to reject
// dropping a folder onto itself or a descendant.
let draggedFolderPath: string | null = null;
/** A folder can't be dropped onto itself or into one of its own descendants. */
const invalidFolderDrop = (target: string, dragged: string | null) =>
  dragged !== null && (target === dragged || target.startsWith(`${dragged}/`));

/** Walk/create the folder-node chain for a "A/B/C" path, returning the leaf node. */
function ensureFolder(root: FolderNode, folderPath: string): FolderNode {
  let node = root;
  let path = "";
  for (const segment of folderPath
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)) {
    path = path ? `${path}/${segment}` : segment;
    let child = node.folders.get(segment);
    if (!child) {
      child = { name: segment, path, folders: new Map(), pages: [] };
      node.folders.set(segment, child);
    }
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
  onMoveFolder: (fromPath: string, toParentPath: string | null) => void;
  onRequestMove: (pageId: string) => void;
  /** The touch and keyboard way to move a folder, via the same modal a page's row menu opens. */
  onRequestMoveFolder: (path: string) => void;
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

/** A folder branch: draggable (moves the folder + everything under it) and a drop target for pages and folders. */
function FolderBranch({
  folder,
  depth,
  handlers
}: Readonly<{ folder: FolderNode; depth: number; handlers: Handlers }>) {
  const [over, setOver] = useState(false);
  const open = !handlers.collapsed.has(folder.path);
  return (
    <div className="codex-tree-branch" role="treeitem" aria-expanded={open}>
      <div
        className={`codex-tree-folder-row${over ? " is-drop" : ""}`}
        style={{ paddingInlineStart: `${depth * 14 + 6}px` }}
        onDragOver={(event) => {
          const types = event.dataTransfer.types;
          if (types.includes(FOLDER_DRAG_TYPE)) {
            if (!invalidFolderDrop(folder.path, draggedFolderPath)) {
              event.preventDefault();
              setOver(true);
            }
            return;
          }
          if (types.includes(DRAG_TYPE)) {
            event.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOver(false);
          const from = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
          if (from) {
            if (!invalidFolderDrop(folder.path, from)) handlers.onMoveFolder(from, folder.path);
            return;
          }
          const id = event.dataTransfer.getData(DRAG_TYPE);
          if (id) handlers.onMovePage(id, folder.path);
        }}
      >
        <button
          type="button"
          className="codex-tree-folder"
          draggable
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.path);
            event.dataTransfer.effectAllowed = "move";
            draggedFolderPath = folder.path;
          }}
          onDragEnd={() => {
            draggedFolderPath = null;
          }}
          onClick={() => handlers.onToggle(folder.path)}
        >
          <IconChevron className={`codex-tree-caret${open ? " is-open" : ""}`} />
          <span className="codex-tree-folder-name">{folder.name}</span>
          <span className="codex-tree-count">{countPages(folder)}</span>
        </button>
        {/*
          One `Menu` instead of four small icon buttons: their ::after hit areas would overlap each other,
          and 4x44px won't fit the row. The trigger's overhang is covered by `.codex-tree-folder-actions`' margin.
        */}
        <div className="codex-tree-folder-actions">
          <Menu
            trigger={<IconDrag />}
            icon
            align="end"
            label={`Actions for ${folder.name}`}
            className="codex-tree-folder-menu"
          >
            <MenuItem
              icon={<CodexIcon iconId="folder-plus" className="codex-tree-folder-ic" />}
              onClick={() => handlers.onNewSubfolder(folder.path)}
            >
              New subfolder
            </MenuItem>
            <MenuItem
              icon={<CodexIcon iconId="scroll" className="codex-tree-folder-ic" />}
              onClick={() => handlers.onNewInFolder(folder.path)}
            >
              New page here
            </MenuItem>
            <MenuItem icon={<IconPencil />} onClick={() => handlers.onRenameFolder(folder.path)}>
              Rename folder
            </MenuItem>
            <MenuItem
              icon={<CodexIcon iconId="folder-plus" className="codex-tree-folder-ic" />}
              onClick={() => handlers.onRequestMoveFolder(folder.path)}
            >
              Move to top level
            </MenuItem>
            <MenuItem
              icon={<CodexIcon iconId="trash" className="codex-tree-folder-ic" />}
              tone="danger"
              onClick={() => handlers.onDeleteFolder(folder.path)}
            >
              Delete folder
            </MenuItem>
          </Menu>
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
  // The top-level container is the drop target for moving a page to the top level.
  const rootDrop =
    depth === 0
      ? {
          onDragOver: (event: React.DragEvent) => {
            const types = event.dataTransfer.types;
            if (types.includes(DRAG_TYPE) || types.includes(FOLDER_DRAG_TYPE)) event.preventDefault();
          },
          onDrop: (event: React.DragEvent) => {
            const from = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
            if (from) {
              handlers.onMoveFolder(from, null);
              return;
            }
            const id = event.dataTransfer.getData(DRAG_TYPE);
            if (id) handlers.onMovePage(id, null);
          }
        }
      : {};
  return (
    <div className="codex-tree" role={depth === 0 ? "tree" : "group"} {...rootDrop}>
      {/* Pages sort above subfolders. */}
      {pages.map((page) => (
        <div key={page.id} className="codex-tree-page-row" style={{ paddingInlineStart: `${depth * 14 + 20}px` }}>
          <button
            type="button"
            role="treeitem"
            aria-selected={page.id === handlers.selectedId}
            className={`codex-tree-page${page.id === handlers.selectedId ? " is-active" : ""}`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_TYPE, page.id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => handlers.onSelect(page.id)}
          >
            {page.entityType !== "note" && <EntityIcon type={page.entityType} className="codex-tree-icon" />}
            <span className="codex-list-title">{page.title}</span>
          </button>
          {/* Always rendered, with the value passed: a row with no mark can't be told from a hidden one.
              A sibling of the row's button, not a child, so it doesn't become part of the button's
              accessible name. */}
          <VisibilityBadge revealed={page.revealedToPlayers} />
          <button
            type="button"
            className="codex-tree-page-move tap-target"
            aria-label={`Move ${page.title}`}
            title="Move to folder"
            onClick={() => handlers.onRequestMove(page.id)}
          >
            <IconDrag />
          </button>
        </div>
      ))}
      {folders.map((folder) => (
        <FolderBranch key={folder.path} folder={folder} depth={depth} handlers={handlers} />
      ))}
    </div>
  );
}
