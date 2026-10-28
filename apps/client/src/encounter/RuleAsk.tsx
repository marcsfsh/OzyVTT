import { useState } from "react";
import type { AskableCommand, GmView, PlayerView } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { command } from "../lib/command";
import { clearBlockedPrompt, useTargetingBlocked } from "./targeting";
import { WaitNote } from "./WaitNote";
import "./rule-ask.css";

/**
 * Asking the GM. With the rules assistant on Enforce the server refuses an illegal move, and
 * `rules.ask` parks that exact command for the GM to allow or deny.
 *
 * What each side may see is set by the projection: a player's copy of an ask carries no `command`
 * (only the rule, family, sentence and time), so player rows cannot name a target or position. The
 * public shared screen gets nothing about asks.
 */

/**
 * `createdAt` is an ISO datetime string, unlike neighbouring numeric stamps. An unparseable value
 * reads as "a moment ago".
 */
function askedAgo(createdAt: string): string {
  const asked = Date.parse(createdAt);
  if (Number.isNaN(asked)) return "a moment ago";
  const seconds = Math.max(0, Math.round((Date.now() - asked) / 1000));
  if (seconds < 60) return "a moment ago";
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
}

/**
 * The player's prompt where the refusal happened. On the action path it is the only place a
 * blocked player learns the move was refused, so it gives the reason before offering the ask.
 */
export function AskTheGmPrompt({ onFeedback }: Readonly<{ onFeedback: (message: string) => void }>) {
  const blocked = useTargetingBlocked();
  const [busy, setBusy] = useState(false);
  if (!blocked) return null;
  const ask = () => {
    setBusy(true);
    void command("rules:ask", { type: blocked.asked.type as AskableCommand, payload: blocked.asked.payload }).then(
      (result) => {
        setBusy(false);
        if (!result.ok) {
          onFeedback(result.message ?? "That question could not be sent.");
          return;
        }
        // The server re-runs the command before parking it; if it is legal now it simply happens. Say which.
        onFeedback(
          result.ran ? "That worked this time. No question was needed." : "Asked the GM. Waiting for their call."
        );
        clearBlockedPrompt();
      }
    );
  };
  return (
    <div className="rule-ask rule-ask-blocked" role="status">
      <p className="rule-ask-reason">{blocked.blocked.message}</p>
      <div className="rule-ask-actions">
        <Button variant="primary" size="sm" disabled={busy} onClick={ask}>
          {busy ? "Asking…" : "Ask the GM"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={clearBlockedPrompt}>
          Never mind
        </Button>
      </div>
    </div>
  );
}

/** The player's own waiting questions; their projection carries no payload. */
export function MyPendingAsks({ state }: Readonly<{ state: PlayerView }>) {
  const asks = state.combat.pendingRuleAsks ?? [];
  if (asks.length === 0) return null;
  return (
    <ul className="rule-ask-list" aria-label="Questions waiting on the GM">
      {asks.map((ask) => (
        <li key={ask.id} className="rule-ask rule-ask-waiting">
          <p className="rule-ask-reason">{ask.message}</p>
          <WaitNote waiting done={null}>
            Waiting on the GM · asked {askedAgo(ask.createdAt)}
          </WaitNote>
        </li>
      ))}
    </ul>
  );
}

/**
 * The GM's queue. Allow replays the parked command with GM authority; Deny drops it. An Allow can
 * fail against current state (asks survive a turn advancing), so the failure is shown and the
 * question stays.
 */
export function PendingAsksForGm({
  state,
  onFeedback
}: Readonly<{ state: GmView; onFeedback: (message: string) => void }>) {
  const asks = state.combat.pendingRuleAsks ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  if (asks.length === 0) return null;
  const answer = (askId: string, allow: boolean, name: string) => {
    setBusyId(askId);
    void command("rules:answer", { askId, allow }).then((result) => {
      setBusyId(null);
      if (!result.ok) {
        onFeedback(result.message ?? "That answer did not go through.");
        return;
      }
      onFeedback(allow ? `Allowed ${name}'s move.` : `Declined ${name}'s move.`);
    });
  };
  return (
    <ul className="rule-ask-list" aria-label="Questions from players">
      {asks.map((ask) => {
        const actor = state.actors.find((candidate) => candidate.id === ask.actorId);
        const name = actor?.name ?? "A character";
        return (
          <li key={ask.id} className="rule-ask rule-ask-question">
            <p className="rule-ask-who">
              <strong>{name}</strong> is asking
            </p>
            <p className="rule-ask-reason">{ask.message}</p>
            <div className="rule-ask-actions">
              <Button
                variant="primary"
                size="sm"
                disabled={busyId === ask.id}
                onClick={() => answer(ask.id, true, name)}
              >
                Allow
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busyId === ask.id}
                onClick={() => answer(ask.id, false, name)}
              >
                Deny
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
