import type { GmView } from "@vtt/domain";
import { Avatar, type AvatarPresence } from "@vtt/ui";
import { useActorPicture, type PicturedActor } from "./actor-picture";

/**
 * An actor's round picture for rosters and lists: its token art when the viewer's token can fetch it, over its
 * default avatar. One per actor, because the art hook can't run in a loop.
 */
export function ActorAvatar({
  actor,
  name,
  token,
  definitions,
  size,
  presence,
  className
}: Readonly<{
  actor: PicturedActor;
  name: string;
  /** The viewer's bearer, for the token art; leave it out to show the default avatar alone. */
  token?: string | null;
  definitions?: GmView["definitions"];
  size?: "sm" | "md" | "lg";
  presence?: AvatarPresence;
  className?: string;
}>) {
  const picture = useActorPicture(actor, token, definitions);
  return <Avatar name={name} picture={picture} size={size} presence={presence} className={className} />;
}
