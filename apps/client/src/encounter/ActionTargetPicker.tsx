import { useId } from "react";
import { Button, Stepper } from "@vtt/ui";
import { clearTargeting, setTargetDarts, toggleTarget, type TargetingSession } from "./targeting";

/**
 * Choosing who an action targets: one (radio) or several (checkboxes), or, for an area, where to drag
 * the template on the map. Back drops the action; Roll sends it to the server.
 */
export function ActionTargetPicker({
  picking,
  targets,
  onMap = false,
  busy,
  onRoll
}: Readonly<{
  picking: TargetingSession;
  targets: ReadonlyArray<{ id: string; label: string }>;
  /** The GM can also pick by clicking tokens on the map, so the heading says so. */
  onMap?: boolean;
  busy: boolean;
  onRoll: () => void;
}>) {
  const group = useId();
  const ready = picking.mode === "template" ? Boolean(picking.template?.placed) : picking.selected.length > 0;
  const darts = picking.darts;
  const assigned = darts ? Object.values(darts.counts).reduce((sum, count) => sum + count, 0) : 0;
  return (
    <div className="action-targeting" role="group" aria-label={`Targets for ${picking.action.name}`}>
      {picking.mode === "template" ? (
        <p className="action-targeting-head">
          <strong>{picking.action.name}</strong> - drag the {picking.action.area?.sizeFeet}-ft{" "}
          {picking.action.area?.shape} on the map
          {picking.template?.placed ? " (placed - Roll to resolve)" : ", then Roll"}. Everyone under it is caught
          automatically.
        </p>
      ) : (
        <>
          <p className="action-targeting-head">
            <strong>{picking.action.name}</strong> -{" "}
            {picking.mode === "single" ? "choose one target" : "choose targets"}
            {onMap ? (picking.mode === "single" ? " (or click a token)" : " (or click tokens)") : ""}
            {darts
              ? `. ${darts.total} darts: ${assigned >= darts.total ? "all assigned" : `${darts.total - Math.min(assigned, darts.total)} left, which go round the chosen targets in order`}.`
              : ""}
          </p>
          <ul className="action-target-list scroll-y">
            {targets.map((target) => (
              <li key={target.id}>
                <label className="action-target">
                  <input
                    type={picking.mode === "single" ? "radio" : "checkbox"}
                    name={group}
                    checked={picking.selected.includes(target.id)}
                    onChange={() => toggleTarget(target.id)}
                  />
                  <span>{target.label}</span>
                </label>
                {darts && picking.selected.includes(target.id) && (
                  <Stepper
                    value={darts.counts[target.id] ?? 1}
                    min={1}
                    max={darts.total}
                    aria-label={`Darts at ${target.label}`}
                    onChange={(count) => setTargetDarts(target.id, count)}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="action-targeting-buttons">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => clearTargeting()}>
          Back
        </Button>
        <button type="button" className="encounter-primary" disabled={busy || !ready} onClick={onRoll}>
          Roll {picking.action.name}
        </button>
      </div>
    </div>
  );
}
