import { useEffect, useState } from "react";
import { Stepper, Switch } from "@vtt/ui";
import type { MoveMode } from "./movePreview";

/** The ways of moving that change a creature's height on the map, and the verb each button uses. */
const RISES: Partial<Record<MoveMode, string>> = { fly: "Fly", climb: "Climb", jump: "Jump", teleport: "Teleport" };

/**
 * How high a creature is, and how to change it. The creature whose move counts now rises or descends in place by the
 * way it moves (flying, climbing, teleporting), which the server charges like any move. The GM also sets any
 * creature's height free of movement, standing on a surface (a ledge, a wall it clings to) or in the air.
 */
export function HeightControl({
  name,
  altitudeFeet,
  airborne,
  mode,
  canMove,
  gm,
  busy,
  onMove,
  onSet,
  onFall
}: Readonly<{
  name: string;
  altitudeFeet: number;
  airborne: "fly" | "levitate" | undefined;
  /** How the creature's next move travels. */
  mode: MoveMode;
  /** The creature's move counts now, so it can rise or descend by moving. */
  canMove: boolean;
  gm: boolean;
  busy: boolean;
  onMove: (altitudeFeet: number) => void;
  onSet: (altitudeFeet: number, airborne: "fly" | "levitate" | null) => void;
  /** The GM drops a creature that is up from the height it is at; the server rolls the fall. */
  onFall?: (intoWater: boolean) => void;
}>) {
  const [target, setTarget] = useState(altitudeFeet);
  const [inTheAir, setInTheAir] = useState(airborne !== undefined);
  const [intoWater, setIntoWater] = useState(false);
  useEffect(() => setTarget(altitudeFeet), [altitudeFeet]);
  useEffect(() => setInTheAir(airborne !== undefined), [airborne]);
  const verb = RISES[mode];
  const moving = canMove && verb !== undefined;
  if (!moving && !gm) return null;
  return (
    <div className="encounter-height">
      <Stepper
        label="Height"
        value={target}
        min={0}
        max={500}
        step={5}
        format={(feet) => (feet > 0 ? `${feet} ft` : "Ground")}
        disabled={busy}
        aria-label={`Height for ${name}`}
        onChange={setTarget}
      />
      {moving && (
        <button
          type="button"
          className="token-context-item"
          disabled={busy || target === altitudeFeet}
          onClick={() => onMove(target)}
        >
          {verb} to {target > 0 ? `${target} ft up` : "the ground"}
        </button>
      )}
      {gm && (
        <>
          <Switch
            checked={inTheAir && target > 0}
            disabled={busy || target === 0}
            label="In the air"
            onChange={setInTheAir}
          />
          <button
            type="button"
            className="token-context-item"
            disabled={busy}
            title={`Puts ${name} at this height without spending movement`}
            onClick={() => onSet(target, inTheAir && target > 0 ? (airborne ?? "fly") : null)}
          >
            Set height
          </button>
          {onFall && altitudeFeet > 0 && (
            <>
              <Switch checked={intoWater} disabled={busy} label="Into water" onChange={setIntoWater} />
              <button
                type="button"
                className="token-context-item"
                disabled={busy}
                title={`Rolls 1d6 Bludgeoning for every 10 feet, and ${name} lands Prone if it takes any`}
                onClick={() => onFall(intoWater)}
              >
                Fall {altitudeFeet} ft
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
