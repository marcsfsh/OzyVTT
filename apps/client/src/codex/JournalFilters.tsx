import { useMemo, type ReactNode } from "react";
import { Input, Select } from "@vtt/ui";
import type { CodexChronicleKind } from "@vtt/domain";
import { CHRONICLE_FILTER_KINDS, CHRONICLE_KIND_META } from "./chronicle";

/** Both journals filter the same way, client-side over what they loaded, with the filters in the address. */
export type JournalFilter = Readonly<{ kind: string | null; tag: string | null; text: string }>;

type FilterableRecord = Readonly<{
  kind: CodexChronicleKind;
  tags: readonly string[];
  text: string;
  title: string | null;
  gmText?: string | null;
}>;

/** Filter before grouping, so a group never keeps an empty heading. */
export function filterChronicle<R extends FilterableRecord>(records: readonly R[], filter: JournalFilter): R[] {
  const needle = filter.text.trim().toLowerCase();
  return records.filter(
    (record) =>
      (!filter.kind || record.kind === filter.kind) &&
      (!filter.tag || record.tags.includes(filter.tag)) &&
      (!needle ||
        record.text.toLowerCase().includes(needle) ||
        (record.gmText ?? "").toLowerCase().includes(needle) ||
        (record.title ?? "").toLowerCase().includes(needle))
  );
}

/** Kind, text and tag filters, after any controls the caller leads with (the GM's lens). */
export function JournalFilters({
  records,
  filter,
  onFilterChange,
  children
}: Readonly<{
  records: readonly FilterableRecord[];
  filter: JournalFilter;
  onFilterChange: (next: Readonly<Record<string, string | null>>) => void;
  children?: ReactNode;
}>) {
  const tags = useMemo(() => [...new Set(records.flatMap((record) => record.tags))].sort(), [records]);
  return (
    <div className="codex-timeline-lens">
      {children}
      <Select
        aria-label="Filter by kind"
        value={filter.kind ?? ""}
        onChange={(event) => onFilterChange({ kind: event.target.value || null })}
      >
        <option value="">All kinds</option>
        {CHRONICLE_FILTER_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {CHRONICLE_KIND_META[kind].label}
          </option>
        ))}
      </Select>
      <Input
        aria-label="Filter the journal"
        placeholder="Filter the journal"
        value={filter.text}
        onChange={(event) => onFilterChange({ q: event.target.value || null })}
      />
      {tags.length > 0 && (
        <Select
          aria-label="Filter by tag"
          value={filter.tag ?? ""}
          onChange={(event) => onFilterChange({ tag: event.target.value || null })}
        >
          <option value="">All tags</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              #{tag}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
