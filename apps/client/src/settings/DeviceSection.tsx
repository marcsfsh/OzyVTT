import { Button, SegmentedControl, Switch, ThemeToggle } from "@vtt/ui";
import { useRollPreference } from "../dice/roll-preference";
import { setAutoArrange, setPinchZoom, useAutoArrange, usePinchZoom } from "./preferences";
import { SETTING } from "./sections";
import { SettingRow, SettingsSection } from "./SettingRow";

/**
 * Device: what this browser chooses for itself, for every role. The GM's arranging choice sits here because it is
 * kept on this device, and a player's way out of the table is the last row.
 */
export function DeviceSection({
  role,
  onLeave
}: Readonly<{
  role: "gm" | "player";
  /** A player leaving the table; asks first. */
  onLeave?: () => void;
}>) {
  const { rollInput, mayType, setRollInput } = useRollPreference();
  const autoArrange = useAutoArrange();
  const pinchZoom = usePinchZoom();
  return (
    <SettingsSection id="device" gmOnly={false}>
      <SettingRow setting={SETTING.theme} stacked>
        <ThemeToggle />
      </SettingRow>
      {/* The GM's table setting outranks this device's choice, so the reason replaces the control. */}
      {mayType ? (
        <SettingRow setting={SETTING.rollInput}>
          <SegmentedControl
            ariaLabel="How you roll"
            value={rollInput}
            onChange={(value) => setRollInput(value as "digital" | "manual")}
            options={[
              { value: "digital", label: "Auto-roll" },
              { value: "manual", label: "I roll my dice" }
            ]}
          />
        </SettingRow>
      ) : (
        <SettingRow
          setting={SETTING.rollInput}
          hint="At this table the server rolls players' dice, and only the GM can change that."
        />
      )}
      <SettingRow setting={SETTING.pinchZoom}>
        <Switch checked={pinchZoom} onChange={setPinchZoom} label="Let pinch zoom the page" />
      </SettingRow>
      {role === "gm" && (
        <SettingRow setting={SETTING.arrangeScenes} gmOnly>
          <Switch checked={autoArrange} onChange={setAutoArrange} label="Open new scenes for arranging" />
        </SettingRow>
      )}
      {role === "player" && onLeave && (
        <SettingRow setting={SETTING.leaveTable}>
          <Button variant="secondary" onClick={onLeave}>
            Leave table
          </Button>
        </SettingRow>
      )}
    </SettingsSection>
  );
}
