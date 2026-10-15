import "./dock-picker.css";

export const DOCK_POSITIONS = ["sidebar", "left", "right"] as const;
export type DockPosition = (typeof DOCK_POSITIONS)[number];
export type DockControl = Readonly<{ position: DockPosition; onChange: (position: DockPosition) => void }>;

// Each glyph is a square with the shaded half on the edge the panel docks to, plus "sidebar" to pop
// it back beside the map. Docked width is adjusted by dragging the panel's inner edge.
const DOCK_CHOICES: ReadonlyArray<{ value: DockPosition; glyph: string; label: string }> = [
  { value: "left", glyph: "◧", label: "Dock left of the map" },
  { value: "right", glyph: "◨", label: "Dock right of the map" },
  { value: "sidebar", glyph: "▦", label: "Move back to the sidebar" }
];
// Compact position picker on its own row. Docked edges use fixed rem sizes, so the panel does not
// reflow when the window resizes.
export function DockPicker({ dock }: Readonly<{ dock?: DockControl }>) {
  if (!dock) return null;
  return (
    <div className="encounter-dock-picker" role="group" aria-label="Panel position">
      <span className="encounter-dock-label">Dock</span>
      {DOCK_CHOICES.map((choice) => (
        <button
          key={choice.value}
          type="button"
          className="encounter-dock-choice"
          aria-pressed={dock.position === choice.value}
          aria-label={choice.label}
          title={choice.label}
          onClick={() => dock.onChange(choice.value)}
        >
          {choice.glyph}
        </button>
      ))}
    </div>
  );
}
