import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  OBJECT_ARMOR_CLASS,
  OBJECT_HIT_POINTS,
  OBJECT_SIZES,
  OBJECT_SUBSTANCES,
  type DoorFastening,
  type DoorState,
  type ObjectSize,
  type ObjectStats,
  type ObjectSubstance
} from "@vtt/domain";
import { Button, IconButton, IconX, NumberField, Select, Switch } from "@vtt/ui";
import { useMenuDismiss, useMenuPlacement } from "./menuPlacement";
import type { DoorWork } from "./useMapCommands";
import type { MapWall } from "./VisionLayer";
import "./token-menu.css";

/** SRD Lock and forcing a door: DC 15 when the GM sets none. */
const DEFAULT_DC = 15;
/** A door with no statistics of its own is a Medium resilient wooden one (SRD 5.2.1 Breaking Objects). */
const WOODEN_DOOR = { substance: "wood" as ObjectSubstance, size: "medium" as ObjectSize, fragile: false };

const FASTENING_NAMES: Readonly<Record<string, string>> = {
  lock: "Locked",
  stuck: "Stuck",
  barred: "Barred",
  jammed: "Jammed",
  sealed: "Sealed",
  rod: "Immovable Rod",
  glued: "Glued",
  command: "Opens at its owner's command"
};

/** What the GM reads of a door at a glance: what holds it, whether players see it, its Armor Class and hit points. */
export function doorSummary(wall: MapWall): string {
  const parts = (wall.door?.fastenings ?? []).map(
    (fastening) => `${FASTENING_NAMES[fastening.kind] ?? fastening.kind}${fastening.dc ? ` DC ${fastening.dc}` : ""}`
  );
  if (wall.door?.arcaneLock !== undefined) parts.push("Arcane Lock");
  if (wall.door?.hidden) parts.push("Secret");
  const stats = wall.object;
  parts.push(
    stats ? `AC ${stats.armorClass} · ${stats.hitPoints.current}/${stats.hitPoints.maximum} HP` : "AC 15 · 18 HP"
  );
  return parts.join(" · ");
}

/** The size and build whose hit points this is, for the editor's starting pick; null for a number off the table. */
function sizeOf(maximum: number): { size: ObjectSize; fragile: boolean } | null {
  for (const size of OBJECT_SIZES) {
    if (OBJECT_HIT_POINTS[size].resilient === maximum) return { size, fragile: false };
    if (OBJECT_HIT_POINTS[size].fragile === maximum) return { size, fragile: true };
  }
  return null;
}

/** The substance whose Armor Class this is, for the editor's starting pick. */
const substanceOf = (armorClass: number): ObjectSubstance =>
  OBJECT_SUBSTANCES.find((substance) => OBJECT_ARMOR_CLASS[substance] === armorClass) ?? WOODEN_DOOR.substance;

/**
 * A door's menu, from a tap on its handle: open or close it, and with a character beside it pick its lock, force it,
 * pry it, jam it with a spike or seal it. The server rolls each check and decides who may open what, so a player
 * learns that a door is locked by trying it. The GM also sets what holds the door shut, whether players see it as
 * wall, and its statistics as an object.
 */
