import { useId, useState, type ReactNode } from "react";
import { Button, IconX, Steps, cx } from "@vtt/ui";

export type FrameStep = Readonly<{
  id: string;
  label: string;
  short: string;
  state?: "done" | "incomplete";
  locked?: boolean;
  /** A done step's answer, under its name in the rail ("70 px squares · 5 ft"). */
  detail?: string;
}>;

/**
 * A map's steps (Prep frame 2.4): the record's title row, the Steps rail (240px, each done step's answer under it), the
 * step's form (380px), the map at the right, and the foot across the bottom with the way back and the step's Cup.
 * Below 980px the rail is one line ("Step 2 of 4 · Grid"), the map sits above the form while it is marked (or waits in
 * a bar that opens it full screen), and the foot stays pinned.
 */
export function EditorFrame({
  className,
  narrow,
  head,
  steps,
  current,
  onStep,
  title,
  ask,
  questions,
  foot,
  map,
  mapLabel,
  inlineMap = false,
  peek,
  mapOpen,
  onMapOpen
}: Readonly<{
  className?: string;
  narrow: boolean;
  head: ReactNode;
  steps: readonly FrameStep[];
  current: string;
  onStep: (id: string) => void;
  title: string;
  ask: string;
  questions: ReactNode;
  foot: ReactNode;
  map: ReactNode;
  mapLabel: string;
  /** The step is answered on the map (marking a grid), so a phone shows it above the questions. */
  inlineMap?: boolean;
  /** What the phone's bar over the bottom says about the map. */
  peek: Readonly<{ icon: ReactNode; name: string; detail: string }>;
  /** Whether a phone's full-screen map is open, when the questions open it themselves (Place, Draw walls). */
  mapOpen?: boolean;
  onMapOpen?: (open: boolean) => void;
}>) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = mapOpen ?? ownOpen;
  const setOpen = onMapOpen ?? setOwnOpen;
  const stripId = `sc-steps-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const index = Math.max(
    0,
    steps.findIndex((step) => step.id === current)
  );
  const reachable = steps.filter((step) => !step.locked).length - 1;
  const list = narrow ? (
    <p className="sc-steps-line" id={stripId}>
      Step {index + 1} of {steps.length} · {steps[index]?.label}
    </p>
  ) : (
    <nav className="sc-steps scroll-y" aria-label="Steps">
      <Steps
        orientation="vertical"
        ariaLabel="Steps"
        current={index}
        steps={steps.map((step) => ({
          label: step.label,
          ...(step.state ? { state: step.state } : {}),
          ...(step.detail ? { detail: step.detail } : {})
        }))}
        onStepSelect={(target) => onStep(steps[target]!.id)}
        maxSelectable={reachable}
      />
    </nav>
  );
  return (
    <div className={cx("sc-editor", narrow ? "is-narrow" : "is-wide", className)}>
      <header className="sc-editor-head">{head}</header>
      {narrow && list}
      <div className="sc-editor-body">
        {!narrow && list}
        <section className="sc-editor-questions" aria-label={title}>
          {narrow && inlineMap && <div className="sc-editor-canvas">{map}</div>}
          <div className="sc-editor-scroll scroll-y">
            <h3 className="sc-step-title">{title}</h3>
            <p className="sc-step-ask">{ask}</p>
            {questions}
          </div>
        </section>
        {!narrow && (
          <div className="sc-editor-preview" aria-label={mapLabel}>
            {map}
          </div>
        )}
      </div>
      {narrow && !inlineMap && (
        <button type="button" className="sc-peek" onClick={() => setOpen(true)} aria-label="Open the map">
          {peek.icon}
          <span className="sc-peek-text">
            <strong>{peek.name}</strong>
            <small>{peek.detail}</small>
          </span>
          <span className="sc-peek-open">Open</span>
        </button>
      )}
      {narrow && open && !inlineMap && (
        <div className="sc-mapsheet" role="dialog" aria-label={mapLabel}>
          <header className="sc-mapsheet-head">
            <strong>{peek.name}</strong>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              <IconX /> Done
            </Button>
          </header>
          <div className="sc-mapsheet-body">{map}</div>
        </div>
      )}
      {foot && <div className="sc-editor-foot">{foot}</div>}
    </div>
  );
}
