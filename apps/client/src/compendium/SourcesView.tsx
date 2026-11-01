import { useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Field,
  IconDownload,
  IconMore,
  Input,
  Menu,
  MenuItem,
  Modal,
  Select,
  SideListGroup,
  SideListRow,
  cx,
  useToast
} from "@vtt/ui";
import { usePrompt } from "../components/feedback";
import { CodexIcon } from "../codex/icons";
import {
  homebrewApi,
  type HomebrewImportDecision,
  type HomebrewImportRecord,
  type HomebrewPack,
  type HomebrewPackImport,
  type HomebrewPackInfo
} from "../homebrew/api";
import { useCompendium } from "./context";
import { refreshCompendium, useHomebrewList, useOverview, usePacks } from "./data";
import { needWords } from "./OverviewView";
import { recordPath } from "./routes";
import { KINDS, KindIcon, kindLabel, type Kind } from "./kinds";
import { PackSwitch, creditWords, packName } from "./pieces";

type Decision = HomebrewImportDecision["decision"];

/** A kind's word starts a table's row, where the kit's words are written for the middle of a sentence. */
const upperFirst = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** What the import does with one record, in the review's words. */
export function decisionWord(record: HomebrewImportRecord, decision: Decision, packTitle: string): string {
  switch (decision) {
    case "new":
      return record.problems.length > 0 ? "Import as a draft" : "Import as new";
    case "replace":
      return "Replace my draft";
    case "skip":
      return "Skip";
    case "rename":
      return `Import as ${record.name ?? "a copy"} (${packTitle})`;
  }
}

/** What a pack's record clashes with here, in words. */
function clashWords(record: HomebrewImportRecord): string | null {
  const clash = record.clash;
  if (!clash) return null;
  if (clash.source === "srd") return `The SRD's ${clash.name}`;
  const state = clash.archived
    ? "archived"
    : clash.state === "draft"
      ? "a draft"
      : clash.audience === "hidden"
        ? "published and Hidden"
        : "published and shown";
  return `Your ${clash.name}, ${state}`;
}

