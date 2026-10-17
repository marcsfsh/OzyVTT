import type { ActorMovementReply } from "@vtt/domain";
import { SegmentedControl } from "@vtt/ui";
import type { MoveMode } from "./movePreview";

export const MOVE_MODE_NAMES: Readonly<Record<MoveMode, string>> = {
  walk: "Walk",
  fly: "Fly",
  swim: "Swim",
  climb: "Climb",
  burrow: "Burrow",
  teleport: "Teleport",
  forced: "Forced"
};

/** The letter that switches a drag to each way of moving, read while the token is held. */
export const MOVE_MODE_KEYS: Readonly<Record<string, MoveMode>> = {
  w: "walk",
  f: "fly",
  s: "swim",
  c: "climb",
  b: "burrow",
  t: "teleport",
  m: "forced"
};

/**
 * How a creature's next drag travels, picked with one tap in its token menu: walking or one of its special speeds
 * (with the feet left this turn), climbing or swimming without the speed (each foot costs double), teleporting, and
 * for the GM, moving it by force. Prone, every way is a crawl. The drag's label names the way chosen.
 */
export function MoveModeChoice({
  name,
  budget,
  mode,
  onChange,
  gm
}: Readonly<{
  name: string;
  budget: ActorMovementReply | null;
  mode: MoveMode;
  onChange: (mode: MoveMode) => void;
  /** The GM may also move a creature by force. */
  gm: boolean;
}>) {
  const spent = budget?.counted ? budget.usedFeet : 0;
  const remaining = (feet: number) => Math.max(0, Math.round(feet - spent));
  const walkBudget = budget?.modes?.find((entry) => entry.mode === "walk")?.budgetFeet ?? budget?.speedFeet ?? null;
  const walkName = budget?.crawling ? "Crawl" : MOVE_MODE_NAMES.walk;
  const options = [
    {
      value: "walk",
      label: walkBudget !== null ? `${walkName} ${remaining(walkBudget)}` : walkName,
      title: budget?.crawling ? "Prone: each foot costs double" : "Feet of movement left this turn"
    },
    ...(budget?.modes ?? [])
      .filter((entry) => entry.mode !== "walk")
      .map((entry) => ({
        value: entry.mode,
        label: entry.extraCost
          ? MOVE_MODE_NAMES[entry.mode]
          : `${MOVE_MODE_NAMES[entry.mode]} ${remaining(entry.budgetFeet)}`,
        title: entry.extraCost
          ? `No ${MOVE_MODE_NAMES[entry.mode]} Speed: each foot costs double`
          : `Feet of ${MOVE_MODE_NAMES[entry.mode]} movement left this turn`
      })),
    {
      value: "teleport",
      label: MOVE_MODE_NAMES.teleport,
      title: "Spends no movement and provokes no opportunity attack"
    },
    ...(gm
      ? [
          {
            value: "forced",
            label: MOVE_MODE_NAMES.forced,
            title: "Pushed, pulled or dragged: no movement and no reactions"
          }
        ]
      : [])
  ];
  return (
    <div className="encounter-move-modes">
      <span className="encounter-move-modes-label">How {name} moves</span>
      <SegmentedControl
        size="sm"
        ariaLabel={`How ${name} moves`}
        options={options}
        value={mode}
        onChange={(value) => onChange(value as MoveMode)}
      />
    </div>
  );
}
