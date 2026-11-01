import { useContext, useMemo, useState } from "react";
import {
  Alert,
  Button,
  IconFolder,
  IconMore,
  IconPlus,
  IconSort,
  Input,
  Menu,
  MenuItem,
  SideListGroup,
  SideListRow,
  Tag,
  cx,
  FindField
} from "@vtt/ui";
import type { CodexEntityType } from "@vtt/domain";
import { useConfirm } from "../../components/feedback";
import { codexApi } from "../api";
import { entityDef } from "../entities";
import { CodexIcon, EntityIcon } from "../icons";
import { pagePath } from "../routes";
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
  updatedAt?: string;
  playerUpdatedAt?: string | null;
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

/** A kind's word for a count in plain words: "4 people", "1 place". */
const COUNT_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  people: ["person", "people"],
  places: ["place", "places"],
  factions: ["faction", "factions"],
  things: ["thing", "things"],
  lore: ["lore page", "lore pages"]
};
const countWords = (count: number, groupId: string | null) => {
  const [one, many] = (groupId && COUNT_WORDS[groupId]) || ["page", "pages"];
  return `${count} ${count === 1 ? one : many}`;
};

/**
 * Pages (F finding spec 2.2): the kinds, the GM's folders and the tags at the side, the chosen group's pages at the
 * right under a toolbar (find, the count in plain words, the order, New page). The chosen kind, folder or tag is the
 * address (`?group=`, `?folder=`, `?tag=`), so a page and Back return to it. A player's index has the kinds and tags
 * with plain counts and no folders or Hidden marks.
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
  const tag = query.get("tag");
  const byName = query.get("sort") === "name";
  const [renaming, setRenaming] = useState<Readonly<{ from: string; to: string }> | null>(null);
  const [filter, setFilterText] = useState("");
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const group = KIND_GROUPS.find((candidate) => candidate.id === groupId) ?? null;
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) for (const name of row.tags) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);
  const needle = filter.trim().toLowerCase();
  const changed = (row: Row) => row.updatedAt ?? row.playerUpdatedAt ?? "";
  const listed = rows
    .filter((row) => (group ? group.types.includes(row.entityType) : true))
    .filter((row) => (folder ? row.folder === folder || row.folder?.startsWith(`${folder}/`) : true))
    .filter((row) => (tag ? row.tags.includes(tag) : true))
    .filter((row) => !needle || row.title.toLowerCase().includes(needle))
    .slice()
    .sort((a, b) =>
      byName
        ? a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
        : changed(b).localeCompare(changed(a)) || a.title.localeCompare(b.title)
    );
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
      title: `Delete the folder ${path}?`,
      body: `Its ${count} ${count === 1 ? "page stays" : "pages stay"} in the Codex, unfiled.`,
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

  // One group at a time: a kind, a folder or a tag.
  const chooseGroup = (id: string | null) => setFilter({ group: id, folder: null, tag: null });
  const chooseFolder = (path: string | null) => setFilter({ folder: path, group: null, tag: null });
  const chooseTag = (name: string | null) => setFilter({ tag: name, group: null, folder: null });
  const countOf = (candidate: (typeof KIND_GROUPS)[number]) =>
    rows.filter((row) => candidate.types.includes(row.entityType)).length;
  const newPage = gm ? (
    <Button size="sm" onClick={() => gm.quickCreate({ entityType: group?.types[0], ...(folder ? { folder } : {}) })}>
      <IconPlus /> New page
    </Button>
  ) : null;

  const kindList = phone ? (
    <div className="nh-filterchips" role="group" aria-label="Kinds">
      {[{ id: null, label: "All pages" }, ...KIND_GROUPS].map((candidate) => (
        <button
          key={candidate.id ?? "all"}
          type="button"
          className={cx("nh-filterchip", "interactive", groupId === candidate.id && !folder && !tag && "is-on")}
          aria-pressed={groupId === candidate.id && !folder && !tag}
          onClick={() => chooseGroup(candidate.id)}
        >
          {candidate.label}
        </button>
      ))}
    </div>
  ) : (
    <SideListGroup eyebrow="Kinds">
      <SideListRow
        label="All pages"
        count={rows.length}
        current={!group && !folder && !tag}
        onSelect={() => chooseGroup(null)}
      />
      {KIND_GROUPS.map((candidate) => (
        <SideListRow
          key={candidate.id}
          label={candidate.label}
          leading={<CodexIcon iconId={candidate.iconId} />}
          count={countOf(candidate)}
          current={group?.id === candidate.id}
          onSelect={() => chooseGroup(candidate.id)}
        />
      ))}
    </SideListGroup>
  );

  const tagList =
    tags.length === 0 ? null : (
      <div className="cx-index-tags" role="group" aria-label="Tags">
        {!phone && (
          <p className="nh-sidelist-eyebrow" aria-hidden="true">
            Tags
          </p>
        )}
        <ul className="cx-index-tagchips">
          {tags.map(([name, count]) => (
            <li key={name}>
              <button
                type="button"
                className={cx("cx-tag cx-tag-count interactive", tag === name && "is-on")}
                aria-pressed={tag === name}
                onClick={() => chooseTag(tag === name ? null : name)}
              >
                #{name} <span className="cx-tag-n">{count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  const folderList = gm && (
    <section className="cx-index-folders" aria-label="Folders">
      <SideListGroup eyebrow="Folders · only you">
        {folders.map(([path, count]) => {
          const depth = path.split("/").length - 1;
          return renaming?.from === path ? (
            <li key={path} className="nh-sidelist-row">
              <form
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
            </li>
          ) : (
            // A tree by indent (theme rule 13): the folder's own name, 16px a level, its full path as its name.
            <SideListRow
              key={path}
              className="cx-folderrow"
              leading={<IconFolder />}
              label={path.slice(path.lastIndexOf("/") + 1)}
              ariaLabel={path}
              depth={depth}
              count={count}
              current={folder === path}
              onSelect={() => chooseFolder(folder === path ? null : path)}
              end={
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
              }
            />
          );
        })}
      </SideListGroup>
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
    </section>
  );

  const pageList =
    loading && rows.length === 0 ? (
      <p className="cx-hint">Loading the pages.</p>
    ) : listed.length === 0 ? (
      <p className="cx-hint">{needle ? "No page has that name." : "No pages here yet."}</p>
    ) : (
      <ul className="cx-pagelist" aria-label={group ? group.label : tag ? `#${tag}` : (folder ?? "Every page")}>
        {listed.map((row) => {
          const hidden = gm && row.revealedToPlayers === false;
          return (
            <li key={row.id}>
              <button
                type="button"
                className="cx-pagerow"
                data-record-key={row.id}
                onClick={() => go(pagePath(row.id))}
              >
                <EntityIcon type={row.entityType} />
                <span className="cx-pagerow-text">
                  <span className={cx("cx-pagerow-title", hidden && "is-hidden")}>{row.title}</span>
                  <span className="cx-pagerow-sub">{row.fields?.role?.trim() || entityDef(row.entityType).label}</span>
                </span>
                {!phone && row.tags.length > 0 && (
                  <span className="cx-pagerow-tags">
                    {row.tags.slice(0, 3).map((name) => (
                      <span key={name} className="cx-pagerow-tag">
                        #{name}
                      </span>
                    ))}
                  </span>
                )}
                {hidden && <Tag tone="hidden">Hidden</Tag>}
              </button>
            </li>
          );
        })}
      </ul>
    );

  const toolbar = (
    <div className="cx-index-toolbar">
      <FindField
        aria-label="Find a page by name"
        placeholder="Find a page by name"
        value={filter}
        onChange={(event) => setFilterText(event.target.value)}
      />
      <span className="cx-index-count" role="status">
        {countWords(listed.length, group?.id ?? null)}
      </span>
      <Button
        size="sm"
        variant="ghost"
        aria-label={byName ? "Order: by name. Order by when it changed" : "Order: changed. Order by name"}
        onClick={() => setFilter({ sort: byName ? null : "name" })}
      >
        <IconSort /> {byName ? "Name" : "Changed"}
      </Button>
      {!phone && newPage}
    </div>
  );

  return (
    <div className={cx("cx-index", phone ? "scroll-y" : "cx-index-split")}>
      <CodexPhoneBar
        title="Codex"
        back={group ? { label: group.label, onClick: () => chooseGroup(null) } : undefined}
        actions={phone ? (newPage ?? undefined) : undefined}
      />
      {phone ? (
        <div className="cx-index-body">
          {kindList}
          {tagList}
          {toolbar}
          {error && <Alert tone="danger">{error}</Alert>}
          {pageList}
          {folderList}
        </div>
      ) : (
        <>
          <nav className="cx-index-side scroll-y" aria-label="Narrow the pages">
            {kindList}
            {folderList}
            {tagList}
          </nav>
          <div className="cx-index-main">
            {toolbar}
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="cx-index-rows scroll-y">{pageList}</div>
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}
