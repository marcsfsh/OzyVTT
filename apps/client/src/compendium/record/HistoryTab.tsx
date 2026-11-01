import { useEffect, useMemo, useState } from "react";
import { Button, IconCopy, IconMore, Menu, MenuItem, cx } from "@vtt/ui";
import { homebrewApi, type HomebrewRecordDocument, type HomebrewRevisionSummary } from "../../homebrew/api";
import type { Draft } from "../../homebrew/schema";
import type { Kind } from "../kinds";
import { whenLabel } from "../pieces";
import { CompareTable } from "./Compare";
import { historyRows, type HistoryRow } from "./history";
import { DEVICE_WORDS, compareBodies } from "./words";
import { formatDay } from "../../lib/formatWhen";

type Body = Readonly<Record<string, unknown>>;

const dayOf = (at: string) => formatDay(at);

/** A row's device in words: this device, another one, or how many wrote the edits it folds. */
const deviceWord = (row: HistoryRow) => (row.devices > 1 ? `${row.devices} devices` : DEVICE_WORDS[row.device]);

/**
 * A record's history in its side column (G pages spec 2.3): VERSIONS · {N}, one compact row each (the newest reads
 * Now), and choosing one reads it under the cyan notice with Restore this version, Back to now and Compare with now.
 * Restore puts it back as the editor's copy, which reaches players only with Update. A copy also compares against the
 * record it was made from.
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
  // One version read at a time (G pages spec 2.3); the newest row is now.
  const [readingKey, setReadingKey] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const reading = rows.find((row) => row.key === readingKey && row.revisionId !== null) ?? null;

  useEffect(() => {
    const id = reading?.revisionId;
    if (typeof id !== "number" || bodies.has(id)) return;
    let live = true;
    homebrewApi.revision(token, doc.id, id).then(
      (read) => {
        if (live) setBodies((held) => new Map(held).set(read.id, read.record));
      },
      (failure: unknown) => {
        if (live) setError(failure instanceof Error ? failure.message : "Couldn't read that version.");
      }
    );
    return () => {
      live = false;
    };
  }, [token, doc.id, reading?.revisionId, bodies]);

  const readBody = reading?.revisionId ? bodies.get(reading.revisionId) : undefined;
  const compared = readBody ? compareBodies(kind, readBody, draft) : null;
  const isNow = (row: HistoryRow) => rows[0]?.key === row.key;

  return (
    <div className="cp-historytab">
      <h3 className="cp-side-title">{`Versions · ${rows.length}`}</h3>
      {error && (
        <p className="cp-blocked" role="alert">
          {error}
        </p>
      )}
      {!revisions && !error && <p className="cp-hint">Reading the history.</p>}
      {reading && (
        // The one notice over a version being read (T rule 21): which, when, and the ways out.
        <div className="cp-version-band" role="status">
          <span className="cp-version-band-text">{`Reading ${reading.label.replace(/^Version/, "v")} · ${whenLabel(reading.at)}`}</span>
          <span className="cp-version-band-actions">
            <Button
              size="sm"
              variant="primary"
              disabled={busy || isNow(reading)}
              onClick={() => void onRestore(reading.revisionId!).then((done) => done && setReadingKey(null))}
            >
              Restore this version
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReadingKey(null)}>
              Back to now
            </Button>
            <Menu icon align="end" label="More for this version" trigger={<IconMore />}>
              <MenuItem onClick={() => setComparing((on) => !on)}>
                {comparing ? "Hide the comparison" : "Compare with now"}
              </MenuItem>
            </Menu>
          </span>
        </div>
      )}
      {reading && comparing && (
        <>
          {!compared ? (
            <p className="cp-hint">Reading the version.</p>
          ) : compared.length === 0 ? (
            <p className="cp-hint">No field differs from now.</p>
          ) : (
            <CompareTable
              rows={compared}
              leftLabel={reading.label}
              rightLabel="Now"
              caption={`${reading.label} beside now`}
            />
          )}
        </>
      )}
      {revisions && (
        <ul className="cp-histlist" aria-label="Versions and edits">
          {rows.map((row) => {
            const on = reading?.key === row.key;
            return (
              <li key={row.key}>
                <button
                  type="button"
                  className={cx("cp-histrow", on && "is-on")}
                  aria-current={on ? "true" : undefined}
                  disabled={row.revisionId === null}
                  onClick={() => {
                    setComparing(false);
                    setReadingKey(on ? null : row.key);
                  }}
                >
                  <span className={cx("cp-histrow-n", row.notLive && "cp-caution")}>
                    {isNow(row) ? "Now" : row.version !== null ? `v${row.version}` : "Edit"}
                  </span>
                  <span className="cp-histrow-when">{whenLabel(row.at)}</span>
                  <span className="cp-histrow-what">{row.changed.join(", ") || row.label}</span>
                </button>
                {/* A phone opens the chosen version under its row with Restore. */}
                {phone && on && (
                  <div className="cp-histrow-open">
                    <small>{`${deviceWord(row)} · ${row.changed.join(", ") || "Nothing changed"}`}</small>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy || isNow(row)}
                      onClick={() => void onRestore(row.revisionId!)}
                    >
                      Restore this version
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {doc.pendingChanges && (
        <div className="cp-actions-row">
          <Button size="sm" disabled={busy} onClick={onDiscard}>
            Discard the changes
          </Button>
        </div>
      )}
      <p className="cp-hint">
        Restore puts it back as{" "}
        {doc.state === "published" ? "changes not live. Players get it with Update." : "the draft."}
      </p>
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
  const body = useOriginalBody(token, source);
  const srd = source.source === "srd";
  const rows = body && body !== "gone" ? compareBodies(kind, body, draft) : [];
  return (
    <section className="cp-basedon" aria-label="Based on">
      <div className="cp-mrow">
        <IconCopy />
        <span className="cp-grow">
          Based on <b>{source.name}</b> ({srd ? "SRD 5.2.1" : "homebrew"}), copied {dayOf(source.copiedAt)}
        </span>
        <Button size="sm" onClick={() => onOpen(source)}>
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

/** The record a copy was made from, read once: its body, null while it reads, or "gone" when it no longer reads. */
export function useOriginalBody(
  token: string,
  source: NonNullable<HomebrewRecordDocument["basedOn"]> | null
): Body | null | "gone" {
  const [body, setBody] = useState<Body | null | "gone">(null);
  const which = source?.source ?? null;
  const id = source?.id ?? null;
  useEffect(() => {
    if (!which || !id) return;
    let live = true;
    const read =
      which === "srd"
        ? homebrewApi.srdRecord(token, id).then((answer) => answer.record)
        : homebrewApi.get(token, id).then((answer) => answer.record);
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
  }, [token, which, id]);
  return body;
}
