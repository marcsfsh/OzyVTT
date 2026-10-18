import type { GmView, PlayerView } from "@vtt/domain";
import type { MapSelection } from "../maps/map-catalog";
import { GmEncounterPanel, type GmPanelSlots } from "./GmEncounterPanel";
import { PlayerEncounterPanel, type PlayerPanelSlots } from "./PlayerEncounterPanel";
import "./encounter-panel.css";

type GmProps = Readonly<{
  role: "gm";
  state: GmView;
  selectedMap: MapSelection | null;
  mapLibrary?: readonly MapSelection[];
  onSelectMap?: (map: MapSelection | null) => void;
  phone?: boolean;
  slots?: GmPanelSlots;
}>;
type PlayerProps = Readonly<{
  role: "player";
  state: PlayerView;
  phone?: boolean;
  slots?: PlayerPanelSlots;
  onSheetShown?: (shown: boolean) => void;
}>;

/** The table's panel: the GM runs the fight from it; a player follows it and acts on their turn. */
export function EncounterPanel(props: GmProps | PlayerProps) {
  if (props.role === "player")
    return (
      <PlayerEncounterPanel
        state={props.state}
        phone={props.phone}
        slots={props.slots}
        onSheetShown={props.onSheetShown}
      />
    );
  return (
    <GmEncounterPanel
      state={props.state}
      selectedMap={props.selectedMap}
      mapLibrary={props.mapLibrary}
      onSelectMap={props.onSelectMap}
      phone={props.phone}
      slots={props.slots}
    />
  );
}
