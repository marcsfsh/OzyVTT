import type { SoundScreen } from "@vtt/domain";
import { Badge, IconVolume, IconVolumeOff, type BadgeTone } from "@vtt/ui";

const STATES: Readonly<Record<SoundScreen["sound"], Readonly<{ text: string; tone: BadgeTone; on: boolean }>>> = {
  on: { text: "Sound on", tone: "success", on: true },
  blocked: { text: "Waiting for a tap on the screen", tone: "caution", on: false },
  muted: { text: "Preview, no sound", tone: "neutral", on: false },
  unknown: { text: "Checking sound", tone: "neutral", on: false }
};

/**
 * Whether each table screen is playing or waiting for someone to tap it, and any sound its browser can't play.
 * The GM can't hear the TV from the laptop, so this is how they know the room hears what they started.
 */
export function ScreenSoundStatus({
  screens,
  nameOf,
  compact = false
}: Readonly<{ screens: readonly SoundScreen[]; nameOf: (assetId: string) => string; compact?: boolean }>) {
  // The GM's own silent preview says nothing about the room.
  const tables = screens.filter((screen) => screen.sound !== "muted");
  if (tables.length === 0)
    return (
      <p className="sound-screens sound-screens--none" role="status">
        <Badge>
          <IconVolumeOff /> No table screen connected
        </Badge>
      </p>
    );
  return (
    <ul className="sound-screens" role="status" aria-label="Table screens">
      {tables.map((screen) => {
        const state = STATES[screen.sound];
        return (
          <li key={screen.connectionId}>
            <Badge tone={state.tone}>
              {state.on ? <IconVolume /> : <IconVolumeOff />}
              {compact && tables.length === 1 ? state.text : `${screen.name} · ${state.text}`}
            </Badge>
            {screen.unplayable.length > 0 && (
              <Badge tone="danger">Can't play {screen.unplayable.map(nameOf).join(", ")}</Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}
