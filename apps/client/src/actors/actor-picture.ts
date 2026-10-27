import type { ActorDefinition, GmView } from "@vtt/domain";
import { defaultAvatarFor, type PictureSource } from "@vtt/ui";
import { splitNumber } from "../table/numbering";
import { useTokenImageUrl } from "../tokens/tokenImages";

/**
 * A creature's picture from what this viewer already holds (DESIGN.md, Pictures and default avatars): its authorized
 * token art over its main class's avatar, when the viewer's projection carries its classes, over the general pick by
 * actor id. Nothing here fetches a definition, parses `classLine` or reads a monster definition to pick a picture.
 */

/** The fields a picture may read. A player's actor carries `definition` only where the projection gives it. */
export type PicturedActor = Readonly<{
  id: string;
  definitionId?: string | null;
  definition?: ActorDefinition;
  tokenAssetId?: string | null;
}>;

/** The structured classes this viewer holds for an actor: the GM's own definition list, or the player's projection. */
export function visibleClasses(
  actor: PicturedActor,
  definitions?: GmView["definitions"]
): ReadonlyArray<Readonly<{ id: string; level: number }>> | undefined {
  const definition =
    actor.definition ??
    (definitions && actor.definitionId
      ? definitions.find((entry) => entry.id === actor.definitionId)?.definition
      : undefined);
  const classes = definition?.character?.classes;
  return classes && classes.length > 0 ? classes : undefined;
}

/** The picture source for an actor, given its art URL once that has loaded (null while loading or on failure). */
export function pictureOf(
  actor: PicturedActor,
  art: string | null | undefined,
  definitions?: GmView["definitions"]
): PictureSource {
  return { src: art ?? null, fallback: defaultAvatarFor(actor.id, visibleClasses(actor, definitions)) };
}

/** The picture for one actor, with its token art fetched through the viewer's own authorization. */
export function useActorPicture(
  actor: PicturedActor,
  token: string | null | undefined,
  definitions?: GmView["definitions"]
): PictureSource {
  const art = useTokenImageUrl(actor.tokenAssetId, token);
  return pictureOf(actor, art, definitions);
}

/** "Goblin Warrior 2" gives "GW2"; the number from `table/numbering.ts` keeps matching initials apart. */
export function badgeInitials(name: string): string {
  const { base, number } = splitNumber(name);
  const letters = base
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return number === null ? letters : `${letters}${number}`;
}

/**
 * The corner badge for each visible creature whose picture another visible creature shares: its initials. A
 * creature with its own art shares a picture only with another on the same art. Pass only the creatures this viewer
 * sees, so a hidden one never puts a badge on a visible one.
 */
export function sharedPictureBadges(
  creatures: ReadonlyArray<Readonly<{ id: string; name: string; tokenAssetId?: string | null }>>,
  pictureKey: (creature: Readonly<{ id: string; tokenAssetId?: string | null }>) => string
): ReadonlyMap<string, string> {
  const byKey = new Map<string, string[]>();
  for (const creature of creatures) {
    const key = pictureKey(creature);
    byKey.set(key, [...(byKey.get(key) ?? []), creature.id]);
  }
  const badges = new Map<string, string>();
  for (const creature of creatures)
    if ((byKey.get(pictureKey(creature))?.length ?? 0) > 1) badges.set(creature.id, badgeInitials(creature.name));
  return badges;
}

/** The key two creatures share when they show the same picture: the same art, or the same default avatar. */
export function pictureKeyOf(actor: PicturedActor, definitions?: GmView["definitions"]): string {
  return actor.tokenAssetId ? `art:${actor.tokenAssetId}` : `avatar:${pictureOf(actor, null, definitions).fallback}`;
}
