import type { GmView } from "@vtt/domain";
import { Portrait, type PortraitFrame } from "@vtt/ui";
import { useActorPicture, type PicturedActor } from "./actor-picture";

/** The side a portrait's edge shows. Hidden is the GM's mark for a creature players can't see. */
export function frameOf(
  actor: Readonly<{ kind?: string; visibility?: string }>,
  role: "gm" | "player" = "player"
): PortraitFrame {
  if (role === "gm" && actor.visibility === "gm-only") return "hidden";
  if (actor.kind === "player-character") return "party";
  if (actor.kind === "monster") return "hostile";
  return "neutral";
}

/**
 * A creature's square portrait in its frame, with its token art when the viewer's token can fetch it. One per actor,
 * because the art hook can't run in a loop.
 */
export function ActorPortrait({
  actor,
  token,
  definitions,
  frame,
  name,
  now,
  dim,
  size,
  className
}: Readonly<{
  actor: PicturedActor;
  token?: string | null;
  definitions?: GmView["definitions"];
  frame: PortraitFrame;
  /** Leave it out where the name is printed beside the portrait. */
  name?: string;
  now?: boolean;
  dim?: boolean;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}>) {
  const picture = useActorPicture(actor, token, definitions);
  return (
    <Portrait
      picture={picture}
      frame={frame}
      size={size}
      now={now}
      dim={dim}
      className={className}
      {...(name ? { name } : {})}
    />
  );
}
