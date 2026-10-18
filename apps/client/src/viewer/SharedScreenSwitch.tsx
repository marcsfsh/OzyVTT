import { IconScene, IconVolume, SegmentedControl } from "@vtt/ui";
import { navigate, pathForGmTab, SOUND_BOARD_PATH } from "../router";

/** The Shared screen tab's two views: what the table screen shows, and what it plays. */
export function SharedScreenSwitch({ current }: Readonly<{ current: "display" | "sound" }>) {
  return (
    <SegmentedControl
      className="shared-screen-switch"
      ariaLabel="Shared screen controls"
      value={current}
      onChange={(value) => navigate(value === "sound" ? SOUND_BOARD_PATH : pathForGmTab("viewer"))}
      options={[
        { value: "display", label: "Display", icon: <IconScene /> },
        { value: "sound", label: "Sound", icon: <IconVolume /> }
      ]}
    />
  );
}
