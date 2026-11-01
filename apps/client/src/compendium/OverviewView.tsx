import { AttentionBell, Button, Group, IconPlus, KindCard } from "@vtt/ui";
import type { HomebrewOverview } from "../homebrew/api";
import { useCompendium } from "./context";
import { useOverview, usePacks, useTable } from "./data";
import { KindIcon, kindPlural, type Kind } from "./kinds";
import { PackSwitch, packName, whenLabel } from "./pieces";
import { COMPENDIUM_PATHS, recordPath, tablePath } from "./routes";

type NeedsYou = HomebrewOverview["needsYou"][number];

/** What a waiting record's line says, and the button that answers it. */
export function needWords(row: NeedsYou): Readonly<{ what: string; action: string; tab: "edit" | "history" }> {
  const left = row.issueCount > 0 ? ` · ${row.issueCount} ${row.issueCount === 1 ? "thing" : "things"} left` : "";
  switch (row.reason) {
    case "changes-not-live":
      return {
        what: `Changes not live since ${whenLabel(row.since).replace(/^Today /, "")}`,
        action: "Update",
        tab: "history"
      };
    case "draft":
      return { what: `Draft${left}`, action: "Open", tab: "edit" };
    case "imported":
      return { what: `Imported${left || " · not reviewed"}`, action: "Review", tab: "edit" };
    case "broken":
      return { what: "Needs fixing · something it needs is gone", action: "Fix it", tab: "edit" };
  }
}

/**
 * The Compendium's home, as Shelves (compendium spec 2.1, ADR-0055): what needs the GM as a strip across the top, the
 * nine kinds as cards (their counts, their homebrew and drafts in magenta, and a few of their records), and the
 * sources on one line at the foot. A phone shows what waits as a box and the kinds two to a row without records.
 */