export function DoorMenu({
  role,
  wall,
  x,
  y,
  actorName,
  busy = false,
  onOpen,
  onWork,
  onSave,
  onClose
}: Readonly<{
  role: "gm" | "player";
  wall: MapWall;
  x: number;
  y: number;
  /** Who works on the door: a player's character, the GM's acting creature. Null hides the work. */
  actorName: string | null;
  busy?: boolean;
  onOpen: (open: boolean) => void;
  onWork: (how: DoorWork) => void;
  /** The GM's edit: what holds the door shut (null for nothing), then its statistics. */
  onSave: (door: DoorState | null, object: ObjectStats) => void;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const style = useMenuPlacement(ref, x, y, [editing, actorName]);
  useMenuDismiss(ref, onClose);
  const open = wall.open === true;
  const choose = (run: () => void) => () => {
    run();
    onClose();
  };
  const work: ReadonlyArray<readonly [DoorWork, string]> = open
    ? []
    : [
        ["pick", "Pick the lock"],
        ["force", "Force it open"],
        ["pry", "Pry it open with tools"],
        ["jam", "Jam it with an Iron Spike"],
        ["seal", "Seal it with Carpenter's Tools"],
        ["release", "Push an Immovable Rod's button"]
      ];
  return createPortal(
    <div ref={ref} className="token-context-menu anim-popover scroll-y" role="menu" style={style} aria-label="Door">
      <div className="token-context-head">
        <strong>Door</strong>
        <IconButton label="Close menu" size="sm" onClick={onClose}>
          <IconX />
        </IconButton>
      </div>
      {role === "gm" && <p className="token-context-feedback door-menu-summary">{doorSummary(wall)}</p>}
      <button
        type="button"
        role="menuitem"
        className="token-context-item"
        disabled={busy}
        onClick={choose(() => onOpen(!open))}
      >
        {open ? "Close the door" : "Open the door"}
      </button>
      {actorName !== null &&
        work.map(([how, label]) => (
          <button
            key={how}
            type="button"
            role="menuitem"
            className="token-context-item"
            disabled={busy}
            onClick={choose(() => onWork(how))}
          >
            {label}
          </button>
        ))}
      {actorName !== null && !open && (
        <p className="token-context-feedback">{`${actorName} does it. Each takes an action in an encounter.`}</p>
      )}
      <p className="token-context-feedback">
        To attack the door or cast a spell on it, choose the attack or the spell, then tap the door.
      </p>
      {role === "gm" &&
        (editing ? (
          <DoorEditor
            wall={wall}
            busy={busy}
            onSave={(door, object) => {
              onSave(door, object);
              onClose();
            }}
          />
        ) : (
          <button type="button" role="menuitem" className="token-context-item" onClick={() => setEditing(true)}>
            Edit lock and strength
          </button>
        ))}
    </div>,
    document.fullscreenElement ?? document.body
  );
}

/** The GM's editor for a door: its lock, whether it is stuck or barred, whether it is secret, and its statistics. The
 *  fastenings it doesn't show (a spike, Stone Shape's seal, a lock's key holders, an Arcane Lock) are kept. */
function DoorEditor({
  wall,
  busy,
  onSave
}: Readonly<{ wall: MapWall; busy: boolean; onSave: (door: DoorState | null, object: ObjectStats) => void }>) {
  const fastenings = wall.door?.fastenings ?? [];
  const find = (kind: string) => fastenings.find((fastening) => fastening.kind === kind);
  const [locked, setLocked] = useState(find("lock") !== undefined);
  const [lockDc, setLockDc] = useState<number | null>(find("lock")?.dc ?? DEFAULT_DC);
  const [stuck, setStuck] = useState(find("stuck") !== undefined);
  const [barred, setBarred] = useState(find("barred") !== undefined);
  const [forceDc, setForceDc] = useState<number | null>(find("stuck")?.dc ?? find("barred")?.dc ?? DEFAULT_DC);
  const [secret, setSecret] = useState(wall.door?.hidden === true);
  const [substance, setSubstance] = useState<ObjectSubstance>(
    wall.object ? substanceOf(wall.object.armorClass) : WOODEN_DOOR.substance
  );
  const start = wall.object ? sizeOf(wall.object.hitPoints.maximum) : null;
  const [size, setSize] = useState<ObjectSize>(start?.size ?? WOODEN_DOOR.size);
  const [fragile, setFragile] = useState(start?.fragile ?? WOODEN_DOOR.fragile);
  const maximum = OBJECT_HIT_POINTS[size][fragile ? "fragile" : "resilient"];
  const [left, setLeft] = useState<number | null>(wall.object?.hitPoints.current ?? null);

  const save = () => {
    const kept = fastenings.filter((fastening) => !["lock", "stuck", "barred"].includes(fastening.kind));
    const lock = find("lock");
    const next: DoorFastening[] = [
      ...(locked ? [{ ...(lock as DoorFastening | undefined), kind: "lock" as const, dc: lockDc ?? DEFAULT_DC }] : []),
      ...(stuck ? [{ kind: "stuck" as const, dc: forceDc ?? DEFAULT_DC }] : []),
      ...(barred ? [{ kind: "barred" as const, dc: forceDc ?? DEFAULT_DC }] : []),
      ...(kept as DoorFastening[])
    ];
    const arcaneLock = wall.door?.arcaneLock as DoorState["arcaneLock"];
    const door: DoorState | null =
      next.length === 0 && !secret && arcaneLock === undefined
        ? null
        : { fastenings: next, ...(arcaneLock ? { arcaneLock } : {}), ...(secret ? { hidden: true as const } : {}) };
    // A door at 0 hit points is broken; the editor keeps it standing with 1.
    const current = Math.min(maximum, Math.max(1, left ?? maximum));
    onSave(door, { name: "Door", armorClass: OBJECT_ARMOR_CLASS[substance], hitPoints: { current, maximum } });
  };

  return (
    <div className="door-editor">
      <Switch checked={locked} onChange={setLocked} label="Locked" />
      {locked && (
        <label className="token-context-size">
          Pick DC
          <NumberField value={lockDc} onChange={setLockDc} min={1} max={40} aria-label="Lock DC" />
        </label>
      )}
      <Switch checked={stuck} onChange={setStuck} label="Stuck" />
      <Switch checked={barred} onChange={setBarred} label="Barred" />
      {(stuck || barred) && (
        <label className="token-context-size">
          Force DC
          <NumberField value={forceDc} onChange={setForceDc} min={1} max={40} aria-label="Force DC" />
        </label>
      )}
      <Switch checked={secret} onChange={setSecret} label="Secret door" />
      <label className="token-context-size">
        Made of
        <Select value={substance} onChange={(event) => setSubstance(event.target.value as ObjectSubstance)}>
          {OBJECT_SUBSTANCES.map((entry) => (
            <option key={entry} value={entry}>
              {`${entry[0]!.toUpperCase()}${entry.slice(1)}`}
            </option>
          ))}
        </Select>
      </label>
      <label className="token-context-size">
        Size
        <Select value={size} onChange={(event) => setSize(event.target.value as ObjectSize)}>
          {OBJECT_SIZES.map((entry) => (
            <option key={entry} value={entry}>
              {`${entry[0]!.toUpperCase()}${entry.slice(1)}`}
            </option>
          ))}
        </Select>
      </label>
      <Switch checked={fragile} onChange={setFragile} label="Fragile" />
      <label className="token-context-size">
        HP left
        <NumberField
          value={left}
          onChange={setLeft}
          min={1}
          max={maximum}
          placeholder={String(maximum)}
          aria-label="Hit points left"
        />
      </label>
      <p className="token-context-feedback">{`AC ${OBJECT_ARMOR_CLASS[substance]} · ${maximum} HP at most`}</p>
      <Button size="sm" disabled={busy} onClick={save}>
        Save door
      </Button>
    </div>
  );
}
