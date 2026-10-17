import type { ActorMovementReply } from "@vtt/domain";
import { SegmentedControl } from "@vtt/ui";
import type { MoveMode } from "./movePreview";

const NAMES: Readonly<Record<MoveMode, string>> = {
  walk: "Walk",
  fly: "Fly",
  swim: "Swim",
  climb: "Climb",
  burrow: "Burrow",
  teleport: "Teleport",
  forced: "Forced"
};

/**
 * How a creature's next drag travels, picked with one tap: walking or one of its special speeds (with the feet left
 * this turn), climbing or swimming without the speed (each foot costs double), teleporting, and for the GM, moving
 * it by force. Prone, every way is a crawl.
 */
export function MoveModeBar({
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
  const walkName = budget?.crawling ? "Crawl" : NAMES.walk;
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
        label: entry.extraCost ? NAMES[entry.mode] : `${NAMES[entry.mode]} ${remaining(entry.budgetFeet)}`,
        title: entry.extraCost
          ? `No ${NAMES[entry.mode]} Speed: each foot costs double`
          : `Feet of ${NAMES[entry.mode]} movement left this turn`
      })),
    { value: "teleport", label: NAMES.teleport, title: "Spends no movement and provokes no opportunity attack" },
    ...(gm
      ? [{ value: "forced", label: NAMES.forced, title: "Pushed, pulled or dragged: no movement and no reactions" }]
      : [])
  ];
  return (
    <div className="encounter-move-modes">
      <span className="encounter-move-modes-label">Move {name}</span>
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