export function OverviewView() {
  const { token, phone, go, openNew } = useCompendium();
  const overview = useOverview(token);
  const packs = usePacks(token);
  // Every row of every kind, which Browse reads too, for the cards' few records; the cards draw before it answers.
  const rows = useTable(token, null, !phone);
  const data = overview.data;
  if (overview.error && !data)
    return (
      <div className="cp-empty">
        <p>{overview.unavailable ? "This server has no homebrew library yet." : overview.error}</p>
        <Button onClick={() => void overview.reload()}>Try again</Button>
      </div>
    );
  if (!data) return <p className="cp-hint cp-pad">Loading the Compendium.</p>;
  const packList = packs.data?.packs ?? data.packs;
  const open = (row: NeedsYou) => go(`${recordPath(row.kind, row.id)}?tab=${needWords(row).tab}`);
  const table = (kind: Kind, query: string) => go(`${tablePath(kind)}${query ? `?${query}` : ""}`);
  const homebrewQuery = `source=${packList.map((pack) => pack.id).join(",")}`;

  /** A kind's few records: its homebrew first, newest first, then SRD records by name. */
  const recordsOf = (kind: Kind) => {
    const ofKind = (rows.data ?? []).filter((row) => row.kind === kind && !row.archived);
    const homebrew = ofKind
      .filter((row) => row.source !== "srd")
      .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
    const srd = ofKind.filter((row) => row.source === "srd").sort((left, right) => left.name.localeCompare(right.name));
    return [...homebrew, ...srd].slice(0, 3);
  };

  const needs =
    data.needsYou.length === 0 ? (
      <p className="cp-home-needs is-quiet">Nothing waits on you. Every record is published as written.</p>
    ) : (
      <section
        className={phone ? "cp-home-needs is-box" : "cp-home-needs"}
        aria-label={`Waiting, ${data.needsYou.length}`}
      >
        {/* The bell in place of the words Needs you (ADR-0058). */}
        <h3 className="cp-home-needs-head">
          <AttentionBell count={data.needsYou.length} />
          <span className="nh-sr-only">Waiting, {data.needsYou.length}</span>
        </h3>
        <ul className="cp-home-needs-list">
          {data.needsYou.map((row) => {
            const words = needWords(row);
            return (
              <li key={`${row.id}-${row.reason}`} className="cp-home-need">
                <KindIcon kind={row.kind} />
                <span className="cp-home-need-main">
                  <b>{row.name}</b>
                  <small>{words.what}</small>
                </span>
                {row.issueCount > 0 && (
                  <span className="cp-home-need-problems">
                    {row.issueCount} {row.issueCount === 1 ? "problem" : "problems"}
                  </span>
                )}
                <Button size="sm" onClick={() => open(row)} aria-label={`${words.action} ${row.name}`}>
                  {words.action}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
    );

  const cards = (
    <div className="cp-shelves">
      {data.byKind.map((row) => {
        const count = row.srd + row.homebrew;
        const line =
          row.homebrew > 0 || row.drafts > 0 ? (
            <span className="cp-shelf-homebrew">
              {row.homebrew > 0 && (
                <button
                  type="button"
                  className="cp-shelf-link"
                  aria-label={`Homebrew ${kindPlural(row.kind)}: ${row.homebrew}`}
                  onClick={() => table(row.kind, homebrewQuery)}
                >
                  {row.homebrew} homebrew
                </button>
              )}
              {row.homebrew > 0 && row.drafts > 0 && " · "}
              {row.drafts > 0 && (
                <button
                  type="button"
                  className="cp-shelf-link"
                  aria-label={`${kindPlural(row.kind)} in draft: ${row.drafts}`}
                  onClick={() => table(row.kind, "state=draft")}
                >
                  {row.drafts} {row.drafts === 1 ? "draft" : "drafts"}
                </button>
              )}
            </span>
          ) : (
            <span className="cp-shelf-quiet">{row.srd > 0 ? "SRD only" : "None yet"}</span>
          );
        const few = phone ? [] : recordsOf(row.kind);
        return (
          <KindCard
            key={row.kind}
            className="cp-shelf"
            icon={<KindIcon kind={row.kind} />}
            name={kindPlural(row.kind)}
            count={count.toLocaleString("en")}
            line={line}
            onOpen={() => table(row.kind, "")}
          >
            {phone ? null : count === 0 ? (
              <span className="cp-shelf-none">
                No {kindPlural(row.kind).toLowerCase()} yet.
                <Button size="sm" onClick={() => openNew({ kind: row.kind })}>
                  <IconPlus /> New homebrew
                </Button>
              </span>
            ) : (
              few.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  className={record.source === "srd" ? "cp-shelf-record" : "cp-shelf-record is-homebrew"}
                  onClick={() => go(recordPath(record.kind, record.id))}
                >
                  {record.name}
                </button>
              ))
            )}
          </KindCard>
        );
      })}
    </div>
  );

  // The sources, one line at the foot in a Cradle (compendium spec 2.1).
  const sources = (
    <Group className="cp-home-sources" aria-label="Sources">
      <span className="cp-home-source">
        <b>SRD 5.2.1</b> <span className="cp-home-source-count">{data.srd.records.toLocaleString("en")}</span>
        <small>Always in pickers</small>
      </span>
      {packList.map((pack) => (
        <span key={pack.id} className="cp-home-source">
          <b>{packName(pack)}</b> <span className="cp-home-source-count">{pack.counts.records}</span>
          <PackSwitch pack={pack} />
        </span>
      ))}
      <span className="cp-home-source-links">
        <Button size="sm" onClick={() => go(COMPENDIUM_PATHS.sources)}>
          Import a pack
        </Button>
        <Button size="sm" onClick={() => go(COMPENDIUM_PATHS.sources)}>
          Export
        </Button>
      </span>
    </Group>
  );

  return (
    <div className={phone ? "cp-home is-phone scroll-y" : "cp-home scroll-y"}>
      <div className="cp-home-col">
        {needs}
        {cards}
        {!phone && sources}
      </div>
    </div>
  );
}
