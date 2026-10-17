import { useState } from "react";
import type { ContentActionSummary, GmActor, GmView } from "@vtt/domain";
import { IconChevron, IconSparkle } from "@vtt/ui";
import { ActionRow } from "./ActionRow";
import { actionSummaryParts, tagLabel } from "./action-summary";
import { RichText } from "./RichText";
import { SpellcastingText } from "./spells";

/* A limited use is itself the mechanic (`resolveDefinitionAction`): Action Surge, Indomitable and
   similar have a counter and nothing to roll. Both predicates must mirror the server's. */
const isResolvable = (action: ContentActionSummary) =>
  action.attackBonus !== null ||
  action.saveAbility !== null ||
  action.damage.length > 0 ||
  action.grants ||
  action.multiattack !== null ||
  action.usesLimit !== null ||
  action.builtin === true;
/** Rage/Reckless (grants), a Multiattack plan, a spent charge, and no-target builtins (Dodge, Hide) resolve with a single Use tap; single-target builtins (Help, Unarmed Strike) go through targeting, as do check actions that ask for a skill (Search, Study). */
const isTargetless = (action: ContentActionSummary) =>
  action.checkSkills === undefined &&
  action.attackBonus === null &&
  action.saveAbility === null &&
  action.damage.length === 0 &&
  action.targeting !== "single" &&
  action.targeting !== "multi" &&
  (action.grants || action.multiattack !== null || action.usesLimit !== null || action.builtin === true);

/**
 * Client-side availability hint (ADR-0020). The server decides: rows stay tappable and a
 * strict-mode rejection opens the audited override.
 */
function availabilityHint(state: GmView, actor: GmActor, action: ContentActionSummary): string | null {
  if (action.requiresEffectTag && !actor.effects.some((effect) => effect.tags.includes(action.requiresEffectTag!)))
    return `Needs ${tagLabel(action.requiresEffectTag)}`;
  if (action.legendaryCost !== undefined) {
    if (state.combat.turnActorId === actor.id) return "On another creature's turn";
    const perRound = actor.legendary?.actionsPerRound ?? 3;
    if ((state.combat.legendaryUsed[actor.id] ?? 0) + action.legendaryCost > perRound)
      return "No legendary actions left this round";
  }
  if (action.usesLimit !== null && action.usesPer !== null) {
    const key = action.usesPool ?? action.id;
    const spent =
      action.usesPer === "turn"
        ? (state.combat.turn.turnUses[`${actor.id}:${key}`] ?? 0)
        : (actor.actionUses[key] ?? 0);
    if (spent >= action.usesLimit)
      return action.usesPer === "recharge"
        ? `Spent - recharges on ${action.usesRecharge}+ at its turn start`
        : "No uses left";
  }
  const myTurn = state.combat.turnActorId === actor.id;
  if (!myTurn) return null;
  const turn = state.combat.turn;
  // An open compound bonus action (Flurry of Blows) pays for its strikes before any slot is asked.
  const bonusOpen = turn.bonusActionInstance?.actorId === actor.id ? turn.bonusActionInstance.components : null;
  const fromBonus =
    bonusOpen && !action.multiattack
      ? (bonusOpen[action.id] ?? 0) + (action.attackBonus !== null ? (bonusOpen["attack"] ?? 0) : 0)
      : 0;
  if (fromBonus > 0) return `${fromBonus} left from the bonus action`;
  if (action.activation === "bonus-action" && turn.bonusActionUsed) return "Bonus action used";
  if (action.activation === "action" && turn.actionUsed) {
    const instance = turn.actionInstance?.actorId === actor.id ? turn.actionInstance.components : null;
    // The Multiattack plan row stays a live "continue" while any component remains.
    if (action.multiattack && instance && Object.values(instance).some((count) => count > 0))
      return "In progress - pick the next attack";
    const remaining = instance
      ? (instance[action.id] ?? 0) + (action.attackBonus !== null ? (instance["attack"] ?? 0) : 0)
      : 0;
    if (remaining > 0) return `${remaining} attack${remaining === 1 ? "" : "s"} left`;
    return "Action used";
  }
  if (action.activation === "reaction" && state.combat.reactionsUsed.includes(actor.id)) return "Reaction used";
  return null;
}

