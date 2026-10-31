import { IconButton, IconLocate, IconMinus, IconPlus } from "@vtt/ui";
import "./map-controls.css";

/**
 * The map's own controls (table rule 6, ADR-0050): centre on me (the GM centres on whoever acts), zoom out and zoom in,
 * together in glass at the map's bottom right on every size. Fit map, Fullscreen and Notifications stay in View.
 */
export function MapControls({
  onCentre,
  centreLabel,
  onZoom
}: Readonly<{ onCentre?: () => void; centreLabel: string; onZoom: (factor: number) => void }>) {
  return (
    <div className="map-controls" role="group" aria-label="Map controls">
      {onCentre && (
        <IconButton label={centreLabel} size="sm" onClick={onCentre}>
          <IconLocate />
        </IconButton>
      )}
      <IconButton label="Zoom out" size="sm" onClick={() => onZoom(1 / 1.3)}>
        <IconMinus />
      </IconButton>
      <IconButton label="Zoom in" size="sm" onClick={() => onZoom(1.3)}>
        <IconPlus />
      </IconButton>
    </div>
  );
}
