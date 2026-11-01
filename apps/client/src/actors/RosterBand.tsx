import { useEffect, useState } from "react";
import type { ActorDefinition, GmActor } from "@vtt/domain";
import { Button, IconArrow, IconMore, Menu, MenuItem, RevealSwitch, StatusLamp, Tag, cx } from "@vtt/ui";
import type { SrdExtension } from "../encounter/sheet-extension";
import { read } from "../lib/command";
import { ActorAvatar } from "./ActorAvatar";
import { classLine, presenceLabel } from "./actor-display";
import { atTableBlocked } from "./playedAtTable";

/** Who plays a character (characters rule 4): on a player's device, at the table, or open to claim. */
export function whoPlaysOf(actor: GmActor): Readonly<{ word: string; tone: "device" | "table" | "open" }> {
  if (actor.ownerSessionId)
    return {
      word:
        actor.presence && actor.presence !== "online"
          ? `On a player's device · ${presenceLabel(actor.presence)}`
          : "On a player's device",
      tone: "device"
    };
  if (actor.playedAtTable) return { word: "At the table", tone: "table" };
  return { word: "Open to claim", tone: "open" };
}

/**
 * Passive Perception as the sheet reads it: the server's derived number from the read the sheet already makes, over
 * the stored sheet's, with a dash until either is known. One read per band once it is on screen.
 */
function usePassivePerception(actor: GmActor, definition: ActorDefinition | undefined): number | null {
  const stored = ((definition?.extensions["open5e.srd-2024"] ?? {}) as SrdExtension).passivePerception ?? null;
  const [derived, setDerived] = useState<number | null>(null);
  useEffect(() => {
    if (!actor.definitionId) return;
    let live = true;
    void read("actor:available-actions", { actorId: actor.id }).then((result) => {
      if (live && result.ok && typeof result.derived?.passivePerception === "number")
        setDerived(result.derived.passivePerception);
    });
    return () => {
      live = false;
    };
  }, [actor.id, actor.definitionId]);
  return derived ?? stored;
}

/**
 * One character in the roster (characters spec 2.1, ADR-0051): the Ledger's vitals band in a Cradle. Its identity
 * (the face, the name, the class line and its tags), the plate (AC, Hit points, Speed, Passive Perception), and at its
 * end who plays over Open sheet, Level up and the More menu, which holds Played at the table, Release, Archive or
 * Delete.
 */
export function RosterBand({
  actor,
  definition,
  token,
  definitions,
  archived,
  levelable,
  busy,
  neverPlayed,
  onOpen,
  onLevel,
  onAtTable,
  onRelease,
  onArchive,
  onDelete,
  onSheetPreview
}: Readonly<{
  actor: GmActor;
  definition: ActorDefinition | undefined;
  token: string;
  definitions: Parameters<typeof ActorAvatar>[0]["definitions"];
  archived: boolean;
  levelable: boolean;
  busy: boolean;
  neverPlayed: boolean;
  onOpen: () => void;
  onLevel: () => void;
  onAtTable: (on: boolean) => void;
  onRelease: () => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
  onSheetPreview: (shown: boolean) => void;
}>) {
  const passive = usePassivePerception(actor, definition);
  const who = whoPlaysOf(actor);
  const identity = definition?.character;
  const line = [classLine(definition), identity?.race?.name ?? null, identity?.background?.name ?? null]
    .filter(Boolean)
    .join(" · ");
  const conditions = actor.conditions.filter((condition) => condition.id !== "exhaustion");
  const blocked = atTableBlocked(actor);
  return (
    <li className={cx("roster-band", archived && "is-archived")} aria-labelledby={`band-${actor.id}`}>
      <span className="roster-band-face">
        <ActorAvatar actor={actor} token={token} definitions={definitions} name={actor.name} size="lg" />
      </span>
      <span className="roster-band-identity">
        <h3 id={`band-${actor.id}`} className="roster-band-name">
          {actor.name}
        </h3>
        {line && <span className="roster-band-line">{line}</span>}
        {(actor.sample || conditions.length > 0) && (
          <span className="roster-band-tags">
            {actor.sample && <Tag className="roster-band-sample">Sample</Tag>}
            {conditions.map((condition) => (
              <Tag key={condition.id} tone={condition.id === "invisible" ? "status" : "miss"}>
                {condition.id.replace(/-/g, " ")}
              </Tag>
            ))}
          </span>
        )}
      </span>
      <dl className="roster-band-plate">
        <div>
          <dt>AC</dt>
          <dd>{actor.armorClassOverride ?? actor.armorClass ?? "--"}</dd>
        </div>
        <div className="is-hp">
          <dt>Hit points</dt>
          <dd>
            {actor.hp.current}
            <small>/{actor.hp.maximum}</small>
          </dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{actor.speedFeet ?? definition?.speedFeet ?? "--"}</dd>
        </div>
        <div className="is-passive">
          <dt>Passive Perc.</dt>
          <dd>{passive ?? "--"}</dd>
        </div>
      </dl>
      <span className="roster-band-end">
        <span className={cx("roster-band-who", `is-${who.tone}`)}>
          <StatusLamp lit={who.tone !== "open"} />
          {archived ? "Archived" : who.word}
        </span>
        <span className="roster-band-actions">
          <Button size="sm" disabled={busy} onClick={onOpen}>
            Open sheet
          </Button>
          {!archived && levelable && (
            <Button size="sm" className="roster-band-level" disabled={busy} onClick={onLevel}>
              <IconArrow className="roster-band-up" /> Level up
            </Button>
          )}
          <Menu trigger={<IconMore />} icon align="end" label={`More for ${actor.name}`}>
            {!archived && (
              <MenuItem
                role="menuitemcheckbox"
                aria-checked={actor.playedAtTable === true}
                disabled={busy || blocked !== null}
                title={blocked ?? undefined}
                onClick={() => onAtTable(!actor.playedAtTable)}
              >
                Played at the table
              </MenuItem>
            )}
            {!archived && actor.ownerSessionId && (
              <MenuItem disabled={busy} onClick={onRelease}>
                Release
              </MenuItem>
            )}
            {!archived && !neverPlayed && (
              <MenuItem disabled={busy} onClick={() => onArchive(true)}>
                Archive
              </MenuItem>
            )}
            {archived && (
              <MenuItem disabled={busy} onClick={() => onArchive(false)}>
                Restore
              </MenuItem>
            )}
            {(archived || neverPlayed) && (
              <MenuItem tone="danger" disabled={busy} onClick={onDelete}>
                Delete
              </MenuItem>
            )}
          </Menu>
        </span>
        {archived && (
          <span className="roster-band-preview">
            <RevealSwitch
              revealed={actor.sheetPreview}
              ariaLabel={`Show ${actor.name}'s sheet to players`}
              onChange={onSheetPreview}
            />
          </span>
        )}
      </span>
    </li>
  );
}
