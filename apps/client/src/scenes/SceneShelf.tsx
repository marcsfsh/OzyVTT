import type { ReactNode } from "react";
import type { GmView } from "@vtt/domain";
import { cx } from "@vtt/ui";
import { MapThumb, ReadyLine, StateChip } from "./pieces";
import type { SceneFacts } from "./sceneFacts";
import type { StateTag } from "./stateTag";

/** Who is in an encounter, as its card shows it: the party's faces, and the monsters as chips grouped by name. */
export type WhoIsIn = Readonly<{
  party: ReadonlyArray<Readonly<{ id: string; name: string }>>;
  monsters: ReadonlyArray<Readonly<{ name: string; count: number }>>;
}>;

export function whoIsIn(row: SceneFacts, actors: GmView["actors"]): WhoIsIn {
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const staged = row.combat.initiative.map((entry) => byId.get(entry.actorId)).filter((actor) => actor !== undefined);
  const monsters = new Map<string, number>();
  for (const actor of staged)
    if (actor.kind === "monster") {
      // "Goblin 2" and "Goblin 3" are two goblins: the number a copy carries is no part of its kind.
      const name = actor.name.replace(/\s+\d+$/, "");
      monsters.set(name, (monsters.get(name) ?? 0) + 1);
    }
  return {
    party: staged.filter((actor) => actor.kind !== "monster").map((actor) => ({ id: actor.id, name: actor.name })),
    monsters: [...monsters.entries()].map(([name, count]) => ({ name, count }))
  };
}

/**
 * One encounter on the shelf (Prep frame 2.1): its map as the picture at 16 by 10 with the state tag at its top left,
 * the name, the map's name, who is in it and whether it is ready. The card opens the encounter; its More menu (and in
 * Your order the drag grip) sit at the top right, shown on hover and focus and always on touch. A phone keeps the
 * picture, the name and the ready line.
 */
export function ShelfCard({
  row,
  tag,
  ready,
  who,
  phone,
  dragging,
  grip,
  menu,
  onOpen
}: Readonly<{
  row: SceneFacts;
  tag: StateTag;
  ready: Readonly<{ ready: boolean; text: string }>;
  who: WhoIsIn;
  phone: boolean;
  dragging: boolean;
  grip: ReactNode;
  menu: ReactNode;
  onOpen: () => void;
}>) {
  return (
    <li
      data-scene-id={row.scene.id}
      className={cx("sc-card", row.live && "is-live", dragging && "is-dragging")}
      aria-label={row.scene.name}
    >
      <button type="button" className="sc-card-open" onClick={onOpen}>
        <span className="nh-sr-only">Open {row.scene.name}</span>
      </button>
      <span className="sc-card-pic">
        <MapThumb mapAssetId={row.scene.mapAssetId} />
        <StateChip tag={tag} className="sc-card-tag" />
      </span>
      <span className="sc-card-body">
        <b className="sc-card-name">{row.scene.name}</b>
        {!phone && <span className="sc-card-map">{row.map?.name ?? "Map not in the library"}</span>}
        {!phone && (who.party.length > 0 || who.monsters.length > 0) && (
          <span className="sc-card-who">
            {who.party.length > 0 && (
              <span className="sc-card-faces">
                {who.party.map((character) => (
                  <span key={character.id} className="sc-card-face" title={character.name}>
                    {character.name.slice(0, 1).toUpperCase()}
                  </span>
                ))}
              </span>
            )}
            {who.monsters.map((monster) => (
              <span key={monster.name} className="sc-card-monster">
                {monster.count > 1 ? `${monster.name} ×${monster.count}` : monster.name}
              </span>
            ))}
          </span>
        )}
        <ReadyLine ready={ready.ready} text={ready.text} />
      </span>
      <span className="sc-card-tools">
        {grip}
        {menu}
      </span>
    </li>
  );
}
