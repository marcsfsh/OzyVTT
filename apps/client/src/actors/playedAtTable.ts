import type { GmActor } from "@vtt/domain";
import { command } from "../lib/command";

/** Why the GM can't mark this character played at the table, or null when they can (ADR-0042). */
export function atTableBlocked(actor: Pick<GmActor, "name" | "ownerSessionId" | "playedAtTable">): string | null {
  return actor.ownerSessionId !== null && actor.playedAtTable !== true
    ? `${actor.name} is claimed on a player's device. Release the claim to play ${actor.name} at the table.`
    : null;
}

/** Marks a party character played at the table, or on its player's device; the server refuses a claimed one. */
export async function setPlayedAtTable(actorId: string, on: boolean): Promise<string | null> {
  const result = await command("actor:set-played-at-table", { actorId, playedAtTable: on });
  return result.ok ? null : (result.message ?? "That change was rejected.");
}
