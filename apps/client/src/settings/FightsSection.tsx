import type { GmView, RuleExceptions, RuleFamily, RuleMode } from "@vtt/domain";
import { Badge, RevealSwitch, SegmentedControl, Select, Switch } from "@vtt/ui";
import { HealthStyleOptions } from "../encounter/health-display";
import { SETTING } from "./sections";
import { SettingRow, SettingsSection } from "./SettingRow";
import {
  BADGE_AUDIENCE_REASON,
  DIAL_COPY,
  dialLabel,
  dialLine,
  HEALTH_AUDIENCE_LABEL,
  HEALTH_DISPLAY_LABEL,
  PLAYER_HITS,
  PLAYER_INITIATIVE
} from "./table-words";
import { useTableWrites } from "./table-writes";

/**
 * One toggle per server rule family, never finer: the engine classifies every rule into these six
 * (`apps/server/src/rules-families.ts`). On means the family follows the dial; off pins it Off.
 */
const FAMILY_COPY: ReadonlyArray<Readonly<{ family: RuleFamily; label: string }>> = [
  { family: "movement", label: "Check movement" },
  { family: "economy", label: "Check the action economy" },
  { family: "resources", label: "Check limited uses" },
  { family: "targeting", label: "Check targeting, range and cover" },
  { family: "slots", label: "Check spell slots and prepared spells" },
  { family: "components", label: "Check spell components" }
];

/** Fights: the rules assistant and what it checks, how players' hits, initiative and dice work, and tokens. */
export function FightsSection({ state }: Readonly<{ state: GmView }>) {
  const { send, setBuilderPolicy } = useTableWrites(state);
  const policy = state.rulesPolicy;
  const health = state.combat.healthDisplay;

  const setDial = (dial: RuleMode) =>
    send("rules:set-policy", { dial, exceptions: policy.exceptions }, "The rules setting was rejected.");
  /**
   * `off` pins that family Off whatever the dial says; otherwise the key goes, which on the wire means
   * "follow the dial". A 1:1 map onto `rulesPolicy.exceptions`.
   */
  const setException = (family: RuleFamily, off: boolean) => {
    const next: RuleExceptions = { ...policy.exceptions };
    if (off) next[family] = "freeform";
    else delete next[family];
    void send("rules:set-policy", { dial: policy.dial, exceptions: next }, "The rules exception was rejected.");
  };

  return (
    <SettingsSection id="fights" gmOnly>
      <SettingRow setting={SETTING.rulesAssistant} stacked>
        <SegmentedControl
          ariaLabel="Rules assistant"
          value={policy.dial}
          onChange={(value) => void setDial(value as RuleMode)}
          options={DIAL_COPY.map((entry) => ({ value: entry.value, label: entry.label }))}
        />
        <ul className="settings-note settings-dial-help">
          {DIAL_COPY.map((entry) => (
            <li key={entry.value}>{dialLine(entry)}</li>
          ))}
        </ul>
        <div className="settings-subpanel" role="group" aria-label="What it checks">
          <span className="settings-subhead">What it checks</span>
          {policy.dial === "freeform" && (
            <p className="settings-note">The rules assistant is Off, so it checks nothing. Choose Enforce or Advise.</p>
          )}
          {FAMILY_COPY.map(({ family, label }) => {
            const stored = policy.exceptions[family];
            return (
              <div key={family} className="settings-check">
                <Switch
                  checked={policy.dial !== "freeform" && stored !== "freeform"}
                  disabled={policy.dial === "freeform"}
                  onChange={(checks) => setException(family, !checks)}
                  label={label}
                />
                {/* A family parked at Advise while the dial says Enforce is neither on nor off, so say which. */}
                {stored && stored !== "freeform" && stored !== policy.dial && (
                  <Badge tone="info">{dialLabel(stored)}</Badge>
                )}
              </div>
            );
          })}
        </div>
      </SettingRow>

      <SettingRow setting={SETTING.playerHits}>
        <SegmentedControl
          ariaLabel={PLAYER_HITS.label}
          value={state.combat.playerDamageMode}
          onChange={(value) =>
            void send(
              "encounter:set-player-damage-mode",
              { mode: value as GmView["combat"]["playerDamageMode"] },
              "That setting was rejected."
            )
          }
          options={PLAYER_HITS.options.map((option) => ({ ...option }))}
        />
      </SettingRow>

      <SettingRow setting={SETTING.playerInitiative}>
        <SegmentedControl
          ariaLabel={PLAYER_INITIATIVE.label}
          value={state.combat.playerInitiativeMode}
          onChange={(value) =>
            void send(
              "encounter:set-player-initiative-mode",
              { mode: value as GmView["combat"]["playerInitiativeMode"] },
              "That setting was rejected."
            )
          }
          options={PLAYER_INITIATIVE.options.map((option) => ({ ...option }))}
        />
      </SettingRow>

      <SettingRow setting={SETTING.typedRolls}>
        <Switch
          checked={state.builderPolicy.typedRolls === "open"}
          onChange={(open) => void setBuilderPolicy({ typedRolls: open ? "open" : "gm-only" })}
          label="Players may type what their dice show"
        />
      </SettingRow>

      <SettingRow setting={SETTING.healthDisplay} stacked>
        <div className="settings-inline">
          <Select
            value={health.style}
            aria-label={HEALTH_DISPLAY_LABEL}
            onChange={(event) =>
              void send(
                "encounter:set-health-display",
                { style: event.target.value as typeof health.style, audience: health.audience },
                "The health display was rejected."
              )
            }
          >
            <HealthStyleOptions />
          </Select>
          <span className="settings-inline-label">{HEALTH_AUDIENCE_LABEL}</span>
          <SegmentedControl
            ariaLabel={HEALTH_AUDIENCE_LABEL}
            disabled={health.style === "band"}
            value={health.audience}
            onChange={(value) =>
              void send(
                "encounter:set-health-display",
                { style: health.style, audience: value as typeof health.audience },
                "The health display was rejected."
              )
            }
            options={[
              { value: "gm", label: "GM only" },
              { value: "all", label: "Shown to players" }
            ]}
          />
        </div>
        {health.style === "band" && <p className="settings-note">{BADGE_AUDIENCE_REASON}</p>}
      </SettingRow>

      <SettingRow setting={SETTING.newTokens}>
        {/* The words sit under the switch, so the switch stays put when they change. */}
        <RevealSwitch
          labelled
          className="settings-reveal"
          revealed={state.stagingDefaults.visibility === "public"}
          ariaLabel="New tokens shown to players"
          onChange={(revealed) =>
            void send(
              "table:set-staging-defaults",
              { visibility: revealed ? "public" : "gm-only" },
              "The staging default was rejected."
            )
          }
        />
      </SettingRow>
    </SettingsSection>
  );
}
