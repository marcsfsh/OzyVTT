import { useEffect, useMemo, useState } from "react";
import { Button, IconCopy, cx } from "@vtt/ui";
import { homebrewApi, type HomebrewRecordDocument, type HomebrewRevisionSummary } from "../../homebrew/api";
import type { Draft } from "../../homebrew/schema";
import type { Kind } from "../kinds";
import { whenLabel } from "../pieces";
import { CompareTable } from "./Compare";
import { defaultPicks, historyRows, type HistoryRow } from "./history";
import { DEVICE_WORDS, compareBodies } from "./words";

type Body = Readonly<Record<string, unknown>>;

const dayOf = (at: string) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** A row's device in words: this device, another one, or how many wrote the edits it folds. */
const deviceWord = (row: HistoryRow) => (row.devices > 1 ? `${row.devices} devices` : DEVICE_WORDS[row.device]);

/**
 * A record's history as a table: each version players got and the edits between them, when, from which device and
 * what changed. Two ticked rows compare field by field, and Restore puts the older one back as the editor's copy,
 * which reaches players only with Update. A copy also compares against the record it was made from.
 */
export function HistoryTab({
  token,
  doc,
  kind,
  draft,
  busy,
  phone,
  onRestore,
  onDiscard,
  onOpenSource
}: Readonly<{
  token: string;
  doc: HomebrewRecordDocument;
  kind: Kind;
  /** The editor's copy, for Compare with the source. */
  draft: Draft;
  busy: boolean;
  phone: boolean;
  onRestore: (revisionId: number) => Promise<boolean>;
  onDiscard: () => void;
  onOpenSource: (source: NonNullable<HomebrewRecordDocument["basedOn"]>) => void;
}>) {
  const [revisions, setRevisions] = useState<readonly HomebrewRevisionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<readonly string[] | null>(null);
  const [bodies, setBodies] = useState<ReadonlyMap<number, Body>>(new Map());

  // Every write leaves a history row, so the list is read again whenever the record moves.
  useEffect(() => {
    let live = true;
    homebrewApi.revisions(token, doc.id).then(
      (list) => {
        if (live) {
          setRevisions(list);
          setError(null);
        }
      },
      (failure: unknown) => {
        if (live) setError(failure instanceof Error ? failure.message : "Couldn't read the history.");
      }
    );
    return () => {
      live = false;
    };
  }, [token, doc.id, doc.rev]);

  const rows = useMemo(() => (revisions ? historyRows(revisions, kind) : []), [revisions, kind]);
  const picks = (picked ?? defaultPicks(rows)).filter((key) => rows.some((row) => row.key === key));
  // Older on the left: the table is newest first, so the later index is the older row.
  const chosen = rows.filter((row) => picks.includes(row.key) && row.revisionId !== null);
  const [newer, older] = chosen.length === 2 ? chosen : [undefined, undefined];

  useEffect(() => {
    const wanted = [older?.revisionId, newer?.revisionId].filter(
      (id): id is number => typeof id === "number" && !bodies.has(id)
    );
    if (wanted.length === 0) return;
    let live = true;
    void Promise.all(wanted.map((id) => homebrewApi.revision(token, doc.id, id))).then(
      (read) => {
        if (!live) return;
        setBodies((held) => {
          const next = new Map(held);
          for (const entry of read) next.set(entry.id, entry.record);
          return next;
        });
      },
      (failure: unknown) => {
        if (live) setError(failure instanceof Error ? failure.message : "Couldn't read that version.");
      }
    );
    return () => {
      live = false;
    };
  }, [token, doc.id, older?.revisionId, newer?.revisionId, bodies]);

  const toggle = (row: HistoryRow) => {
    if (row.revisionId === null) return;
    const now = picks.includes(row.key) ? picks.filter((key) => key !== row.key) : [...picks, row.key].slice(-2);
    setPicked(now);
  };

  const leftBody = older?.revisionId ? bodies.get(older.revisionId) : undefined;
  const rightBody = newer?.revisionId ? bodies.get(newer.revisionId) : undefined;
  const compared = leftBody && rightBody ? compareBodies(kind, leftBody, rightBody) : null;
  const restorable = older && older.revisionId !== null && rows[0]?.key !== older.key ? older : null;

  const pickBox = (row: HistoryRow) =>
    row.revisionId === null ? null : (
      <input
        type="checkbox"
        className="cp-pick"
        checked={picks.includes(row.key)}
        onChange={() => toggle(row)}
        aria-label={`Compare ${row.label}, ${whenLabel(row.at)}`}
      />
    );

  return (
    <div className="cp-historytab">
      {error && (
        <p className="cp-blocked" role="alert">
          {error}
        </p>
      )}
      {!revisions && !error && <p className="cp-hint">Reading the history.</p>}
      {revisions &&
        (phone ? (
          <ul className="cp-histlist" aria-label="Versions and edits">
            {rows.map((row) => (
              <li key={row.key} className={cx("cp-histrow", picks.includes(row.key) && "is-picked")}>
                <label className="cp-histrow-main">
                  {pickBox(row)}
                  <span className="cp-row-main">
                    <b className={cx(row.notLive && "cp-caution")}>{row.label}</b>
                    <small>
                      {whenLabel(row.at)} · {deviceWord(row)}
                    </small>
                    {row.changed.length > 0 && <small>{row.changed.join(", ")}</small>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <table className="cp-table cp-history-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="nh-sr-only">Compare</span>
                </th>
                <th scope="col">Version</th>
                <th scope="col">When</th>
                <th scope="col">Device</th>
                <th scope="col">What changed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={cx(picks.includes(row.key) && "is-selected")}>
                  <td className="cp-pick-cell">{pickBox(row)}</td>
                  <td>
                    <span className={cx(row.notLive && "cp-caution", row.version !== null && "cp-strong")}>
                      {row.label}
                    </span>
                  </td>
                  <td className="cp-when">{whenLabel(row.at)}</td>
                  <td>{deviceWord(row)}</td>
                  <td>{row.changed.join(", ") || <span className="cp-muted">None</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      {older && newer && (
        <>
          <h4 className="cp-h">
            {older.label} and {newer.notLive ? "the changes not live" : newer.label.toLowerCase()}
          </h4>
          {!compared ? (
            <p className="cp-hint">Reading both versions.</p>
          ) : compared.length === 0 ? (
            <p className="cp-hint">No field differs between them.</p>
          ) : (
            <CompareTable
              rows={compared}
              leftLabel={older.label}
              rightLabel={newer.notLive ? "Not live" : newer.label}
              caption={`${older.label} beside ${newer.label}`}
            />
          )}
        </>
      )}
      {(restorable || doc.pendingChanges) && (
        <div className="cp-actions-row">
          {restorable && restorable.revisionId !== null && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void onRestore(restorable.revisionId!)}
            >
              Restore {restorable.label.replace(/^Version/, "version")}
            </Button>
          )}
          {doc.pendingChanges && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onDiscard}>
              Discard the changes
            </Button>
          )}
        </div>
      )}
      {restorable && (
        <p className="cp-hint">
          Restore puts it back as{" "}
          {doc.state === "published" ? "changes not live. Players get it with Update." : "the draft."}
        </p>
      )}
      {doc.basedOn && <BasedOn token={token} doc={doc} kind={kind} draft={draft} onOpen={onOpenSource} />}
    </div>
  );
}

/** Where a copy came from, and the copy beside its source field by field. */
function BasedOn({
  token,
  doc,
  kind,
  draft,
  onOpen
}: Readonly<{
  token: string;
  doc: HomebrewRecordDocument;
  kind: Kind;
  draft: Draft;
  onOpen: (source: NonNullable<HomebrewRecordDocument["basedOn"]>) => void;
}>) {
  const source = doc.basedOn!;
  const [body, setBody] = useState<Body | null | "gone">(null);
  useEffect(() => {
    let live = true;
    const read =
      source.source === "srd"
        ? homebrewApi.srdRecord(token, source.id).then((answer) => answer.record)
        : homebrewApi.get(token, source.id).then((answer) => answer.record);
    read.then(
      (record) => {
        if (live) setBody(record);
      },
      () => {
        if (live) setBody("gone");
      }
    );
    return () => {
      live = false;
    };
  }, [token, source.source, source.id]);
  const srd = source.source === "srd";
  const rows = body && body !== "gone" ? compareBodies(kind, body, draft) : [];
  return (
    <section className="cp-basedon" aria-label="Based on">
      <div className="cp-mrow">
        <IconCopy />
        <span className="cp-grow">
          Based on <b>{source.name}</b> ({srd ? "SRD 5.2.1" : "homebrew"}), copied {dayOf(source.copiedAt)}
        </span>
        <Button size="sm" variant="ghost" onClick={() => onOpen(source)}>
          Open the {srd ? "SRD record" : "original"}
        </Button>
      </div>
      <h4 className="cp-h">Compare with {srd ? "the SRD" : source.name}</h4>
      {body === null ? (
        <p className="cp-hint">Reading {source.name}.</p>
      ) : body === "gone" ? (
        <p className="cp-hint">{source.name} is no longer in this table, so there is nothing to compare.</p>
      ) : rows.length === 0 ? (
        <p className="cp-hint">Nothing differs from {srd ? "the SRD" : source.name} yet.</p>
      ) : (
        <>
          <CompareTable
            rows={rows}
            leftLabel={srd ? "SRD 5.2.1" : source.name}
            rightLabel="This copy"
            caption={`${source.name} beside this copy`}
          />
          <p className="cp-hint">
            {rows.length === 1 ? "1 field differs" : `${rows.length} fields differ`}. The rest is as{" "}
            {srd ? "the SRD prints it" : `${source.name} has it`}.
          </p>
        </>
      )}
    </section>
  );
}
