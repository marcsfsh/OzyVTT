import type { ReactNode } from "react";
import { Badge, IconButton, IconCheck, IconChevronLeft, IconPencil, IconWait, Switch, useToast } from "@vtt/ui";
import { HomebrewBadge } from "../homebrew/marks";
import { homebrewApi, type HomebrewPackInfo } from "../homebrew/api";
import { useCompendium } from "./context";
import { refreshCompendium } from "./data";
import { CodexIcon } from "../codex/icons";
import { KindIcon, type Kind } from "./kinds";
import { STATE_WORD, stateOf, type CompendiumRow } from "./tableModel";

/** A record's state as a word with its mark: Published, Draft, Changes not live or Archived; an SRD row says SRD. */
export function StateChip({
  row
}: Readonly<{ row: Pick<CompendiumRow, "source" | "state" | "archived" | "pendingChanges"> }>) {
  if (row.source === "srd") return <span className="cp-muted">SRD</span>;
  const state = stateOf(row as CompendiumRow);
  if (state === "published")
    return (
      <Badge tone="info" className="cp-state">
        <IconCheck /> {STATE_WORD.published}
      </Badge>
    );
  if (state === "pending")
    return (
      <Badge tone="caution" className="cp-state">
        <IconWait /> {STATE_WORD.pending}
      </Badge>
    );
  if (state === "draft")
    return (
      <Badge tone="caution" className="cp-state">
        <IconPencil /> {STATE_WORD.draft}
      </Badge>
    );
  return <Badge className="cp-state">{STATE_WORD.archived}</Badge>;
}

/** Where a row comes from, in words: the SRD, this table, or an imported pack by its name. */
export function sourceWord(row: Pick<CompendiumRow, "source" | "packId">, packs: readonly HomebrewPackInfo[]): string {
  if (row.source === "srd") return "SRD 5.2.1";
  if (row.packId === null || row.packId === "table") return "This table";
  return packs.find((pack) => pack.id === row.packId)?.name ?? "An imported pack";
}

/** The mark after a row's name: Homebrew for this table's own, the pack's name for an imported record. */
export function SourceMark({
  row,
  packs
}: Readonly<{ row: Pick<CompendiumRow, "source" | "packId">; packs: readonly HomebrewPackInfo[] }>) {
  if (row.source === "srd") return null;
  if (row.packId === null || row.packId === "table") return <HomebrewBadge />;
  return (
    <Badge tone="violet" className="cp-pack-mark">
      {sourceWord(row, packs)}
    </Badge>
  );
}

/** A row's name with its kind's mark and where it comes from. */
export function NameCell({ kind, name, mark }: Readonly<{ kind: Kind; name: string; mark?: ReactNode }>) {
  return (
    <span className="cp-name">
      <KindIcon kind={kind} />
      <b className="cp-name-text">{name}</b>
      {mark}
    </span>
  );
}

/** When a record last changed: Today 21:40, Yesterday, or the day. SRD rows say SRD. */
export function whenLabel(at: string | null | undefined, now: Date = new Date()): string {
  if (!at) return "SRD";
  const day = new Date(at);
  if (Number.isNaN(day.getTime())) return "None";
  const time = day.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(day)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/**
 * A phone's bar over a view: Back when the view has one to go to, the title, the view's own controls and Search. It
 * wears the Codex phone bar's look, so the two tabs read alike.
 */
export function PhoneHead({
  title,
  onBack,
  actions,
  search = true
}: Readonly<{ title: ReactNode; onBack?: () => void; actions?: ReactNode; search?: boolean }>) {
  const { openSearch } = useCompendium();
  return (
    <header className="cx-phonebar cp-phonehead">
      {onBack && (
        <IconButton label="Back" size="sm" onClick={onBack}>
          <IconChevronLeft />
        </IconButton>
      )}
      <h2 className="cx-phonebar-title">{title}</h2>
      <div className="cx-phonebar-actions">
        {actions}
        {search && (
          <IconButton label="Search" size="sm" onClick={openSearch}>
            <CodexIcon iconId="search" className="cx-icon" />
          </IconButton>
        )}
      </div>
    </header>
  );
}

export const packName = (pack: HomebrewPackInfo) => (pack.kind === "table" ? "This table" : (pack.name ?? "A pack"));

/** A pack's credit in words: who made it and when it came, or that this table's own was made here. */
export function creditWords(pack: HomebrewPackInfo): string {
  if (pack.kind === "table") return pack.credit ?? "Made here";
  const when = pack.importedAt ? `imported ${whenLabel(pack.importedAt).replace(/^Today .*/, "today")}` : "imported";
  return [pack.credit, when].filter(Boolean).join(" · ");
}

/** A pack's switch: Off takes its published records out of every picker and the bestiary, for everyone. */
export function PackSwitch({ pack }: Readonly<{ pack: HomebrewPackInfo }>) {
  const { token } = useCompendium();
  const { toast } = useToast();
  return (
    <Switch
      checked={pack.enabled}
      label={pack.enabled ? "On" : "Off"}
      labelAlternate={pack.enabled ? "Off" : "On"}
      aria-label={`${packName(pack)} in pickers: ${pack.enabled ? "On" : "Off"}`}
      onChange={(enabled) =>
        void homebrewApi.updatePack(token, pack.id, { enabled }).then(
          () => refreshCompendium(),
          (error: unknown) =>
            toast(error instanceof Error ? error.message : "Couldn't switch that pack.", { tone: "error" })
        )
      }
    />
  );
}