function download(pack: HomebrewPack) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${pack.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "homebrew"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

type Review = Readonly<{
  pack: HomebrewPack;
  fileName: string;
  report: HomebrewPackImport;
  decisions: Readonly<Record<number, Decision>>;
  names: Readonly<Record<number, string>>;
}>;

/**
 * Sources: the SRD, this table and each imported pack, with counts, credit and a switch. Importing a pack is a review
 * table from the server's dry run, a decision for each record; exporting is a selection under a pack name.
 */
export function SourcesView() {
  const { token, phone, query, setQuery, go } = useCompendium();
  const { toast } = useToast();
  const packs = usePacks(token);
  const overview = useOverview(token);
  const homebrew = useHomebrewList(token);
  const { prompt, dialog: promptDialog } = usePrompt();
  const fileRef = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const parsed = JSON.parse(await file.text()) as HomebrewPack;
      if (!parsed || typeof parsed !== "object" || parsed.schemaId !== "vtt.homebrew-pack")
        throw new Error("That file isn't a homebrew pack.");
      setBusy(true);
      // An empty list in a dry run asks the server for each record's default decision.
      const report = await homebrewApi.importPack(token, parsed, [], true);
      setReview({
        pack: parsed,
        fileName: file.name,
        report,
        decisions: Object.fromEntries(report.records.map((record) => [record.index, record.decision])),
        names: {}
      });
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "Couldn't read that file.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const decisions: HomebrewImportDecision[] = review.report.records.map((record) => {
        const decision = review.decisions[record.index] ?? record.decision;
        const name = review.names[record.index]?.trim();
        return { index: record.index, decision, ...(decision === "rename" && name ? { name } : {}) };
      });
      const report = await homebrewApi.importPack(token, review.pack, decisions, false);
      setReview(null);
      refreshCompendium();
      toast(
        `Imported ${report.imported.length} ${report.imported.length === 1 ? "record" : "records"} as drafts only you can see${
          report.rejected.length > 0 ? `. ${report.rejected.length} couldn't be read` : ""
        }.`,
        { tone: report.rejected.length > 0 ? "info" : "success" }
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  };

  const list = packs.data;
  const importButton = (
    <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
      <IconDownload className="cp-upload" /> Import a pack
    </Button>
  );
  const exportButton = (
    <Button size="sm" onClick={() => setExporting(true)}>
      <IconDownload /> Export a selection
    </Button>
  );

  const reviewPart = review && (
    <ImportReview
      review={review}
      phone={phone}
      busy={busy}
      error={error}
      onDecision={(index, decision) => setReview({ ...review, decisions: { ...review.decisions, [index]: decision } })}
      onName={(index, name) => setReview({ ...review, names: { ...review.names, [index]: name } })}
      onCancel={() => setReview(null)}
      onImport={() => void apply()}
    />
  );

  // The chosen source is the address (G pages spec 2.1): the SRD, a pack's id, or This table by default.
  const tablePack = list?.packs.find((pack) => pack.kind === "table") ?? null;
  const sourceKey = query.get("source") ?? tablePack?.id ?? "srd";
  const chosenPack = sourceKey === "srd" ? null : (list?.packs.find((pack) => pack.id === sourceKey) ?? tablePack);
  const choose = (key: string) => setQuery((params) => params.set("source", key));
  const theirs = (homebrew.data ?? []).filter((row) => chosenPack && row.packId === chosenPack.id && !row.deletedAt);
  const byKind = chosenPack
    ? KINDS.map((kind) => {
        const rows = theirs.filter((row) => row.type === kind);
        return {
          kind,
          records: rows.length,
          drafts: rows.filter((row) => row.state === "draft").length,
          shared: rows.filter((row) => row.audience !== "hidden").length
        };
      }).filter((row) => row.records > 0)
    : (overview.data?.byKind ?? [])
        .filter((row) => row.srd > 0)
        .map((row) => ({ kind: row.kind as Kind, records: row.srd, drafts: 0, shared: row.srd }));
  const needs = chosenPack ? (overview.data?.needsYou ?? []).filter((row) => row.packId === chosenPack.id) : [];
  const sourceName = chosenPack ? packName(chosenPack) : "SRD 5.2.1";
  const sourceLine = chosenPack
    ? [
        creditWords(chosenPack),
        `${chosenPack.counts.records} ${chosenPack.counts.records === 1 ? "record" : "records"}`,
        `${chosenPack.counts.published} published`,
        `${chosenPack.counts.shared} shared`
      ].join(" · ")
    : "Read only. Make a homebrew copy of anything.";

  const rename = async () => {
    if (!chosenPack) return;
    const name = await prompt({
      title: "Rename the source",
      defaultValue: packName(chosenPack),
      confirmLabel: "Rename"
    });
    if (!name) return;
    try {
      await homebrewApi.updatePack(token, chosenPack.id, { name });
      refreshCompendium();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "Couldn't rename the source.", { tone: "error" });
    }
  };
  const recredit = async () => {
    if (!chosenPack) return;
    const credit = await prompt({
      title: "Credit",
      defaultValue: chosenPack.credit ?? "",
      confirmLabel: "Save credit"
    });
    if (credit === null) return;
    try {
      await homebrewApi.updatePack(token, chosenPack.id, { credit: credit || null });
      refreshCompendium();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "Couldn't save the credit.", { tone: "error" });
    }
  };

  const sourceRows = list && (
    <>
      {[
        { key: "srd", name: "SRD 5.2.1", icon: "book", count: list.srd.records },
        ...list.packs.map((pack) => ({
          key: pack.id,
          name: packName(pack),
          icon: pack.kind === "table" ? "home" : "archive",
          count: pack.counts.records
        }))
      ].map((row) =>
        phone ? (
          <button
            key={row.key}
            type="button"
            className={cx("nh-filterchip", "interactive", sourceKey === row.key && "is-on")}
            aria-pressed={sourceKey === row.key}
            onClick={() => choose(row.key)}
          >
            {row.name} <span className="cx-tag-n">{row.count.toLocaleString("en")}</span>
          </button>
        ) : (
          <SideListRow
            key={row.key}
            label={row.name}
            leading={<CodexIcon iconId={row.icon} />}
            count={row.count.toLocaleString("en")}
            current={sourceKey === row.key || (row.key === chosenPack?.id && sourceKey !== "srd")}
            onSelect={() => choose(row.key)}
          />
        )
      )}
    </>
  );

  const detail = list && (
    <section className="cp-source" aria-label={sourceName}>
      <div className="cp-source-head">
        <h3 className="cp-source-name">{sourceName}</h3>
        {!phone && exportButton}
        {chosenPack && (
          <Menu icon align="end" label={`More for ${sourceName}`} trigger={<IconMore />}>
            <MenuItem onClick={() => void rename()}>Rename…</MenuItem>
            <MenuItem onClick={() => void recredit()}>Credit…</MenuItem>
          </Menu>
        )}
      </div>
      <p className="cp-source-line">{sourceLine}</p>
      <div className="cp-source-pickers">
        {chosenPack ? <PackSwitch pack={chosenPack} /> : <b className="cp-source-always">Always in pickers</b>}
        {chosenPack && (
          <span className="cp-hint">In pickers: homebrew fields and the encounter builder offer these records.</span>
        )}
      </div>
      {byKind.length > 0 && (
        <>
          <p className="nh-sidelist-eyebrow">By kind</p>
          <table className="cp-table cp-source-kinds">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col" className="is-num">
                  Records
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
              {byKind.map((row) => (
                <tr key={row.kind}>
                  <th scope="row">
                    <KindIcon kind={row.kind} /> {upperFirst(kindLabel(row.kind))}
                  </th>
                  <td className="is-num tabular">{row.records.toLocaleString("en")}</td>
                  <td className="is-num tabular">{row.drafts}</td>
                  <td className="is-num tabular">{row.shared.toLocaleString("en")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {needs.length > 0 && (
        <>
          <p className="nh-sidelist-eyebrow">Needs you</p>
          <ul className="cp-source-needs" aria-label="Needs you">
            {needs.map((row) => {
              const words = needWords(row);
              return (
                <li key={`${row.id}-${row.reason}`} className="cp-home-need">
                  <KindIcon kind={row.kind as Kind} />
                  <span className="cp-home-need-main">
                    <b>{row.name}</b>
                    <small>{words.what}</small>
                  </span>
                  <Button size="sm" onClick={() => go(`${recordPath(row.kind as Kind, row.id)}?tab=${words.tab}`)}>
                    Open
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );

  return (
    <div className={cx("cp-sources", phone ? "scroll-y" : "cp-sources-split")}>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="A homebrew pack file"
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {!list ? (
        <p className="cp-hint cp-pad">{packs.error ?? "Reading the sources."}</p>
      ) : phone ? (
        <div className="cp-phone-body">
          <div className="nh-filterchips" role="group" aria-label="Sources">
            {sourceRows}
          </div>
          {detail}
          <div className="cp-actions-row">
            {exportButton}
            {importButton}
          </div>
          {reviewPart}
        </div>
      ) : (
        <>
          <nav className="cp-sources-side scroll-y" aria-label="Sources">
            <SideListGroup eyebrow="Sources">{sourceRows}</SideListGroup>
            {importButton}
          </nav>
          <div className="cp-sources-main scroll-y">
            {detail}
            {reviewPart}
          </div>
        </>
      )}
      {exporting && <ExportDialog packs={list?.packs ?? []} onClose={() => setExporting(false)} />}
      {promptDialog}
    </div>
  );
}

function ImportReview({
  review,
  phone,
  busy,
  error,
  onDecision,
  onName,
  onCancel,
  onImport
}: Readonly<{
  review: Review;
  phone: boolean;
  busy: boolean;
  error: string | null;
  onDecision: (index: number, decision: Decision) => void;
  onName: (index: number, name: string) => void;
  onCancel: () => void;
  onImport: () => void;
}>) {
  const packTitle = review.pack.name;
  const records = review.report.records;
  const decisionOf = (record: HomebrewImportRecord) => review.decisions[record.index] ?? record.decision;
  const landing = records.filter((record) => decisionOf(record) !== "skip" && record.type !== null).length;
  const unreadable = records.filter((record) => record.type === null);

  const decisionControl = (record: HomebrewImportRecord) => {
    const decision = decisionOf(record);
    const label = `What to do with ${record.name ?? "this record"}`;
    return (
      <div className="cp-decision">
        <Select
          aria-label={label}
          value={decision}
          disabled={record.allowed.length < 2}
          onChange={(event) => onDecision(record.index, event.target.value as Decision)}
        >
          {record.allowed.map((option) => (
            <option key={option} value={option}>
              {decisionWord(record, option, packTitle)}
            </option>
          ))}
        </Select>
        {decision === "rename" && (
          <Input
            aria-label={`The copy's name for ${record.name ?? "this record"}`}
            placeholder={`${record.name ?? "A copy"} (${packTitle})`}
            value={review.names[record.index] ?? ""}
            onChange={(event) => onName(record.index, event.target.value)}
          />
        )}
      </div>
    );
  };
  const problemsOf = (record: HomebrewImportRecord) =>
    record.problems.length === 0 ? null : record.problems.map((problem) => problem.message).join(" ");
  const kindOf = (record: HomebrewImportRecord): Kind | null => record.type;

  return (
    <section className="cp-review-import" aria-label={`Review ${packTitle}`}>
      <div className="cp-section-head">
        <h3 className="cp-h cp-grow">
          Review {packTitle}
          {phone ? ` · ${records.length}` : ""}
        </h3>
        {!phone && (
          <span className="cp-hint">
            {records.length} {records.length === 1 ? "record" : "records"} from {review.fileName}
          </span>
        )}
      </div>
      {phone ? (
        <ul className="cp-list">
          {records
            .filter((record) => record.type !== null)
            .map((record) => (
              <li key={record.index} className="cp-card-row is-top">
                <KindIcon kind={kindOf(record)!} />
                <span className="cp-row-main">
                  <b>{record.name ?? "A record with no name"}</b>
                  <small className={record.clash || record.problems.length ? "cp-caution" : undefined}>
                    {clashWords(record) ?? problemsOf(record) ?? "No clash · ready"}
                  </small>
                  {decisionControl(record)}
                </span>
              </li>
            ))}
        </ul>
      ) : (
        <table className="cp-table cp-import-table">
          <thead>
            <tr>
              <th scope="col">Record</th>
              <th scope="col">Kind</th>
              <th scope="col">Clashes with</th>
              <th scope="col">Problems</th>
              <th scope="col">Decision</th>
            </tr>
          </thead>
          <tbody>
            {records
              .filter((record) => record.type !== null)
              .map((record) => (
                <tr key={record.index}>
                  <td>
                    <span className="cp-name">
                      <KindIcon kind={kindOf(record)!} />
                      <b className="cp-name-text">{record.name ?? "A record with no name"}</b>
                      <Badge tone="violet" className="cp-pack-mark">
                        {packTitle}
                      </Badge>
                    </span>
                  </td>
                  <td>{kindLabel(kindOf(record)!).replace(/^./, (letter) => letter.toUpperCase())}</td>
                  <td className={record.clash ? "cp-caution" : undefined}>{clashWords(record) ?? "None"}</td>
                  <td className={record.problems.length ? "cp-caution" : undefined}>{problemsOf(record) ?? "None"}</td>
                  <td>{decisionControl(record)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      {unreadable.length > 0 && (
        <p className="cp-hint cp-caution">
          {unreadable.length === 1 ? "One record" : `${unreadable.length} records`} in the file can't be read and won't
          come in.
        </p>
      )}
      <div className="cp-actions-row">
        <span className="cp-hint cp-grow">
          Everything imports as a draft only you can see. Replace is offered only for your own drafts.
        </span>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onImport} disabled={busy || landing === 0}>
          Import {landing} {landing === 1 ? "record" : "records"}
        </Button>
      </div>
      {error && (
        <p className="cp-blocked" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Export a selection: published records ticked one by one or a whole source at a time, under a pack name. */
function ExportDialog({ packs, onClose }: Readonly<{ packs: readonly HomebrewPackInfo[]; onClose: () => void }>) {
  const { token } = useCompendium();
  const { toast } = useToast();
  const list = useHomebrewList(token);
  const published = useMemo(
    () =>
      (list.data ?? [])
        .filter((row) => row.state === "published" && !row.deletedAt)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [list.data]
  );
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState("");
  const [credit, setCredit] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (ids: readonly string[], on: boolean) => {
    const next = new Set(chosen);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setChosen(next);
  };
  const run = async () => {
    setBusy(true);
    try {
      const pack = await homebrewApi.exportPack(token, {
        ids: [...chosen],
        name: name.trim() || "Homebrew",
        ...(credit.trim() ? { credit: credit.trim() } : {})
      });
      download(pack);
      toast(`Exported ${pack.records.length} ${pack.records.length === 1 ? "record" : "records"} as ${pack.name}.`, {
        tone: "success"
      });
      onClose();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "Couldn't export those records.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Export a selection"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || chosen.size === 0} onClick={() => void run()}>
            Export {chosen.size} {chosen.size === 1 ? "record" : "records"}
          </Button>
        </>
      }
    >
      <div className="cp-export">
        <Field label="Pack name" htmlFor="cp-export-name">
          <Input
            id="cp-export-name"
            value={name}
            placeholder="Homebrew"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field
          label="Credit"
          htmlFor="cp-export-credit"
          help="Who made it, as the importing table's Sources credit it."
        >
          <Input id="cp-export-credit" value={credit} onChange={(event) => setCredit(event.target.value)} />
        </Field>
        <p className="cp-eyebrow">A whole source</p>
        <div className="cp-actions-row">
          {packs.map((pack) => {
            const ids = published.filter((row) => row.packId === pack.id).map((row) => row.id);
            return (
              <Button key={pack.id} size="sm" disabled={ids.length === 0} onClick={() => toggle(ids, true)}>
                {packName(pack)} · {ids.length}
              </Button>
            );
          })}
          <Button size="sm" disabled={chosen.size === 0} onClick={() => setChosen(new Set())}>
            Clear
          </Button>
        </div>
        <p className="cp-eyebrow">Published records</p>
        {!list.data ? (
          <p className="cp-hint">Reading your homebrew.</p>
        ) : published.length === 0 ? (
          <p className="cp-hint">Nothing is published yet, so there is nothing to export.</p>
        ) : (
          <ul className="cp-checklist scroll-y" aria-label="Published records">
            {published.map((row) => (
              <li key={row.id}>
                <label className="nh-check">
                  <input
                    type="checkbox"
                    checked={chosen.has(row.id)}
                    onChange={(event) => toggle([row.id], event.target.checked)}
                  />
                  <KindIcon kind={row.type} />
                  <span className="cp-check-text">
                    <span>{row.name}</span>
                    <small>{kindLabel(row.type)}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
