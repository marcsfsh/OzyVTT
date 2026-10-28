import { useContext, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Eyebrow,
  IconChevronRight,
  IconEyeOff,
  IconMore,
  IconPlus,
  Input,
  Menu,
  MenuItem,
  cx
} from "@vtt/ui";
import type { CodexEntityType } from "@vtt/domain";
import { useConfirm } from "../../components/feedback";
import { codexApi } from "../api";
import { entityDef } from "../entities";
import { CodexIcon, EntityIcon } from "../icons";
import { pagePath, searchPath, tagPath } from "../routes";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { useCodexShell, useOptionalGmCodex, PlayerCodexContext } from "../shell/context";
import { KIND_GROUPS } from "./document";

type Row = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  tags: readonly string[];
  revealedToPlayers?: boolean;
  folder?: string | null;
  fields?: Readonly<Record<string, string>>;
}>;

/** "8 revealed · 2 hidden", with the hidden part a link to Search filtered to Hidden. */
export function RevealedCount({
  revealed,
  hidden,
  onHidden
}: Readonly<{ revealed: number; hidden: number; onHidden?: () => void }>) {
  return (
    <span className="cx-count">
      <b>{revealed}</b> revealed
      {hidden > 0 && (
        <>
          {" · "}
          {onHidden ? (
            <button type="button" className="cx-count-hidden" onClick={onHidden}>
              {hidden} hidden
            </button>
          ) : (
            <span className="cx-count-hidden">{hidden} hidden</span>
          )}
        </>
      )}
    </span>
  );
}

/**
 * Pages: the kind groups with their counts, the tags, and a group's pages. A phone's Pages tab, and the place a
 * page's crumbs lead. The GM's counts say how many are revealed and how many are Hidden, and the GM gets the
 * folders their pages are filed in.
 */
