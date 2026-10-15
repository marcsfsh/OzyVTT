import { useEffect, useMemo, useRef, useState } from "react";
import { type ActorDefinition, type ContentActionSummary } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { AskTheGmPrompt } from "./RuleAsk";
import { signed } from "./format";
import {
  beginTargeting,
  clearTargeting,
  resolveActionDirect,
  resolveTargeting,
  setTargetingResult,
  toggleTarget,
  useTargeting,
  useTargetingBusy,
  useTargetingResult
} from "./targeting";

/** Maps a player's own stat-block action onto the ContentActionSummary the targeting store uses.
 *  Area templates are dropped: players target by explicit ids; the GM places AoE templates. */
export function summaryOfOwnAction(action: ActorDefinition["actions"][number]): ContentActionSummary {
  return {
    id: action.id,
    name: action.name,
    activation: action.activation,
    description: action.description,
    attackBonus: action.attack?.bonus ?? null,
    reachFeet: action.attack?.reachFeet ?? null,
    rangeFeet: action.attack?.rangeFeet ?? null,
    rangeNormalFeet: action.attack?.rangeNormalFeet ?? null,
    saveAbility: action.save?.ability ?? null,
    saveDc: action.save?.dc ?? null,
    damage: action.damage.map((part) => ({ formula: part.formula, type: part.type })),
    area: null,
    attackCount: action.attack?.count ?? null,
    usesLimit: action.uses?.limit ?? null,
    usesPer: action.uses?.per ?? null,
    usesRecharge: action.uses?.recharge ?? null,
    usesPool: action.uses?.pool ?? null,
    requiresEffectTag: action.requiresEffectTag ?? null,
    multiattack: action.multiattack
      ? action.multiattack.map((component) => ({ actionId: component.actionId, count: component.count }))
      : null,
    grants: action.grants !== undefined,
    reaction: action.reaction ?? null
  };
}
function ownActionSummaryParts(action: ContentActionSummary): string[] {
  const parts: string[] = [];
  if (action.attackBonus !== null)
    parts.push(
      `${signed(action.attackBonus)} to hit${action.reachFeet ? `, reach ${action.reachFeet} ft` : action.rangeFeet ? `, range ${action.rangeFeet} ft` : ""}`
    );
  if (action.attackCount !== null && action.attackCount > 1) parts.push(`${action.attackCount} attacks`);
  if (action.saveAbility !== null) parts.push(`DC ${action.saveDc} ${action.saveAbility.toUpperCase()} save`);
  for (const part of action.damage) parts.push(`${part.formula} ${part.type} damage`);
  // The charge pool: a limited-use feature has no roll, so this line is its mechanic.
  if (action.usesLimit !== null)
    parts.push(
      action.usesPer === "recharge"
        ? `Recharge ${action.usesRecharge}${(action.usesRecharge ?? 6) < 6 ? "-6" : ""}`
        : `${action.usesLimit}/${action.usesPer === "long-rest" ? "long rest" : action.usesPer === "short-rest" ? "short rest" : action.usesPer}`
    );
  return parts;
}

/**
 * A player's action console on their own turn, mirroring the GM's ActionRunner for their claimed
 * character: pick an action and targets, preview the d20 (Adv/Disadv or a typed die), and confirm.
 * Per the table's player-damage policy the server either hands the damage to the GM (proposal) or
 * applies it (direct); the player never applies damage directly.
 */
