import type { SoundBoard } from "@vtt/domain";
import { Badge, Button, IconButton, IconPlay, IconX, Switch } from "@vtt/ui";
import type { SendSound } from "./sound-data";

type SceneRow = Readonly<{ id: string; name: string }>;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function SceneSoundRow({
  board,
  scene,
  live,
  send
}: Readonly<{ board: SoundBoard; scene: SceneRow; live: boolean; send: SendSound }>) {
  const preset = board.presets.find((candidate) => candidate.encounterId === scene.id);
  const summary = preset
    ? [
        preset.music && plural(preset.music.tracks.length, "track", "tracks"),
        preset.ambient.length > 0 && plural(preset.ambient.length, "ambient layer", "ambient layers")
      ]
        .filter(Boolean)
        .join(" · ")
    : "No sound saved";
  return (
    <>
      <span className="sound-row-name">
        <strong>
          {scene.name} {live && <Badge tone="primary">Live</Badge>}
        </strong>
        <small>{summary}</small>
      </span>
      <Button
        size="sm"
        onClick={() => void send("sound:set-encounter-preset", { encounterId: scene.id, preset: "save-current" })}
      >
        {preset ? "Replace with current sound" : "Save current sound"}
      </Button>
      {preset && (
        <>
          <Switch
            checked={preset.autoplay}
            label="Starts when live"
            onChange={(autoplay) => void send("sound:set-encounter-preset", { encounterId: scene.id, autoplay })}
          />
          <span className="sound-row-tools">
            <IconButton
              label={`Play ${scene.name}'s sound now`}
              onClick={() => void send("sound:play", { target: "encounter", encounterId: scene.id })}
            >
              <IconPlay />
            </IconButton>
            <IconButton
              label={`Clear ${scene.name}'s sound`}
              onClick={() => void send("sound:set-encounter-preset", { encounterId: scene.id, preset: "clear" })}
            >
              <IconX />
            </IconButton>
          </span>
        </>
      )}
    </>
  );
}