export function PagesIndex() {
  const { go, query, setFilter, phone, token } = useCodexShell();
  const gm = useOptionalGmCodex();
  const player = useContext(PlayerCodexContext);
  const gmPages = gm?.feeds.pages;
  const playerPages = player?.feeds.pages;
  const rows: readonly Row[] = useMemo(() => gmPages ?? playerPages ?? [], [gmPages, playerPages]);
  const loading = gm ? gm.feeds.list.loading : (player?.feeds.loading ?? false);
  const groupId = query.get("group");
  const folder = gm ? query.get("folder") : null;
  const [renaming, setRenaming] = useState<Readonly<{ from: string; to: string }> | null>(null);
  const [filter, setFilterText] = useState("");
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const group = KIND_GROUPS.find((candidate) => candidate.id === groupId) ?? null;
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  }, [rows]);
  const needle = filter.trim().toLowerCase();
  const listed = rows
    .filter((row) => (group ? group.types.includes(row.entityType) : true))
    .filter((row) => (folder ? row.folder === folder || row.folder?.startsWith(`${folder}/`) : true))
    .filter((row) => !needle || row.title.toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  const savedFolders = gm?.feeds.folders;
  const folders = useMemo(() => {
    // An empty folder the GM made still lists, at a count of none.
    const counts = new Map<string, number>((savedFolders ?? []).map((path) => [path, 0]));
    for (const row of rows) if (row.folder) counts.set(row.folder, (counts.get(row.folder) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, savedFolders]);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const createFolder = async (name: string) => {
    setNewFolder(null);
    if (!name.trim() || !gm) return;
    try {
      await codexApi.createFolder(token, name.trim());
      void gm.feeds.list.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't make that folder.");
    }
  };

  const renameFolder = async (from: string, to: string) => {
    setRenaming(null);
    if (!to.trim() || to.trim() === from || !gm) return;
    try {
      await codexApi.moveFolder(token, from, to.trim());
      if (folder === from) setFilter({ folder: to.trim() });
      void gm.feeds.list.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't rename that folder.");
    }
  };
  const deleteFolder = async (path: string, count: number) => {
    if (!gm) return;
    const ok = await confirm({
      title: "Delete folder",
      body: `Delete the folder ${path}? Its ${count} ${count === 1 ? "page stays" : "pages stay"} in the Codex, unfiled.`,
      confirmLabel: "Delete folder",
      danger: true
    });
    if (!ok) return;
    try {
      await codexApi.deleteFolder(token, path);
      void gm.feeds.list.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't delete that folder.");
    }
  };

  const groupRow = (candidate: (typeof KIND_GROUPS)[number]) => {
    const inGroup = rows.filter((row) => candidate.types.includes(row.entityType));
    const revealed = gm ? inGroup.filter((row) => row.revealedToPlayers).length : inGroup.length;
    return (
      <button
        key={candidate.id}
        type="button"
        className={cx("cx-grouprow", group?.id === candidate.id && "is-on")}
        aria-current={group?.id === candidate.id ? "true" : undefined}
        onClick={() => setFilter({ group: group?.id === candidate.id ? null : candidate.id })}
      >
        <CodexIcon iconId={candidate.iconId} className="cx-grouprow-icon" />
        <span className="cx-grouprow-text">
          <span className="cx-grouprow-title">{candidate.label}</span>
          {gm && <RevealedCount revealed={revealed} hidden={inGroup.length - revealed} />}
        </span>
        {!gm && <span className="cx-grouprow-count">{inGroup.length}</span>}
        <IconChevronRight className="cx-grouprow-chev" />
      </button>
    );
  };

  return (
    <div className="cx-index scroll-y">
      <CodexPhoneBar
        title={group ? group.label : "Pages"}
        onBack={group ? () => setFilter({ group: null }) : undefined}
        actions={
          gm ? (
            <Button size="sm" onClick={() => gm.quickCreate({ entityType: group?.types[0] })}>
              <IconPlus /> New page
            </Button>
          ) : undefined
        }
      />
      <div className="cx-index-body">
        {!phone && (
          <div className="cx-index-head">
            <h1 className="cx-page-title">{group ? group.label : "Pages"}</h1>
            {gm && (
              <Button size="sm" onClick={() => gm.quickCreate({ entityType: group?.types[0] })}>
                <IconPlus /> New page
              </Button>
            )}
          </div>
        )}
        <Input
          type="search"
          aria-label="Find a page by name"
          placeholder="Find a page by name"
          value={filter}
          onChange={(event) => setFilterText(event.target.value)}
        />
        {tags.length > 0 && (
          <ul className="cx-meta-chips" aria-label="Tags">
            {tags.map(([tag]) => (
              <li key={tag}>
                <button type="button" className="cx-tag interactive" onClick={() => go(tagPath(tag))}>
                  #{tag}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="cx-index-groups">{KIND_GROUPS.map(groupRow)}</div>
        <div className="cx-index-listhead">
          <Eyebrow>{group ? group.label : "Every page"}</Eyebrow>
          {folder && (
            <Button size="sm" variant="ghost" onClick={() => setFilter({ folder: null })}>
              Every folder
            </Button>
          )}
        </div>
        {loading && rows.length === 0 ? (
          <p className="cx-hint">Loading the pages.</p>
        ) : listed.length === 0 ? (
          <p className="cx-hint">{needle ? "No page has that name." : "No pages here yet."}</p>
        ) : (
          <ul className="cx-pagelist">
            {listed.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="cx-pagerow"
                  data-record-key={row.id}
                  onClick={() => go(pagePath(row.id))}
                >
                  <EntityIcon type={row.entityType} />
                  <span className="cx-pagerow-text">
                    <span className="cx-pagerow-title">{row.title}</span>
                    <span className="cx-pagerow-sub">
                      {row.fields?.role?.trim() || entityDef(row.entityType).label}
                    </span>
                  </span>
                  {gm && row.revealedToPlayers === false && (
                    <span className="cx-meta-hidden">
                      <IconEyeOff />
                      Hidden
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {gm && (
          <Button size="sm" variant="ghost" onClick={() => go(searchPath({}))}>
            Search with filters and sorting
          </Button>
        )}
        {gm && (
          <section className="cx-index-folders" aria-label="Folders">
            <Eyebrow>Folders</Eyebrow>
            <p className="cx-hint">Your own filing. Players never see it.</p>
            {newFolder === null ? (
              <Button size="sm" variant="ghost" onClick={() => setNewFolder("")}>
                <IconPlus /> New folder
              </Button>
            ) : (
              <form
                className="cx-folderrow"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createFolder(newFolder);
                }}
              >
                <Input
                  aria-label="New folder name"
                  value={newFolder}
                  autoFocus
                  onChange={(event) => setNewFolder(event.target.value)}
                />
                <Button size="sm" type="submit" disabled={!newFolder.trim()}>
                  Make folder
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNewFolder(null)}>
                  Cancel
                </Button>
              </form>
            )}
            {folders.map(([path, count]) =>
              renaming?.from === path ? (
                <form
                  key={path}
                  className="cx-folderrow"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void renameFolder(path, renaming.to);
                  }}
                >
                  <Input
                    aria-label={`New name for ${path}`}
                    value={renaming.to}
                    autoFocus
                    onChange={(event) => setRenaming({ from: path, to: event.target.value })}
                  />
                  <Button size="sm" type="submit">
                    Rename
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <div key={path} className={cx("cx-folderrow", folder === path && "is-on")}>
                  <button
                    type="button"
                    className="cx-folderrow-name"
                    aria-pressed={folder === path}
                    onClick={() => setFilter({ folder: folder === path ? null : path })}
                  >
                    {path}
                  </button>
                  <span className="cx-grouprow-count">{count}</span>
                  <Menu icon align="end" label={`Actions for ${path}`} trigger={<IconMore />}>
                    <MenuItem onClick={() => gm?.quickCreate({ folder: path })}>New page here</MenuItem>
                    <MenuItem onClick={() => setNewFolder(`${path}/`)}>New subfolder</MenuItem>
                    <MenuItem onClick={() => setRenaming({ from: path, to: path })}>Rename folder</MenuItem>
                    {path.includes("/") && (
                      <MenuItem onClick={() => void renameFolder(path, path.slice(path.lastIndexOf("/") + 1))}>
                        Move to top level
                      </MenuItem>
                    )}
                    <MenuItem tone="danger" onClick={() => void deleteFolder(path, count)}>
                      Delete folder
                    </MenuItem>
                  </Menu>
                </div>
              )
            )}
          </section>
        )}
      </div>
      {dialog}
    </div>
  );
}
