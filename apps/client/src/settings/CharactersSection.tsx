import { useState } from "react";
import type { BuilderAbilityMethod, GmView } from "@vtt/domain";
import { Button, Input, Stepper, Switch } from "@vtt/ui";
import { SETTING } from "./sections";
import { SettingRow, SettingsSection } from "./SettingRow";
import { useTableWrites } from "./table-writes";

const ABILITY_METHODS: ReadonlyArray<Readonly<{ id: BuilderAbilityMethod; label: string }>> = [
  { id: "standard-array", label: "Standard array" },
  { id: "point-buy", label: "Point buy" },
  { id: "roll", label: "Roll" },
  { id: "custom", label: "Custom formula" }
];

/** Characters: who builds and levels them, up to which level, how scores and hit points are set, and random ones. */
export function CharactersSection({ state }: Readonly<{ state: GmView }>) {
  const { setBuilderPolicy, toast } = useTableWrites(state);
  const builder = state.builderPolicy;
  const [formula, setFormula] = useState(builder.customFormula ?? "");

  const toggleMethod = (id: BuilderAbilityMethod, on: boolean) => {
    const next = on
      ? [...builder.allowedAbilityMethods, id]
      : builder.allowedAbilityMethods.filter((method) => method !== id);
    // The server requires at least one method; refusing here explains why.
    if (next.length === 0) {
      toast("Leave the players at least one way to set ability scores.", { tone: "error" });
      return;
    }
    void setBuilderPolicy({ allowedAbilityMethods: next });
  };

  return (
    <SettingsSection id="characters" gmOnly>
      <SettingRow setting={SETTING.playerBuilder}>
        <Switch
          checked={builder.playerBuilder === "open"}
          onChange={(open) => void setBuilderPolicy({ playerBuilder: open ? "open" : "gm-only" })}
          label="Players build and level their own characters"
        />
      </SettingRow>

      <SettingRow setting={SETTING.maxLevel}>
        <Stepper
          value={builder.maxLevel}
          min={1}
          max={20}
          aria-label="Max party level"
          onChange={(maxLevel) => void setBuilderPolicy({ maxLevel })}
        />
      </SettingRow>

      <SettingRow setting={SETTING.abilityMethods} stacked>
        <div className="settings-methods" role="group" aria-label="Ability score methods">
          {ABILITY_METHODS.map((method) => (
            <Switch
              key={method.id}
              checked={builder.allowedAbilityMethods.includes(method.id)}
              onChange={(on) => toggleMethod(method.id, on)}
              label={method.label}
            />
          ))}
        </div>
        {builder.allowedAbilityMethods.includes("custom") && (
          <div className="settings-inline">
            <Input
              value={formula}
              aria-label="Custom ability formula"
              placeholder="4d6kh3"
              maxLength={160}
              onChange={(event) => setFormula(event.target.value)}
            />
            <Button
              variant="secondary"
              disabled={formula.trim() === (builder.customFormula ?? "")}
              onClick={() => void setBuilderPolicy({ customFormula: formula.trim() || null })}
            >
              Save formula
            </Button>
          </div>
        )}
      </SettingRow>

      <SettingRow setting={SETTING.hitPointRolls}>
        <Switch
          checked={builder.hitPointRollFloor === "average"}
          onChange={(raise) => void setBuilderPolicy({ hitPointRollFloor: raise ? "average" : "none" })}
          label="Raise a roll below the average"
        />
      </SettingRow>

      <SettingRow setting={SETTING.randomCharacters}>
        <Switch
          checked={builder.playerRandom === "open"}
          onChange={(open) => void setBuilderPolicy({ playerRandom: open ? "open" : "gm-only" })}
          label="Players can roll their own"
        />
      </SettingRow>
    </SettingsSection>
  );
}
