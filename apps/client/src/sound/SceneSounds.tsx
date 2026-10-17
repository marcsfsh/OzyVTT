import type { SoundBoard } from "@vtt/domain";
import { Badge, Button, IconButton, IconPlay, IconScene, IconX, Switch } from "@vtt/ui";
import type { SendSound } from "./sound-data";

type SceneRow = Readonly<{ id: string; name: string }>;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * A sound of its own for each prepared scene: what the board holds now (the playlist and the layers that are on),
 * started when the scene goes live unless the GM switches that off.
 */
export function SceneSounds({
  board,
  scenes,
  activeSceneId,
  send
}: Readonly<{ board: SoundBoard; scenes: readonly SceneRow[]; activeSceneId: string | null; send: SendSound }>) {
  return (
    <section className="sound-section surface-glass" aria-labelledby="sound-scenes-title">
      <header className="sound-section-head">
        <h3 id="sound-scenes-title">
          <IconScene /> Scene sound
        </h3>
      </header>
      <p className="sound-hint">
        Saves the playlist and the ambient layers that are on. It starts when the scene goes live.
      </p>
      {scenes.length === 0 ? (
        <p className="sound-empty">Prepare a scene on the Scenes tab to give it a sound.</p>
      ) : (
        <ul className="sound-rows">
          {scenes.map((scene) => {
            const preset = board.presets.find((candidate) => candidate.sceneId === scene.id);
            const summary = preset
              ? [
                  preset.music && plural(preset.music.tracks.length, "track", "tracks"),
                  preset.ambient.length > 0 && plural(preset.ambient.length, "ambient layer", "ambient layers")
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "No sound saved";
            return (
              <li key={scene.id} className="sound-row sound-scene">
                <span className="sound-row-name">
                  <strong>
                    {scene.name} {scene.id === activeSceneId && <Badge tone="primary">Live</Badge>}
                  </strong>
                  <small>{summary}</small>
                </span>
                <Button
                  size="sm"
                  onClick={() => void send("sound:set-scene-preset", { sceneId: scene.id, preset: "save-current" })}
                >
                  {preset ? "Replace with current sound" : "Save current sound"}
                </Button>
                {preset && (
                  <>
                    <Switch
                      checked={preset.autoplay}
                      label="Starts when live"
                      onChange={(autoplay) => void send("sound:set-scene-preset", { sceneId: scene.id, autoplay })}
                    />
                    <span className="sound-row-tools">
                      <IconButton
                        label={`Play ${scene.name}'s sound now`}
                        onClick={() => void send("sound:play", { target: "scene", sceneId: scene.id })}
                      >
                        <IconPlay />
                      </IconButton>
                      <IconButton
                        label={`Clear ${scene.name}'s sound`}
                        onClick={() => void send("sound:set-scene-preset", { sceneId: scene.id, preset: "clear" })}
                      >
                        <IconX />
                      </IconButton>
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
