import { cx } from "@vtt/ui";
import { diffWords, type CompareRow, type DiffRun } from "./words";

function Runs({ runs, mark }: Readonly<{ runs: readonly DiffRun[]; mark: "ins" | "del" }>) {
  return (
    <>
      {runs.map((run, index) =>
        run.changed ? (
          mark === "ins" ? (
            <ins key={index} className="cp-ins">
              {run.text}
            </ins>
          ) : (
            <del key={index} className="cp-del">
              {run.text}
            </del>
          )
        ) : (
          <span key={index}>{run.text}</span>
        )
      )}
    </>
  );
}

/**
 * Two bodies of one record side by side, field by field, the changed words marked: a version against the changes not
 * live, or a copy against the record it was made from. On a phone each field stacks its two values.
 */
export function CompareTable({
  rows,
  leftLabel,
  rightLabel,
  caption
}: Readonly<{ rows: readonly CompareRow[]; leftLabel: string; rightLabel: string; caption: string }>) {
  return (
    <table className="cp-compare">
      <caption className="nh-sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">{leftLabel}</th>
          <th scope="col">{rightLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const diff = row.changed ? diffWords(row.left, row.right) : null;
          return (
            <tr key={row.key} className={cx(row.changed && "is-changed")}>
              <th scope="row">{row.label}</th>
              <td data-label={leftLabel}>{diff ? <Runs runs={diff.left} mark="del" /> : row.left}</td>
              <td data-label={rightLabel}>{diff ? <Runs runs={diff.right} mark="ins" /> : row.right}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
