/**
 * The one place the party surfaces agree on how a character READS.
 *
 * The claim words, the presence words and the HP shape were duplicated across the shell roster, the
 * Roster tab and the player bar, and they had already drifted: the GM's two roster surfaces said
 * "Available" and "Unclaimed" for the same fact, and the player surface said "Taken" for what the GM
 * called "Claimed" (intake 05 §1). D28 picks the winners — **Available / Claimed / Your character** —
 * and this module is where they live so the three surfaces cannot drift again.
 */
import type { ActorDefinition, GmActor, PlayerActor, PresenceStatus } from "@vtt/domain";
import type { AvatarPresence } from "@vtt/ui";

/** Domain presence → Avatar's dot vocabulary (reconnecting reads as "away"). */
export function presenceDot(presence: PresenceStatus): AvatarPresence {
  return presence === "online" ? "online" : presence === "reconnecting" ? "away" : "offline";
}

export function presenceLabel(presence: PresenceStatus): string {
  return presence === "online" ? "Online" : presence === "reconnecting" ? "Reconnecting" : "Offline";
}

const BAND_LABELS = { healthy: "Healthy", bloodied: "Bloodied", down: "Down" } as const;
const exactHpLabel = (hp: { current: number; maximum: number; temporary: number }) =>
  `${hp.current}/${hp.maximum}${hp.temporary > 0 ? ` +${hp.temporary}` : ""}`;

/** GM actors carry exact hp; player-view actors carry exact hp only for player characters. */
export function hpLabel(hp: GmActor["hp"] | PlayerActor["hp"]): string {
  if (!("kind" in hp)) return exactHpLabel(hp);
  return hp.kind === "band" ? BAND_LABELS[hp.band] : exactHpLabel(hp);
}

export type ClaimState = "mine" | "claimed" | "available";

/** D28's claim words. Never "Unclaimed" (the GM's Roster tab said it) and never "Taken" (the player's). */
export const CLAIM_WORD: Readonly<Record<ClaimState, string>> = {
  mine: "Your character",
  claimed: "Claimed",
  available: "Available"
};

/** The GM reads a claim off `ownerSessionId`; a player reads the projection's own `claimStatus`. */
export function claimStateOf(actor: GmActor | PlayerActor): ClaimState {
  if ("claimStatus" in actor) return actor.claimStatus;
  return actor.ownerSessionId ? "claimed" : "available";
}

/** "Fighter 7" / "Fighter 5 / Rogue 2", or null when the sheet carries no class identity. */
export function classLine(definition: ActorDefinition | undefined): string | null {
  const classes = definition?.character?.classes ?? [];
  if (classes.length === 0) return null;
  return classes.map((entry) => `${entry.name} ${entry.level}`).join(" / ");
}
