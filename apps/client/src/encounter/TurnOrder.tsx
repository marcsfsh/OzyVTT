import { useState } from "react";
import type { PlayerTurnSteps } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { command } from "../lib/command";
import "./prompts.css";

type Step = PlayerTurnSteps["steps"][number];

/** A step in words: its effect or trait, and the creature it lands on when that is another. */
export const stepLabel = (step: Step) => (step.targetName ? `${step.name} on ${step.targetName}` : step.name);

/** The words over the steps: what waits, and when. */
export function turnOrderTitle(name: string, boundary: PlayerTurnSteps["boundary"]): string {
  return `Order what happens as ${name}'s turn ${boundary === "start" ? "starts" : "ends"}`;
}

/**
 * What happens at once as a turn starts or ends (SRD Simultaneous Effects), for the creature's controller to put in
 * order: each step moves earlier or later, and the answer plays them out in that order. The server checks the order
 * and runs the steps; a turn's end then passes the turn.
 */
export function TurnOrder({
  waiting,
  onFeedback
}: Readonly<{
  waiting: Pick<PlayerTurnSteps, "id" | "boundary" | "steps">;
  onFeedback: (text: string) => void;
}>) {
  const [order, setOrder] = useState<readonly string[]>(() => waiting.steps.map((step) => step.key));
  const [busy, setBusy] = useState(false);
  const byKey = new Map(waiting.steps.map((step) => [step.key, step]));
  // A new set of steps starts from the order the server listed.
  const keys = waiting.steps.map((step) => step.key);
  const current = order.length === keys.length && order.every((key) => byKey.has(key)) ? order : keys;
  const move = (index: number, by: -1 | 1) => {
    const next = [...current];
    const [step] = next.splice(index, 1);
    next.splice(index + by, 0, step!);
    setOrder(next);
  };
  const answer = () => {
    setBusy(true);
    void command("turn:order", { stepsId: waiting.id, order: [...current] }).then((result) => {
      setBusy(false);
      onFeedback(result.ok ? "They happen in that order." : (result.message ?? "That did not go through."));
    });
  };
  return (
    <div className="turn-order">
      <ol className="turn-order-steps">
        {current.map((key, index) => {
          const step = byKey.get(key)!;
          const label = stepLabel(step);
          return (
            <li key={key} className="turn-order-step">
              <span className="turn-order-name">{label}</span>
              <span className="turn-order-moves">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${label} earlier`}
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  Earlier
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${label} later`}
                  disabled={busy || index === current.length - 1}
                  onClick={() => move(index, 1)}
                >
                  Later
                </Button>
              </span>
            </li>
          );
        })}
      </ol>
      <Button size="sm" disabled={busy} onClick={answer}>
        {waiting.boundary === "end" ? "In this order, then end the turn" : "In this order"}
      </Button>
    </div>
  );
}
