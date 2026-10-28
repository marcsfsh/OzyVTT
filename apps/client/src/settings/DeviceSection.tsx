import { Button, SegmentedControl, setReduceTransparency, Switch, ThemeToggle, useReduceTransparency } from "@vtt/ui";
import { tableDiceLine, useRollPreference } from "../dice/roll-preference";
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
  const dice = useRollPreference();
  const { rollInput, setRollInput } = dice;
  const autoArrange = useAutoArrange();
  const pinchZoom = usePinchZoom();
  const transparency = useReduceTransparency();
  return (
    <SettingsSection id="device" gmOnly={false}>
      <SettingRow setting={SETTING.theme} stacked>
        <ThemeToggle />
      </SettingRow>
      {/* A system request for reduction outranks this device's choice, so the switch shows it on and says why. */}
      <SettingRow
        setting={SETTING.reduceTransparency}
        hint={transparency.system ? "Your system asks for reduced transparency, so panels stay solid." : undefined}
      >
        <Switch
          checked={transparency.setting || transparency.system}
          disabled={transparency.system}
          onChange={setReduceTransparency}
          label="Reduce transparency"
        />
      </SettingRow>
      {/* A player's dice follow the table's mode, so the rule replaces the control. */}
      {dice.chooses ? (
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
        <SettingRow setting={SETTING.rollInput} hint={tableDiceLine(dice)} />
      )}
      <SettingRow setting={SETTING.pinchZoom}>
        <Switch checked={pinchZoom} onChange={setPinchZoom} label="Let pinch zoom the page" />
      </SettingRow>
      {role === "gm" && (
        <SettingRow setting={SETTING.arrangeScenes} gmOnly>
          <Switch checked={autoArrange} onChange={setAutoArrange} label="Open new encounters for arranging" />
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
