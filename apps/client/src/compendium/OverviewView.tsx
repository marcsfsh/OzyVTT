import { Button, IconChevronRight } from "@vtt/ui";
import { CodexIcon } from "../codex/icons";
import type { HomebrewOverview } from "../homebrew/api";
import { useCompendium } from "./context";
import { useOverview, usePacks } from "./data";
import { KindIcon, kindPlural, type Kind } from "./kinds";
import { NameCell, PackSwitch, PhoneHead, SourceMark, packName, whenLabel } from "./pieces";
import { recordPath, tablePath } from "./routes";

type NeedsYou = HomebrewOverview["needsYou"][number];

/** What a Needs you line says, and the button that answers it. */
function needWords(row: NeedsYou): Readonly<{ what: string; action: string; tab: "edit" | "history" }> {
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
 * The Compendium's front page: the sources with their counts and switches, what needs the GM with its button, and the
 * kinds with their counts, each count opening its table with that filter.
 */
export function OverviewView() {
  const { token, phone, go } = useCompendium();
  const overview = useOverview(token);
  const packs = usePacks(token);
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

  if (phone)
    return (
      <div className="cp-overview scroll-y">
        <PhoneHead title="Compendium" />
        <div className="cp-phone-body">
          <h3 className="cp-h">Sources</h3>
          <div className="cp-card-row">
            <CodexIcon iconId="book" className="cp-kind-icon" />
            <span className="cp-row-main">
              <b>SRD 5.2.1</b>
              <small>
                {data.srd.records.toLocaleString("en")} records · Read only. Make a homebrew copy of anything.
              </small>
            </span>
          </div>
          {packList.map((pack) => (
            <div key={pack.id} className="cp-card-row">
              <CodexIcon iconId={pack.id === "table" ? "home" : "archive"} className="cp-kind-icon" />
              <span className="cp-row-main">
                <b>{packName(pack)}</b>
                <small>
                  {pack.counts.records} {pack.counts.records === 1 ? "record" : "records"}
                  {pack.credit ? ` · ${pack.credit}` : ""}
                </small>
              </span>
              <PackSwitch pack={pack} />
            </div>
          ))}
          <h3 className="cp-h">Needs you</h3>
          {data.needsYou.length === 0 ? (
            <p className="cp-hint">Nothing needs you. Every record is published as written.</p>
          ) : (
            <ul className="cp-list">
              {data.needsYou.map((row) => (
                <li key={`${row.id}-${row.reason}`}>
                  <button type="button" className="cp-row" onClick={() => open(row)}>
                    <KindIcon kind={row.kind} />
                    <span className="cp-row-main">
                      <b>{row.name}</b>
                      <small>{needWords(row).what}</small>
                    </span>
                    <IconChevronRight />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );

  return (
    <div className="cp-overview cp-overview--laptop scroll-y">
      <div className="cp-overview-col">
        <h3 className="cp-h">Sources</h3>
        <table className="cp-table cp-sources-table">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col" className="is-num">
                Records
              </th>
              <th scope="col" className="is-num">
                Published
              </th>
              <th scope="col" className="is-num">
                Shared
              </th>
              <th scope="col">In pickers</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">SRD 5.2.1</th>
              <td className="is-num tabular">{data.srd.records.toLocaleString("en")}</td>
              <td className="is-num">All</td>
              <td className="is-num">All</td>
              <td>Always on</td>
            </tr>
            {packList.map((pack) => (
              <tr key={pack.id}>
                <th scope="row">{packName(pack)}</th>
                <td className="is-num tabular">{pack.counts.records}</td>
                <td className="is-num tabular">{pack.counts.published}</td>
                <td className="is-num tabular">{pack.counts.shared}</td>
                <td>
                  <PackSwitch pack={pack} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="cp-h">Needs you</h3>
        {data.needsYou.length === 0 ? (
          <p className="cp-hint">Nothing needs you. Every record is published as written.</p>
        ) : (
          <table className="cp-table cp-needs-table">
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">What</th>
                <th scope="col">
                  <span className="nh-sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.needsYou.map((row) => {
                const words = needWords(row);
                return (
                  <tr key={`${row.id}-${row.reason}`}>
                    <td>
                      <NameCell
                        kind={row.kind}
                        name={row.name}
                        mark={<SourceMark row={{ source: "homebrew", packId: row.packId }} packs={packList} />}
                      />
                    </td>
                    <td>{words.what}</td>
                    <td className="cp-action-cell">
                      <Button size="sm" onClick={() => open(row)} aria-label={`${words.action} ${row.name}`}>
                        {words.action}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="cp-overview-col">
        <h3 className="cp-h">By kind</h3>
        <table className="cp-table cp-bykind-table">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col" className="is-num">
                SRD
              </th>
              <th scope="col" className="is-num">
                Homebrew
              </th>
              <th scope="col" className="is-num">
                Drafts
              </th>
              <th scope="col" className="is-num">
                Shared
              </th>
            </tr>
          </thead>
          <tbody>
            {data.byKind.map((row) => (
              <tr key={row.kind}>
                <th scope="row">
                  <button type="button" className="cp-rowlink" onClick={() => table(row.kind, "")}>
                    <b>{kindPlural(row.kind)}</b>
                  </button>
                </th>
                <CountCell
                  value={row.srd}
                  label={`SRD ${kindPlural(row.kind)}`}
                  onOpen={() => table(row.kind, "source=srd")}
                />
                <CountCell
                  value={row.homebrew}
                  label={`Homebrew ${kindPlural(row.kind)}`}
                  onOpen={() => table(row.kind, `source=${packList.map((pack) => pack.id).join(",")}`)}
                />
                <CountCell
                  value={row.drafts}
                  label={`${kindPlural(row.kind)} in draft`}
                  caution
                  onOpen={() => table(row.kind, "state=draft")}
                />
                <CountCell
                  value={row.shared}
                  label={`Shared ${kindPlural(row.kind)}`}
                  onOpen={() => table(row.kind, "who=everyone,characters")}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A count that opens its table with that filter. Zero opens nothing. */
function CountCell({
  value,
  label,
  caution = false,
  onOpen
}: Readonly<{ value: number; label: string; caution?: boolean; onOpen: () => void }>) {
  return (
    <td className="is-num tabular">
      {value === 0 ? (
        <span className="cp-muted">0</span>
      ) : (
        <button
          type="button"
          className={caution ? "cp-count cp-caution" : "cp-count"}
          aria-label={`${label}: ${value}`}
          onClick={onOpen}
        >
          {value.toLocaleString("en")}
        </button>
      )}
    </td>
  );
}
