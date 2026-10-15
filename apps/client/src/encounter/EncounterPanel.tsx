import type { GmView, PlayerView } from "@vtt/domain";
import type { MapSelection } from "../maps/MapManager";
import type { DockControl } from "./DockPicker";
import { GmEncounterPanel } from "./GmEncounterPanel";
import { PlayerEncounterPanel } from "./PlayerEncounterPanel";
import "./encounter-panel.css";

export { DOCK_POSITIONS, type DockPosition } from "./DockPicker";

type GmProps = Readonly<{
  role: "gm";
  state: GmView;
  selectedMap: MapSelection | null;
  mapLibrary?: readonly MapSelection[];
  onSelectMap?: (map: MapSelection | null) => void;
  dock?: DockControl;
}>;
type PlayerProps = Readonly<{ role: "player"; state: PlayerView; dock?: DockControl }>;

/** The table's turn-order panel: the GM runs the fight from it; a player follows it and acts on their turn. */
export function EncounterPanel(props: GmProps | PlayerProps) {
  if (props.role === "player") return <PlayerEncounterPanel state={props.state} dock={props.dock} />;
  return (
    <GmEncounterPanel
      state={props.state}
      selectedMap={props.selectedMap}
      mapLibrary={props.mapLibrary}
      onSelectMap={props.onSelectMap}
      dock={props.dock}
    />
  );
}
