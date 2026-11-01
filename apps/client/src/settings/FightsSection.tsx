import type { DiceMode, GmView, RuleExceptions, RuleFamily, RuleMode, Targeting } from "@vtt/domain";
import { Badge, RevealSwitch, Select, Tick } from "@vtt/ui";
import { HealthStyleOptions } from "../encounter/health-display";
import { SETTING } from "./sections";
import { SettingRow, SettingsMoment, SettingsSection } from "./SettingRow";
import {
  BADGE_AUDIENCE_REASON,
  DIAL_COPY,
  DICE_MODE_HELP,
  TARGETING_HELP,
  TARGETING_OPTIONS,
  DICE_MODE_OPTIONS,
  dialLabel,
  dialLine,
  HEALTH_AUDIENCE_LABEL,
  HEALTH_DISPLAY_LABEL,
  PLAYER_HITS,
  PLAYER_INITIATIVE
} from "./table-words";
import { useTableWrites } from "./table-writes";
import { SettingChoices } from "./SettingChoices";

/**
 * One toggle per server rule family, never finer: the engine classifies every rule into these six
 * (`apps/server/src/rules-families.ts`). On means the family follows the dial; off pins it Off.
 */
export const FAMILY_COPY: ReadonlyArray<Readonly<{ family: RuleFamily; label: string }>> = [
  { family: "movement", label: "Check movement" },
  { family: "economy", label: "Check the action economy" },
  { family: "resources", label: "Check limited uses" },
  { family: "targeting", label: "Check targeting, range and cover" },
  { family: "slots", label: "Check spell slots and prepared spells" },
  { family: "components", label: "Check spell components" }
];

/** Fights: the rules assistant and what it checks, how players' hits, initiative and dice work, and tokens. */
export function FightsSection({ state }: Readonly<{ state: GmView }>) {
  const { send } = useTableWrites(state);
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
    <SettingsSection id="fights" grouped>
      {/* The eight rows by the moment each one acts in (settings spec 2.3). */}
      <SettingsMoment title="When a token is staged">
        <SettingRow level={4} setting={SETTING.newTokens}>
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
        <SettingRow level={4} setting={SETTING.healthDisplay} stacked>
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
            <SettingChoices
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
      </SettingsMoment>
      <SettingsMoment title="When dice are rolled">
        <SettingRow level={4} setting={SETTING.playerInitiative}>
          <SettingChoices
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
        <SettingRow level={4} setting={SETTING.d20Dice} stacked>
          <SettingChoices
            ariaLabel="Players' d20 rolls"
            value={state.playerDice.d20}
            onChange={(value) =>
              void send("table:set-player-dice", { d20: value as DiceMode }, "That setting was rejected.")
            }
            options={DICE_MODE_OPTIONS.map((option) => ({ ...option }))}
          />
          <p className="settings-note">{DICE_MODE_HELP[state.playerDice.d20]}</p>
        </SettingRow>
        <SettingRow level={4} setting={SETTING.damageDice} stacked>
          <SettingChoices
            ariaLabel="Players' damage"
            value={state.playerDice.damage}
            onChange={(value) =>
              void send("table:set-player-dice", { damage: value as DiceMode }, "That setting was rejected.")
            }
            options={DICE_MODE_OPTIONS.map((option) => ({ ...option }))}
          />
          <p className="settings-note">{DICE_MODE_HELP[state.playerDice.damage]}</p>
        </SettingRow>
      </SettingsMoment>
      <SettingsMoment title="On a player's turn">
        <SettingRow level={4} setting={SETTING.rulesAssistant} stacked>
          <SettingChoices
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
              <p className="settings-note">
                The rules assistant is Off, so it checks nothing. Choose Enforce or Advise.
              </p>
            )}
            {FAMILY_COPY.map(({ family, label }) => {
              const stored = policy.exceptions[family];
              return (
                <div key={family} className="settings-check">
                  <Tick
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
        <SettingRow level={4} setting={SETTING.targeting} stacked>
          <SettingChoices
            ariaLabel="Who picks targets"
            value={state.targeting}
            onChange={(value) =>
              void send("table:set-targeting", { targeting: value as Targeting }, "That setting was rejected.")
            }
            options={TARGETING_OPTIONS.map((option) => ({ ...option }))}
          />
          <p className="settings-note">{TARGETING_HELP[state.targeting]}</p>
        </SettingRow>
      </SettingsMoment>
      <SettingsMoment title="When a hit lands">
        <SettingRow level={4} setting={SETTING.playerHits}>
          <SettingChoices
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
      </SettingsMoment>
    </SettingsSection>
  );
}