export function PlayerActionRunner({
  actorId,
  definition,
  extraActions = [],
  revision,
  rollMode,
  bonusMode,
  playerDamageMode,
  targets
}: Readonly<{
  actorId: string;
  definition: ActorDefinition;
  /** Actions the server derived from the equipped loadout (a wand's charge, an amulet's cast); they are never in `definition.actions`. Numbers include item riders; resolution goes by id. */ extraActions?: readonly ContentActionSummary[];
  revision: number;
  rollMode: "auto" | "manual";
  bonusMode: "auto" | "total";
  playerDamageMode: "proposal" | "direct";
  targets: readonly { actorId: string; name: string }[];
}>) {
  const [feedback, setFeedback] = useState("");
  const onFeedback = setFeedback;
  // A limited use is a structured effect the server resolves, so Action Surge and the like get a
  // targetless Use tap here too.
  const actions = useMemo(
    () => [
      ...definition.actions
        .filter((action) => action.attack || action.save || action.damage.length > 0 || action.uses !== undefined)
        .map(summaryOfOwnAction),
      // Item-derived actions are appended: their `item-<inventory id>` keys cannot collide with
      // stat-block ids.
      ...extraActions.filter(
        (action) =>
          action.attackBonus !== null ||
          action.saveAbility !== null ||
          action.damage.length > 0 ||
          action.usesLimit !== null
      )
    ],
    [definition, extraActions]
  );
  const isTargetlessOwn = (action: ContentActionSummary) =>
    action.attackBonus === null &&
    action.saveAbility === null &&
    action.damage.length === 0 &&
    action.usesLimit !== null;
  const session = useTargeting();
  const result = useTargetingResult();
  const busy = useTargetingBusy();
  const [attackDie, setAttackDie] = useState("");
  const [manualSubmitted, setManualSubmitted] = useState(false);
  // In "final total" manual mode a natural 20 cannot be read off the number, so it is declared here.
  const [attackNat20, setAttackNat20] = useState(false);
  // Whether the current preview came from a hand-entered total, so Confirm re-sends matching inputs
  // (attackTotal + critical vs attackNatural).
  const [previewIsTotal, setPreviewIsTotal] = useState(false);
  // This runner owns the shared targeting only when the session is for this character.
  const picking = session && session.attackerId === actorId ? session : null;
  // The turn moved off this character (or the panel closed): drop any targeting/result.
  useEffect(
    () => () => {
      clearTargeting();
      setTargetingResult(null);
    },
    []
  );
  // Reset the manual d20 field only when a new preview first appears, not on adv/disadv re-previews.
  const previewShownRef = useRef(false);
  useEffect(() => {
    const showing = Boolean(result?.preview);
    if (showing && !previewShownRef.current) {
      setAttackDie("");
      setManualSubmitted(false);
      setAttackNat20(false);
      setPreviewIsTotal(false);
    }
    previewShownRef.current = showing;
  }, [result]);

  if (actions.length === 0) return null;
  const onOutcome = (ok: boolean, message?: string) => {
    if (!ok && message) onFeedback(message);
  };
  const roll = (opts?: Parameters<typeof resolveTargeting>[2]) => resolveTargeting(revision, onOutcome, opts);

  return (
    <div className="action-runner player-actions">
      {/* On Enforce the resolve suppresses its own message, so the refusal and the ask are shown here. */}
      <AskTheGmPrompt onFeedback={onFeedback} />
      {!picking && !result && (
        <>
          <p className="player-actions-label">
            Your actions <span>· your turn</span>
          </p>
          <ul className="action-list">
            {actions.map((action) => {
              const parts = ownActionSummaryParts(action);
              return (
                <li key={action.id}>
                  <button
                    type="button"
                    className="action-row"
                    disabled={busy}
                    title={action.description}
                    onClick={() => {
                      setTargetingResult(null);
                      if (isTargetlessOwn(action)) resolveActionDirect(actorId, action.id, revision, onOutcome);
                      else beginTargeting(action, actorId);
                    }}
                  >
                    <strong className="action-row-name">{action.name}</strong>
                    {parts.length > 0 ? (
                      <ul className="action-row-summary">
                        {parts.map((part) => (
                          <li key={part}>{part}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="action-row-summary-note">Tap to use</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {picking && !result?.preview && (
        <div className="action-targeting" role="group" aria-label={`Targets for ${picking.action.name}`}>
          <p className="action-targeting-head">
            <strong>{picking.action.name}</strong> -{" "}
            {picking.mode === "single" ? "choose one target" : "choose targets"}
          </p>
          <ul className="action-target-list scroll-y">
            {targets
              .filter((target) => target.actorId !== actorId)
              .map((target) => {
                const checked = picking.selected.includes(target.actorId);
                return (
                  <li key={target.actorId}>
                    <label className="action-target">
                      <input
                        type={picking.mode === "single" ? "radio" : "checkbox"}
                        name="player-action-target"
                        checked={checked}
                        onChange={() => toggleTarget(target.actorId)}
                      />
                      <span>{target.name}</span>
                    </label>
                  </li>
                );
              })}
          </ul>
          <div className="action-targeting-buttons">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => clearTargeting()}>
              Back
            </Button>
            <button
              type="button"
              className="encounter-primary"
              disabled={busy || picking.selected.length === 0}
              onClick={() => roll()}
            >
              Roll {picking.action.name}
            </button>
          </div>
        </div>
      )}
      {result && (
        <div className="action-result" role="status">
          <div className="action-result-head">
            <strong>{result.actionName}</strong>
            <button
              type="button"
              className="secondary action-result-close"
              aria-label={result.preview ? "Cancel roll" : "Dismiss"}
              onClick={() => {
                setTargetingResult(null);
                if (result.preview) clearTargeting();
              }}
            >
              ✕
            </button>
          </div>
          {result.attack && (
            <p className={`action-outcome outcome-${result.attack.outcome}`}>
              {result.attack.total}
              {result.attack.targetAc !== null ? ` vs AC ${result.attack.targetAc}` : ""} -{" "}
              {result.attack.outcome === "crit"
                ? "CRITICAL HIT"
                : result.attack.outcome === "fumble"
                  ? "NATURAL 1"
                  : result.attack.outcome === "unknown"
                    ? "HIT"
                    : result.attack.outcome.toUpperCase()}
              {result.attack.naturalRoll >= 1 ? ` (nat ${result.attack.naturalRoll})` : ""} vs{" "}
              {result.attack.targetName}
            </p>
          )}
          {result.preview &&
            result.attack &&
            (() => {
              const mode = result.rollMode?.mode;
              const manualEntry = rollMode === "manual";
              // Manual entry follows the auto/total bonus toggle: "auto" types the natural d20 and the server adds
              // the bonus; "total" types the final total, with a Natural 20 checkbox for crits.
              const submitDie = () => {
                const value = Number(attackDie.trim());
                if (!Number.isInteger(value) || value < 1 || value > 20) {
                  onFeedback("Enter the attack d20 (1-20).");
                  return;
                }
                setPreviewIsTotal(false);
                setManualSubmitted(true);
                roll({ commit: false, attackNatural: value });
              };
              const submitTotal = () => {
                const value = Number(attackDie.trim());
                if (!Number.isInteger(value) || value < -50 || value > 100) {
                  onFeedback("Enter your final attack total.");
                  return;
                }
                setPreviewIsTotal(true);
                setManualSubmitted(true);
                roll({ commit: false, attackTotal: value, critical: attackNat20 });
              };
              // Confirm the shown preview with the inputs that produced it.
              const confirmShown = () =>
                previewIsTotal
                  ? roll({ commit: true, attackTotal: Number(attackDie.trim()), critical: attackNat20 })
                  : roll({ commit: true, attackNatural: result.attack!.naturalRoll });
              return (
                <div className="action-preview">
                  <div className="roll-zone">
                    <span className="save-prompt-confirm">
                      <button
                        type="button"
                        className={`save-die-mode${mode === "advantage" ? " active" : ""}`}
                        disabled={busy}
                        title="Roll two d20s and keep the higher"
                        onClick={() => {
                          setPreviewIsTotal(false);
                          setManualSubmitted(false);
                          roll({ commit: false, rollMode: "advantage" });
                        }}
                      >
                        Adv
                      </button>
                      <button
                        type="button"
                        className={`save-die-mode${mode === "disadvantage" ? " active" : ""}`}
                        disabled={busy}
                        title="Roll two d20s and keep the lower"
                        onClick={() => {
                          setPreviewIsTotal(false);
                          setManualSubmitted(false);
                          roll({ commit: false, rollMode: "disadvantage" });
                        }}
                      >
                        Disadv
                      </button>
                      <button type="button" className="encounter-primary" disabled={busy} onClick={confirmShown}>
                        Confirm{" "}
                        {result.attack!.outcome === "crit"
                          ? "crit"
                          : result.attack!.outcome === "hit" || result.attack!.outcome === "unknown"
                            ? "hit"
                            : "miss"}
                      </button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        title="Roll the attack again"
                        onClick={() => {
                          setPreviewIsTotal(false);
                          setManualSubmitted(false);
                          roll({ commit: false });
                        }}
                      >
                        Re-roll
                      </Button>
                    </span>
                    {manualEntry && <span className="roll-zone-caption">auto-roll</span>}
                  </div>
                  {manualEntry && (
                    <>
                      <div className="roll-or">
                        <span>or</span>
                      </div>
                      <div className="roll-zone">
                        <span className="roll-zone-caption">manual entry</span>
                        {bonusMode === "total" ? (
                          <span className="save-prompt-manual">
                            <input
                              type="text"
                              inputMode="numeric"
                              placeholder="type your total"
                              aria-label="Attack total"
                              value={attackDie}
                              disabled={manualSubmitted}
                              onChange={(event) => setAttackDie(event.target.value.replace(/[^0-9-]/g, ""))}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" && !manualSubmitted && attackDie.trim() !== "") submitTotal();
                              }}
                            />
                            <label className="manual-nat20">
                              <input
                                type="checkbox"
                                checked={attackNat20}
                                disabled={manualSubmitted}
                                onChange={(event) => setAttackNat20(event.target.checked)}
                              />{" "}
                              Natural 20
                            </label>
                            <span className="manual-actions">
                              {manualSubmitted ? (
                                <>
                                  <button
                                    type="button"
                                    className="encounter-primary"
                                    disabled={busy}
                                    onClick={() =>
                                      roll({
                                        commit: true,
                                        attackTotal: Number(attackDie.trim()),
                                        critical: attackNat20
                                      })
                                    }
                                  >
                                    Confirm roll
                                  </button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    disabled={busy}
                                    title="Enter a different total"
                                    onClick={() => {
                                      setAttackDie("");
                                      setManualSubmitted(false);
                                      setAttackNat20(false);
                                    }}
                                  >
                                    Re-roll
                                  </Button>
                                </>
                              ) : (
                                <button type="button" disabled={busy || attackDie.trim() === ""} onClick={submitTotal}>
                                  Use roll
                                </button>
                              )}
                            </span>
                          </span>
                        ) : (
                          <span className="save-prompt-manual">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="type the d20"
                              aria-label="Attack d20"
                              value={attackDie}
                              disabled={manualSubmitted}
                              onChange={(event) => setAttackDie(event.target.value.replace(/[^0-9]/g, ""))}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" && !manualSubmitted && attackDie.trim() !== "") submitDie();
                              }}
                            />
                            <span className="manual-actions">
                              {manualSubmitted ? (
                                <>
                                  <button
                                    type="button"
                                    className="encounter-primary"
                                    disabled={busy}
                                    onClick={() => roll({ commit: true, attackNatural: Number(attackDie.trim()) })}
                                  >
                                    Confirm roll
                                  </button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    disabled={busy}
                                    title="Enter a different d20"
                                    onClick={() => {
                                      setAttackDie("");
                                      setManualSubmitted(false);
                                    }}
                                  >
                                    Re-roll
                                  </Button>
                                </>
                              ) : (
                                <button type="button" disabled={busy || attackDie.trim() === ""} onClick={submitDie}>
                                  Use roll
                                </button>
                              )}
                            </span>
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          {result.save && (
            <p className="action-outcome">
              Each target: DC {result.save.dc} {result.save.ability.toUpperCase()} save - the GM answers these.
            </p>
          )}
          {result.damage.length > 0 &&
            !result.preview &&
            (() => {
              const breakdown = [
                ...result.damage.map((part) => `${part.formula} ${part.type} = ${part.total}`),
                ...(result.bonusDamage ?? []).map((part) => `+${part.amount} ${part.source}`)
              ].join(" + ");
              return (
                <p className="action-damage">
                  Damage: <strong>{result.damageTotal}</strong>
                  {breakdown ? ` (${breakdown})` : ""}
                  {result.crit ? " - crit dice doubled" : ""}
                </p>
              );
            })()}
          {/* Players never apply damage: a committed hit goes to the GM (proposal) or is auto-applied
          (direct), unless a target's reaction (Uncanny Dodge) parked it on a prompt instead. */}
          {!result.preview &&
            result.attack &&
            (result.attack.outcome === "hit" ||
              result.attack.outcome === "crit" ||
              result.attack.outcome === "unknown") &&
            result.damageTotal > 0 &&
            (() => {
              const reactionPrompt = result.reactionPrompts?.find(
                (candidate) => candidate.actorId === result.attack!.targetId
              );
              if (reactionPrompt)
                return (
                  <p className="action-save-note">
                    Waiting on {result.attack!.targetName}'s <strong>{reactionPrompt.actionName}</strong> - it resolves
                    in the turn order.
                  </p>
                );
              return (
                <p className="action-save-note">
                  {playerDamageMode === "direct"
                    ? `Applied to ${result.attack!.targetName}.`
                    : `Handed to the GM to apply to ${result.attack!.targetName}.`}
                </p>
              );
            })()}
        </div>
      )}
      {feedback && (
        <p className="save-prompt-outcome" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}
