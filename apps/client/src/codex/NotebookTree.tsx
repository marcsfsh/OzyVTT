import { useState } from "react";
import { IconChevron, IconDrag, IconPencil, Menu, MenuItem, VisibilityBadge } from "@vtt/ui";
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
const FOLDER_DRAG_TYPE = "application/x-codex-folder";
// The folder path being dragged this gesture. `getData` is unavailable during dragOver, so we need this to
// reject dropping a folder onto itself or its own descendant before the drop fires.
let draggedFolderPath: string | null = null;
/** A folder can't be dropped onto itself or into one of its own descendants. */
const invalidFolderDrop = (target: string, dragged: string | null) => dragged !== null && (target === dragged || target.startsWith(`${dragged}/`));

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
  onMoveFolder: (fromPath: string, toParentPath: string | null) => void;
  onRequestMove: (pageId: string) => void;
  /**
   * Intake Mobile #5: a folder could only be MOVED by dragging it, which is unreachable with a thumb.
   * This is the keyboard-and-touch route — the same "Move to folder" modal a page's row menu opens.
   */
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
function FolderBranch({ folder, depth, handlers }: Readonly<{ folder: FolderNode; depth: number; handlers: Handlers }>) {
  const [over, setOver] = useState(false);
  const open = !handlers.collapsed.has(folder.path);
  return (
    <div className="codex-tree-branch" role="treeitem" aria-expanded={open}>
      <div
        className={`codex-tree-folder-row${over ? " is-drop" : ""}`}
        style={{ paddingInlineStart: `${depth * 14 + 6}px` }}
        onDragOver={(event) => {
          const types = event.dataTransfer.types;
          if (types.includes(FOLDER_DRAG_TYPE)) { if (!invalidFolderDrop(folder.path, draggedFolderPath)) { event.preventDefault(); setOver(true); } return; }
          if (types.includes(DRAG_TYPE)) { event.preventDefault(); setOver(true); }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault(); event.stopPropagation(); setOver(false);
          const from = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
          if (from) { if (!invalidFolderDrop(folder.path, from)) handlers.onMoveFolder(from, folder.path); return; }
          const id = event.dataTransfer.getData(DRAG_TYPE);
          if (id) handlers.onMovePage(id, folder.path);
        }}
      >
        <button type="button" className="codex-tree-folder" draggable
          onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.path); event.dataTransfer.effectAllowed = "move"; draggedFolderPath = folder.path; }}
          onDragEnd={() => { draggedFolderPath = null; }}
          onClick={() => handlers.onToggle(folder.path)}>
          <IconChevron className={`codex-tree-caret${open ? " is-open" : ""}`} />
          <span className="codex-tree-folder-name">{folder.name}</span>
          <span className="codex-tree-count">{countPages(folder)}</span>
        </button>
        {/*
          §4 touch floor. Four 13-15px icon buttons used to sit here and NEITHER §4 route could reach 44px:
          route 2 centres a 44px box on ~15px of paint (a 14.5px overhang per side) on buttons gapped by ~8px,
          so each would silently steal its neighbour's taps - the precise failure the gap budget exists to
          prevent; route 1 needs 4x44 = 176px of actions inside a row measured at 223px on a ~343px rail,
          leaving the folder name ~47px. So the fix is not CSS: four controls do not belong on a tree row.
          They collapse into ONE `Menu`, the same single-dots shape `.codex-tree-page-move` already gives a
          note row, and the primitive carries the floor itself (`.nh-menu-trigger--icon` is §4 route 2 on 28px
          of paint; `.nh-menu-item` is route 1). Gap budget for the 8px-per-side trigger overhang is paid by
          `.codex-tree-folder-actions`' margin in codex.css.
        */}
        <div className="codex-tree-folder-actions">
          <Menu trigger={<IconDrag />} icon align="end" label={`Actions for ${folder.name}`} className="codex-tree-folder-menu">
            <MenuItem icon={<CodexIcon iconId="folder-plus" className="codex-tree-folder-ic" />} onClick={() => handlers.onNewSubfolder(folder.path)}>New subfolder</MenuItem>
            <MenuItem icon={<CodexIcon iconId="scroll" className="codex-tree-folder-ic" />} onClick={() => handlers.onNewInFolder(folder.path)}>New page here</MenuItem>
            <MenuItem icon={<IconPencil />} onClick={() => handlers.onRenameFolder(folder.path)}>Rename folder</MenuItem>
            <MenuItem icon={<CodexIcon iconId="folder-plus" className="codex-tree-folder-ic" />} onClick={() => handlers.onRequestMoveFolder(folder.path)}>Move to top level</MenuItem>
            <MenuItem icon={<CodexIcon iconId="trash" className="codex-tree-folder-ic" />} tone="danger" onClick={() => handlers.onDeleteFolder(folder.path)}>Delete folder</MenuItem>
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
  // The top-level container is the drop target for "move to the top level" (clear a page's folder).
  const rootDrop = depth === 0
    ? {
        onDragOver: (event: React.DragEvent) => { const types = event.dataTransfer.types; if (types.includes(DRAG_TYPE) || types.includes(FOLDER_DRAG_TYPE)) event.preventDefault(); },
        onDrop: (event: React.DragEvent) => {
          const from = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
          if (from) { handlers.onMoveFolder(from, null); return; }
          const id = event.dataTransfer.getData(DRAG_TYPE);
          if (id) handlers.onMovePage(id, null);
        }
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
          </button>
          {/* RULING 58 — ONE REVEAL LANGUAGE EVERYWHERE, and it is a SAFETY property rather than
              tidiness: reveal is the control where a GM misreading the state leaks something to the
              table, so the mark is the same glyph in the same place every time they meet it. That
              means the VALUE is passed, never gated on — a row with no mark is UNREADABLE, because
              "hidden from players" and "no reveal state at all" then look identical. This used to
              render only when `revealedToPlayers` was true, on the argument that a mark on every row
              of a dense tree is noise; measured on this tree it left 1 row in 7 carrying nothing.
              Density is a styling question, not a rendering one. Every other call site already
              passes the value — `PagesView.tsx`, `QuestsView.tsx`, `SessionsView.tsx`,
              `SessionConsole.tsx` — and `VisibilityBadge` renders both states, the off one being the
              struck-through eye with its own accessible name.

              IT IS A SIBLING OF THE ROW'S CONTROL, NOT A CHILD OF IT, and that is the a11y half of
              the same ruling: `Reveal.tsx` builds this as a STATUS ("deliberately not a switch and
              not focusable"), and a status nested inside a button becomes part of that button's
              accessible NAME. Rendered inside, the tree item stopped being called "Barovia" and
              started being called "Barovia Hidden from players" — the page's name and its reveal
              state fused into one string. Outside, the item keeps its title and the mark keeps its
              own name. Visually unchanged: `.codex-tree-page` takes `flex: 1`, so the mark sits at
              the row's trailing edge either way. */}
          <VisibilityBadge revealed={page.revealedToPlayers} />
          <button type="button" className="codex-tree-page-move tap-target" aria-label={`Move ${page.title}`} title="Move to folder" onClick={() => handlers.onRequestMove(page.id)}><IconDrag /></button>
        </div>
      ))}
      {folders.map((folder) => <FolderBranch key={folder.path} folder={folder} depth={depth} handlers={handlers} />)}
    </div>
  );
}
