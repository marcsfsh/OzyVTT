import { useState } from "react";
import type { AskableCommand, GmView, PlayerView } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import { clearBlockedPrompt, useTargetingBlocked } from "./targeting";

/**
 * ASKING THE GM (B1) — the client half of a feature whose server half has been finished for a while.
 *
 * With the rules assistant on Enforce the server refuses an illegal move, and `rules.ask` lets the
 * player park that exact command for the GM to allow or deny. The commands, the projections and the
 * authorization were all in place; there was no interface, and the ledger claimed there was. Worse,
 * on the action path the player saw NOTHING at all: the resolve deliberately suppresses its message
 * when the rejection is a rules block, because the GM's runner shows a dialog instead — and the
 * player's runner never read that store. A blocked player got a button that did nothing.
 *
 * What each side may know is set by the projection, not by these components. A player's copy of an
 * ask carries no `command` — only the rule, the family, the sentence and when it was asked — so the
 * player's rows cannot name a target or a position, and do not try to. The public shared screen
 * carries nothing about asks at all.
 */

/**
 * The words are the table's (D28): a character, a fight, and the dial the GM set is "Enforce".
 *
 * `createdAt` is an ISO datetime string, not an epoch number — the ask schema differs from its
 * neighbours in the same file, several of which use a numeric stamp. An unparseable value degrades to
 * "just now" rather than rendering NaN at the player.
 */
function askedAgo(createdAt: string): string {
  const asked = Date.parse(createdAt);
  if (Number.isNaN(asked)) return "just now";
  const seconds = Math.max(0, Math.round((Date.now() - asked) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
}

/**
 * The player's prompt, shown where the refusal happened. It is the ONLY place a blocked player learns
 * the move was refused on the action path, so it states the reason before it offers the ask.
 */
export function AskTheGmPrompt({ onFeedback }: Readonly<{ onFeedback: (message: string) => void }>) {
  const blocked = useTargetingBlocked();
  const [busy, setBusy] = useState(false);
  if (!blocked) return null;
  const ask = () => {
    setBusy(true);
    socket.emit("rules:ask", { commandId: newId(), type: blocked.asked.type as AskableCommand, payload: blocked.asked.payload },
      (result: { ok: boolean; message?: string; ran?: boolean }) => {
        setBusy(false);
        if (!result.ok) { onFeedback(result.message ?? "That question could not be sent."); return; }
        // The server re-runs the command under the asker before parking it: if the table moved on and
        // it is legal now, it simply happens and there is nothing to wait for. Say which occurred.
        onFeedback(result.ran ? "That worked this time - no question needed." : "Asked the GM. Waiting for their call.");
        clearBlockedPrompt();
      });
  };
  return <div className="rule-ask rule-ask-blocked" role="status">
    <p className="rule-ask-reason">{blocked.blocked.message}</p>
    <div className="rule-ask-actions">
      <Button variant="primary" size="sm" disabled={busy} onClick={ask}>{busy ? "Asking…" : "Ask the GM"}</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={clearBlockedPrompt}>Never mind</Button>
    </div>
  </div>;
}

/** The player's own waiting questions. Their projection carries no payload, so this says only what it may. */
export function MyPendingAsks({ state }: Readonly<{ state: PlayerView }>) {
  const asks = state.combat.pendingRuleAsks ?? [];
  if (asks.length === 0) return null;
  return <ul className="rule-ask-list" aria-label="Questions waiting on the GM">
    {asks.map((ask) => <li key={ask.id} className="rule-ask rule-ask-waiting">
      <p className="rule-ask-reason">{ask.message}</p>
      <p className="rule-ask-meta">Waiting on the GM · asked {askedAgo(ask.createdAt)}</p>
    </li>)}
  </ul>;
}

/**
 * The GM's queue. Allow replays the parked command under GM authority; Deny drops it. An Allow can
 * legitimately FAIL — the ask survives a turn advancing and the replay runs against current state — so
 * the failure is surfaced and the question stays put rather than vanishing as if it had been answered.
 */
export function PendingAsksForGm({ state, onFeedback }: Readonly<{ state: GmView; onFeedback: (message: string) => void }>) {
  const asks = state.combat.pendingRuleAsks ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  if (asks.length === 0) return null;
  const answer = (askId: string, allow: boolean, name: string) => {
    setBusyId(askId);
    socket.emit("rules:answer", { commandId: newId(), askId, allow }, (result: { ok: boolean; message?: string }) => {
      setBusyId(null);
      if (!result.ok) { onFeedback(result.message ?? "That answer did not go through."); return; }
      onFeedback(allow ? `Allowed ${name}'s move.` : `Declined ${name}'s move.`);
    });
  };
  return <ul className="rule-ask-list" aria-label="Questions from players">
    {asks.map((ask) => {
      const actor = state.actors.find((candidate) => candidate.id === ask.actorId);
      const name = actor?.name ?? "A character";
      return <li key={ask.id} className="rule-ask rule-ask-question">
        <p className="rule-ask-who"><strong>{name}</strong> is asking</p>
        <p className="rule-ask-reason">{ask.message}</p>
        <div className="rule-ask-actions">
          <Button variant="primary" size="sm" disabled={busyId === ask.id} onClick={() => answer(ask.id, true, name)}>Allow</Button>
          <Button variant="secondary" size="sm" disabled={busyId === ask.id} onClick={() => answer(ask.id, false, name)}>Deny</Button>
        </div>
      </li>;
    })}
  </ul>;
}
