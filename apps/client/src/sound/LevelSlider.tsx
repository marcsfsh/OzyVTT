import { Slider } from "@vtt/ui";
import { useLevel } from "./sound-data";

/** A sound's own level: shown as it is dragged, sent while dragging and when let go. */
export function LevelSlider({
  label,
  saved,
  onSend,
  hideLabel = true
}: Readonly<{ label: string; saved: number; onSend: (level: number) => void; hideLabel?: boolean }>) {
  const level = useLevel(saved, onSend);
  return (
    <Slider
      className="sound-level"
      label={label}
      hideLabel={hideLabel}
      value={level.value}
      onChange={level.change}
      onCommit={level.commit}
    />
  );
}