/** The generic actions a table reaches for mid-fight; the rest sit behind "More". */
const PRIMARY_BUILTINS = ["dodge", "dash", "disengage", "help", "hide"] as const;

/**
 * A stat block's actions in three tiers: its own rollable actions as full rows, the shared builtins
 * (Dodge, Dash, Unarmed Strike...) as one cluster of chips, and prose traits behind one line, with
 * Spellcasting hoisted out and shown open because it is read mid-fight.
 */
export function GmActionList({
  state,
  actor,
  actions,
  busy,
  onUse
}: Readonly<{
  state: GmView;
  actor: GmActor;
  actions: readonly ContentActionSummary[];
  busy: boolean;
  /** Resolves a targetless action at once, or starts targeting for the rest. */
  onUse: (action: ContentActionSummary, targetless: boolean) => void;
}>) {
  const [openReference, setOpenReference] = useState<string | null>(null);
  const [moreBuiltins, setMoreBuiltins] = useState(false);
  const own = actions.filter((action) => isResolvable(action) && action.builtin !== true);
  const builtins = actions.filter((action) => isResolvable(action) && action.builtin === true);
  const reference = actions.filter((action) => !isResolvable(action));
  // Spellcasting is the reference entry read mid-fight, so it is hoisted out and shown open.
  const spellcasting = reference.find((action) => action.id === "spellcasting" || /spellcasting/i.test(action.name));
  const otherReference = reference.filter((action) => action !== spellcasting);
  return (
    <>
      <ul className="action-list">
        {own.map((action) => {
          const hint = availabilityHint(state, actor, action);
          return (
            <li key={action.id}>
              <ActionRow
                action={action}
                parts={actionSummaryParts(action, actions)}
                note={action.grants ? "Grants an effect" : "Tap to use"}
                hint={hint}
                disabled={busy}
                onUse={() => onUse(action, isTargetless(action))}
              />
            </li>
          );
        })}
      </ul>
      {builtins.length > 0 &&
        (() => {
          const primary = PRIMARY_BUILTINS.flatMap((id) => builtins.filter((action) => action.id === id));
          const rest = builtins.filter((action) => !(PRIMARY_BUILTINS as readonly string[]).includes(action.id));
          const shown = moreBuiltins ? [...primary, ...rest] : primary.length > 0 ? primary : builtins;
          return (
            <div className="builtin-actions" role="group" aria-label="Common actions">
              <span className="builtin-actions-label">Common</span>
              {shown.map((action) => {
                const hint = availabilityHint(state, actor, action);
                return (
                  <button
                    key={action.id}
                    type="button"
                    className={`builtin-chip${hint ? " hinted" : ""}`}
                    disabled={busy}
                    title={`${action.description}${hint ? `\n\n${hint}` : ""}`}
                    onClick={() => onUse(action, isTargetless(action))}
                  >
                    {action.name}
                  </button>
                );
              })}
              {rest.length > 0 && primary.length > 0 && (
                <button
                  type="button"
                  className="builtin-chip builtin-more"
                  aria-expanded={moreBuiltins}
                  onClick={() => setMoreBuiltins((current) => !current)}
                >
                  {moreBuiltins ? "Less" : "More"} <IconChevron className="builtin-more-caret" />
                </button>
              )}
            </div>
          );
        })()}
      {spellcasting && (
        <div className="action-spellcasting" role="group" aria-label="Spellcasting">
          <div className="action-spellcasting-head">
            <IconSparkle /> <strong>{spellcasting.name}</strong>
          </div>
          <SpellcastingText text={spellcasting.description} />
        </div>
      )}
      {otherReference.length > 0 && (
        <details className="action-reference-group">
          <summary>Traits &amp; reference ({otherReference.length})</summary>
          <ul className="action-list">
            {otherReference.map((action) => (
              <li key={action.id}>
                <button
                  type="button"
                  className="action-row action-row-static"
                  aria-expanded={openReference === action.id}
                  onClick={() => setOpenReference((current) => (current === action.id ? null : action.id))}
                >
                  <strong>{action.name}</strong>
                  <small>
                    {action.activation === "other" ? "click to read" : `${action.activation} · click to read`}
                  </small>
                </button>
                {openReference === action.id && (
                  <div className="action-reference-text">
                    <RichText text={action.description} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
