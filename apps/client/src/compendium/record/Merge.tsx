import { useMemo, useState } from "react";
import { Button, IconCheck, IconWarning, cx } from "@vtt/ui";
import { withDefaults } from "../../homebrew/defaults";
import type { Draft } from "../../homebrew/schema";
import type { Kind } from "../kinds";
import type { Conflict } from "./useHomebrewRecord";
import { fieldWord, valueWords } from "./words";

type Side = "here" | "there";

/** A field one device or both changed since this editor's last save. */
export type MergeRow = Readonly<{
  key: string;
  label: string;
  here: string;
  there: string;
  changedHere: boolean;
  changedThere: boolean;
}>;

const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/** Each top-level field this device or the other changed since `base`, the copy both started from. */
export function mergeRows(kind: Kind, base: Draft, local: Draft, server: Draft): MergeRow[] {
  const keys = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(server)])];
  return keys
    .map((key) => ({
      key,
      label: fieldWord(kind, key),
      here: valueWords(local[key]),
      there: valueWords(server[key]),
      changedHere: !same(local[key], base[key]),
      changedThere: !same(server[key], base[key])
    }))
    .filter(
      (row) => (row.changedHere || row.changedThere) && !(row.changedHere && row.changedThere && row.here === row.there)
    );
}

/** What each field keeps by default: the side that changed it, and this device's copy when both did. */
export function defaultKeeps(rows: readonly MergeRow[]): Readonly<Record<string, Side>> {
  return Object.fromEntries(rows.map((row) => [row.key, row.changedHere ? "here" : "there"]));
}

/** The server's copy with the fields kept from this device laid over it. */
export function mergedDraft(local: Draft, server: Draft, keeps: Readonly<Record<string, Side>>): Draft {
  const merged: Record<string, unknown> = { ...server };
  for (const [key, side] of Object.entries(keeps)) {
    if (side !== "here") continue;
    if (key in local) merged[key] = local[key];
    else delete merged[key];
  }
  return merged;
}

const timeOf = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * A save that met a newer copy: each field either device changed, with both values and which one stays. Both changes
 * are kept by default, so the GM loses nothing by pressing the first button; Choose field by field picks per field.
 */
export function MergePanel({
  kind,
  conflict,
  base,
  local,
  phone,
  onResolve
}: Readonly<{
  kind: Kind;
  conflict: Conflict;
  /** The copy this editor last saved, which both devices changed from. */
  base: Draft;
  local: Draft;
  phone: boolean;
  onResolve: (merged: Draft) => void;
}>) {
  const server = useMemo(() => withDefaults(conflict.server.type, conflict.server.record), [conflict.server]);
  const rows = useMemo(() => mergeRows(kind, base, local, server), [kind, base, local, server]);
  const [keeps, setKeeps] = useState(() => defaultKeeps(rows));
  const [choosing, setChoosing] = useState(false);
  const keepOf = (row: MergeRow): Side => keeps[row.key] ?? (row.changedHere ? "here" : "there");
  const both = rows.filter((row) => row.changedHere && row.changedThere);
  return (
    <section className="cp-merge" aria-label="Changed on two devices">
      <div className="cp-problem cp-merge-head" role="alert">
        <IconWarning />
        <p className="cp-grow">
          <b>Changed on two devices.</b> Another device saved at {timeOf(conflict.server.updatedAt)} while this one was
          editing.
          {both.length > 0 &&
            ` Both changed ${both.map((row) => row.label).join(" and ")}; this device's ${both.length === 1 ? "value stays" : "values stay"} unless you choose.`}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="cp-hint">
          The other device changed nothing this one did. Its copy is kept with your edits on it.
        </p>
      ) : (
        <table className={cx("cp-merge-table", phone && "is-phone")}>
          <thead>
            <tr>
              <th scope="col">Field</th>
              {choosing ? (
                <>
                  <th scope="col">This device</th>
                  <th scope="col">The other device</th>
                </>
              ) : (
                <th scope="col">Keep</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const keep = keepOf(row);
              if (!choosing)
                return (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td className="cp-keep">
                      {keep === "here" ? "From this device: " : "From the other device: "}
                      <ins className="cp-ins">{keep === "here" ? row.here : row.there}</ins>{" "}
                      <IconCheck className="cp-keep-mark" />
                    </td>
                  </tr>
                );
              const option = (side: Side) => (
                <td data-label={side === "here" ? "This device" : "The other device"}>
                  <label className={cx("cp-keep-option", keep === side && "is-on")}>
                    <input
                      type="radio"
                      name={`keep-${row.key}`}
                      checked={keep === side}
                      onChange={() => setKeeps({ ...keeps, [row.key]: side })}
                    />
                    <span>{side === "here" ? row.here : row.there}</span>
                  </label>
                </td>
              );
              return (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {option("here")}
                  {option("there")}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="cp-actions-row">
        <Button
          variant="primary"
          onClick={() => onResolve(mergedDraft(local, server, choosing ? keeps : defaultKeeps(rows)))}
        >
          {choosing ? "Keep what is ticked" : "Keep both changes"}
        </Button>
        {rows.length > 0 && (
          <Button variant="secondary" onClick={() => setChoosing(!choosing)}>
            {choosing ? "Back to both changes" : "Choose field by field"}
          </Button>
        )}
      </div>
    </section>
  );
}
