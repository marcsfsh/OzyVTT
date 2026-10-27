import type { Actor, GameState } from "@vtt/domain";
import { requireActorAccess, type Initiator } from "./authorization.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * SRD 5.2.1 Heroic Inspiration: "You can't have more than one instance of Heroic Inspiration. If something gives you
 * Heroic Inspiration while you already have it, the excess is lost unless you give it to a player character who lacks
 * it." A player character that gains a second one holds it as a gift its player gives or lets go.
 */

/** The character gains Heroic Inspiration: held, or, already held by a player character, a second one to give. */
export function gainHeroicInspiration(actor: Actor): void {
  if (!actor.heroicInspiration) actor.heroicInspiration = true;
  else if (actor.kind === "player-character") actor.heroicInspirationToGive = true;
}

/**
 * Gives the second Heroic Inspiration a character holds to a player character who lacks it, or lets it go
 * (`recipientId` null). The giver's player or the GM decides. Returns the recipient's name, or null when it was let go.
 */
export function giveHeroicInspiration(
  state: GameState,
  initiator: Initiator,
  giverId: string,
  recipientId: string | null
): string | null {
  requireActorAccess(initiator, state, giverId, "resource");
  const giver = state.actors.find((actor) => actor.id === giverId);
  if (!giver) throw new CommandRejectedError("That character no longer exists.");
  if (!giver.heroicInspirationToGive)
    throw new CommandRejectedError(`${giver.name} has no second Heroic Inspiration to give.`);
  if (recipientId === null) {
    giver.heroicInspirationToGive = false;
    return null;
  }
  const recipient = state.actors.find((actor) => actor.id === recipientId);
  if (!recipient || recipient.kind !== "player-character" || recipient.archived || recipient.visibility !== "public")
    throw new CommandRejectedError("Heroic Inspiration goes to a player character in the party.");
  if (recipient.id === giver.id) throw new CommandRejectedError(`${giver.name} already has Heroic Inspiration.`);
  // A player who can't see the party's resources isn't told whether the recipient holds one: the gift goes, and one
  // given to a holder is lost, as any excess is (SRD).
  const seesResources = initiator.role === "gm" || state.partyVisibility === "sheet-and-resources";
  if (recipient.heroicInspiration && seesResources)
    throw new CommandRejectedError(
      `${recipient.name} already has Heroic Inspiration. Give it to a player character who has none, or let it go.`
    );
  recipient.heroicInspiration = true;
  giver.heroicInspirationToGive = false;
  return recipient.name;
}
