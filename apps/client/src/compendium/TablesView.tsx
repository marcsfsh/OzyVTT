import { useMemo } from "react";
import type { HomebrewPackInfo, HomebrewTableRow } from "../homebrew/api";
import { CompendiumTable } from "./CompendiumTable";
import { useCompendium } from "./context";
import { usePacks, useTable } from "./data";
import { KINDS, type Kind, type Names } from "./kinds";
import { PhoneHead, SourceMark, sourceWord } from "./pieces";
import { recordPath, tablePath, withTableQuery } from "./routes";
import type { CompendiumRow } from "./tableModel";

/** A GM table row as the shared row shape. */
export const rowOf = (row: HomebrewTableRow): CompendiumRow => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  source: row.source,
  packId: row.packId,
  state: row.state,
  archived: row.archived,
  pendingChanges: row.pendingChanges,
  issueCount: row.issueCount,
  audience: row.audience,
  characterIds: row.characterIds,
  updatedAt: row.updatedAt,
  columns: row.columns
});

/** The names a table needs and cannot hold, read from every table: a list's, a class's and a feat's. */
export function useNames(token: string): Names {
  const all = useTable(token, null);
  return useMemo(() => {
    const byId = new Map((all.data ?? []).map((row) => [row.id, row.name]));
    return { list: (id) => byId.get(id) ?? null, record: (id) => byId.get(id) ?? null };
  }, [all.data]);
}

/** The sources a table filters on: the SRD, this table and each imported pack. */
export function sourceOptions(packs: readonly HomebrewPackInfo[]) {
  return [
    { value: "srd", label: "SRD 5.2.1" },
    ...packs.map((pack) => ({ value: pack.id, label: pack.kind === "table" ? "This table" : (pack.name ?? "A pack") }))
  ];
}

/** The GM's table of one kind, or of every kind: the SRD, this table's homebrew and each pack's, with their state. */
export function TablesView({
  kind,
  compact = false,
  selectedId = null,
  inFlyout = false
}: Readonly<{ kind: Kind | null; compact?: boolean; selectedId?: string | null; inFlyout?: boolean }>) {
  const { token, party, phone, query, go, setQuery } = useCompendium();
  const table = useTable(token, kind);
  const packs = usePacks(token).data?.packs ?? [];
  const names = useNames(token);
  const rows = useMemo(() => (table.data ? table.data.map(rowOf) : null), [table.data]);
  return (
    <CompendiumTable
      kind={kind}
      kinds={KINDS}
      allowAll
      rows={rows}
      error={table.unavailable ? "This server has no homebrew library yet." : table.error}
      onRetry={() => void table.reload()}
      names={names}
      sources={sourceOptions(packs)}
      gm
      party={party}
      phone={phone}
      compact={compact}
      inFlyout={inFlyout}
      selectedId={selectedId}
      query={query}
      setQuery={setQuery}
      onKind={(next, kept) => go(withTableQuery(tablePath(next), kept))}
      onOpen={(row) => go(withTableQuery(recordPath(row.kind, row.id), query))}
      mark={(row) => <SourceMark row={row} packs={packs} />}
      sourceWord={(row) => sourceWord(row, packs)}
      head={phone && !inFlyout ? <PhoneHead title="Compendium" /> : undefined}
    />
  );
}
