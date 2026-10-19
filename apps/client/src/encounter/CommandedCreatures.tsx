import { useState } from "react";
import { Button, useToast } from "@vtt/ui";
import type { MutationResult, PlayerActor, PlayerView } from "@vtt/domain";
import { command } from "../lib/command";
import "./commanded-creatures.css";

/** What a player's character commands (a summoned spirit, a familiar, a dominated ogre), in roster order. */
export function commandedOf(state: Pick<PlayerView, "actors">): PlayerActor[] {
  return state.actors.filter((actor): actor is PlayerActor => "commanded" in actor && actor.commanded === true);
}

const costOf = (slot: "bonus-action" | "action") => (slot === "action" ? "a Magic action" : "a Bonus Action");

/**
 * What a player's character commands, each with the orders it may be given and what each costs the character: a
 * command (Animate Dead's Bonus Action), a look through a familiar's eyes, a dismissal, or calling a familiar back
 * from its pocket dimension. The server checks each order and spends the action.
 */
export function CommandedCreatures({
  creatures,
  commanderId,
  commanderName
}: Readonly<{ creatures: readonly PlayerActor[]; commanderId: string; commanderName: string }>) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  if (creatures.length === 0) return null;
  const send = (run: () => Promise<MutationResult>, failure: string) => {
    setBusy(true);
    void run().then((result) => {
      setBusy(false);
      if (!result.ok) toast(result.message ?? failure, { tone: "error" });
    });
  };
  return (
    <section className="commanded-creatures" aria-label={`Under ${commanderName}'s command`}>
      <h3 className="commanded-title">Under {commanderName}&apos;s command</h3>
      <ul className="commanded-list">
        {creatures.map((creature) => {
          const orders = creature.orders ?? {};
          const hp = creature.hp.kind === "exact" ? `${creature.hp.current}/${creature.hp.maximum} HP` : null;
          return (
            <li key={creature.id} className="commanded-row">
              <span className="commanded-name">{creature.name}</span>
              {hp && <span className="commanded-hp">{hp}</span>}
              {orders.away && <span className="commanded-note">In its pocket dimension</span>}
              <span className="commanded-orders" role="group" aria-label={`Orders for ${creature.name}`}>
                {orders.command && !orders.away && (
                  <Button
                    size="sm"
                    disabled={busy}
                    title={`Takes ${costOf(orders.command)}`}
                    onClick={() =>
                      send(
                        () => command("summon:command", { actorId: commanderId, creatureIds: [creature.id] }),
                        "The command didn't go through."
                      )
                    }
                  >
                    Command
                  </Button>
                )}
                {orders.look && !orders.away && (
                  <Button
                    size="sm"
                    disabled={busy}
                    title="Takes a Bonus Action, until the start of your next turn"
                    onClick={() =>
                      send(() => command("summon:look", { actorId: creature.id }), "You can't see through it now.")
                    }
                  >
                    See through its eyes
                  </Button>
                )}
                {orders.away && (
                  <Button
                    size="sm"
                    disabled={busy}
                    title="Takes a Magic action"
                    onClick={() =>
                      send(() => command("summon:recall", { actorId: creature.id }), "It can't come back now.")
                    }
                  >
                    Call back
                  </Button>
                )}
                {orders.look && orders.dismiss && !orders.away && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    title={`Takes ${costOf(orders.dismiss)}`}
                    onClick={() =>
                      send(
                        () => command("summon:dismiss", { actorId: creature.id, temporary: true }),
                        "It can't be sent away now."
                      )
                    }
                  >
                    Send away
                  </Button>
                )}
                {orders.dismiss && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    title={`Takes ${costOf(orders.dismiss)}`}
                    onClick={() =>
                      send(() => command("summon:dismiss", { actorId: creature.id }), "It can't be dismissed now.")
                    }
                  >
                    Dismiss
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
