import { useMemo } from "react";
import type { ContentCompendiumKind } from "@vtt/domain";
import { Badge, Button, IconButton, IconX, cx } from "@vtt/ui";
import { CodexPhoneBar } from "../../codex/shell/PhoneBar";
import { useCodexShell } from "../../codex/shell/context";
import { HomebrewMarks, useHomebrewMarks } from "../../homebrew/marks";
import { navigate } from "../../router";
import { CompendiumCard, cardName, cardOfEntry } from "../CompendiumCard";
import { CompendiumTable } from "../CompendiumTable";
import { KindIcon, PLAYER_KINDS, columnsOfEntry, type Names } from "../kinds";
import { KIND_SLUG, kindOfSlug, recordPath } from "../routes";
import type { CompendiumRow } from "../tableModel";
import { useReaderCompendium } from "./data";
import "../compendium.css";

const DEFAULT_KIND: ContentCompendiumKind = "spell";
/** The Compendium's place in the Codex: `/codex/compendium?kind=spells`, and a record at `/codex/compendium/<id>`. */
export const CODEX_COMPENDIUM = "/codex/compendium";

const SOURCES = [
  { value: "srd", label: "SRD 5.2.1" },
  { value: "table", label: "This table" }
];
const sourceWord = (row: CompendiumRow) => (row.source === "srd" ? "SRD 5.2.1" : "This table");

/** The kind in view, from the address; a kind a reader's Compendium does not list reads as the default. */
function kindOfQuery(query: URLSearchParams): ContentCompendiumKind {
  const kind = kindOfSlug(query.get("kind") ?? undefined);
  return kind && (PLAYER_KINDS as readonly string[]).includes(kind) ? (kind as ContentCompendiumKind) : DEFAULT_KIND;
}

/** The kind another kind's rows name by id, so a table shows a name: a subclass's class, a background's feat. */
const NAMED_BY: Partial<Record<ContentCompendiumKind, ContentCompendiumKind>> = {
  subclass: "class",
  background: "feat"
};

/**
 * The Compendium in the Codex: the same tables as the GM's, read only, over what this reader receives (the SRD and
 * the homebrew shared with them), with each record's card as the builder, the sheet and the spell list draw it. No
 * monsters: the bestiary stays the GM's. A player reads it over the player routes; the GM reads the GM's catalog, with
 * Hidden marked and a way to the record in the Compendium tab.
 */
function CodexCompendium({ gm }: Readonly<{ gm: boolean }>) {
  const { token, query, setQuery, go, phone, recordId } = useCodexShell();
  const kind = kindOfQuery(query);
  const read = useReaderCompendium(token, kind);
  const named = useReaderCompendium(token, NAMED_BY[kind] ?? null);
  const marks = useHomebrewMarks(gm);

  const rows = useMemo<CompendiumRow[] | null>(() => {
    const entry = read.data;
    if (!entry || entry.kind !== kind) return null;
    return entry.rows.map((row, index) => ({
      id: row.id,
      kind,
      name: row.name,
      source: row.source === "homebrew" ? "homebrew" : "srd",
      packId: null,
      columns: columnsOfEntry(entry, index)
    }));
  }, [read.data, kind]);
  const names = useMemo<Names>(() => {
    const byId = new Map<string, string>();
    for (const row of named.data?.rows ?? []) byId.set(row.id, row.name);
    for (const row of read.data?.rows ?? []) byId.set(row.id, row.name);
    return { list: () => null, record: (id) => byId.get(id) ?? null };
  }, [named.data, read.data]);

  const listPath = (keep: URLSearchParams) => {
    const next = new URLSearchParams(keep);
    next.set("kind", KIND_SLUG[kind]);
    return `${CODEX_COMPENDIUM}?${next.toString()}`;
  };
  const open = (row: CompendiumRow) => go(`${CODEX_COMPENDIUM}/${row.id}?${query.toString()}`);
  const close = () => go(listPath(query));

  const entryIndex = recordId && read.data ? read.data.rows.findIndex((row) => row.id === recordId) : -1;
  const card =
    entryIndex >= 0 && read.data
      ? cardOfEntry({ ...read.data, rows: [read.data.rows[entryIndex]] } as typeof read.data)
      : null;
  const row = entryIndex >= 0 ? rows?.[entryIndex] : undefined;

  const table = (
    <CompendiumTable
      kind={kind}
      kinds={PLAYER_KINDS}
      allowAll={false}
      rows={rows}
      error={read.error}
      onRetry={read.reload}
      names={names}
      sources={SOURCES}
      gm={false}
      party={[]}
      phone={phone}
      compact={!!card && !phone}
      selectedId={recordId}
      query={query}
      setQuery={setQuery}
      onKind={(next, kept) => {
        kept.set("kind", KIND_SLUG[next ?? DEFAULT_KIND]);
        go(`${CODEX_COMPENDIUM}?${kept.toString()}`);
      }}
      onOpen={open}
      mark={(entry) => <HomebrewMarks source={entry.source} mark={gm ? marks.get(entry.id) : undefined} />}
      sourceWord={sourceWord}
      emptyText={gm ? "Nothing of this kind is in the table." : "Nothing of this kind has been shared with you yet."}
    />
  );

  const recordPanel =
    card && row ? (
      <article className={cx("cp-record", phone ? "is-phone" : "is-dock")} aria-label={cardName(card)}>
        {phone ? (
          <CodexPhoneBar title={cardName(card)} onBack={close} />
        ) : (
          <header className="cp-rec-head">
            <div className="cp-rec-titlerow">
              <KindIcon kind={kind} />
              <h2 className="cp-rec-title">{cardName(card)}</h2>
              {row.source === "homebrew" ? (
                <HomebrewMarks source="homebrew" mark={gm ? marks.get(row.id) : undefined} />
              ) : (
                <Badge tone="info">SRD 5.2.1</Badge>
              )}
              <span className="cp-grow" />
              <IconButton label={`Close ${cardName(card)}`} size="sm" onClick={close}>
                <IconX />
              </IconButton>
            </div>
          </header>
        )}
        <div className="cp-rec-body scroll-y">
          <CompendiumCard card={card} names={names} />
          {gm && (
            <div className="cp-actions-row">
              <Button size="sm" onClick={() => void navigate(recordPath(kind, row.id))}>
                Open in the Compendium tab
              </Button>
            </div>
          )}
        </div>
      </article>
    ) : null;

  if (phone) return recordPanel ?? <div className="cp-codex is-phone">{table}</div>;
  return (
    <div className={cx("cp-codex cp-recordlayout", recordPanel ? "is-docked" : "is-full")}>
      <div className="cp-dock-table">{table}</div>
      {recordPanel}
    </div>
  );
}

export function PlayerCompendiumSection() {
  return <CodexCompendium gm={false} />;
}

export function GmCompendiumSection() {
  return <CodexCompendium gm />;
}
