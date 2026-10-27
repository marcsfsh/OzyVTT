import { useEffect, useMemo } from "react";
import type { SoundBoard as Board, SoundBoardView } from "@vtt/domain";
import { Badge, Button, Eyebrow, IconPause, IconPlay, IconSkip, IconStop } from "@vtt/ui";
import { SharedScreenSwitch } from "../viewer/SharedScreenSwitch";
import { ScreenSoundStatus } from "./ScreenSoundStatus";
import { SceneSounds } from "./SceneSounds";
import { isSounding, playOrPause, useSoundBoard, useSoundCommand, useSoundLibrary, type SendSound } from "./sound-data";
import { SoundLibraryPanel } from "./SoundLibraryPanel";
import { LevelSlider } from "./LevelSlider";
import { AmbienceSection, EffectsSection, MusicSection } from "./SoundSections";
import "./sound-board.css";

/** Every sound the board names, to notice one the library list hasn't caught up with. */
const boardSounds = (board: Board) => [
  ...board.music.tracks.map((slot) => slot.assetId),
  ...board.ambient.map((slot) => slot.assetId),
  ...board.effects.map((slot) => slot.assetId)
];

function Transport({
  view,
  nameOf,
  send
}: Readonly<{ view: SoundBoardView; nameOf: (assetId: string) => string; send: SendSound }>) {
  const { board } = view;
  const paused = board.pausedAt !== null;
  const sounding = isSounding(board);
  const layers = board.ambient.filter((layer) => layer.playing).map((layer) => nameOf(layer.assetId));
  return (
    <section className="sound-transport surface-glass" aria-label="Now playing">
      <ScreenSoundStatus screens={view.screens} nameOf={nameOf} />
      <dl className="sound-now">
        <div>
          <dt>Music</dt>
          <dd>{board.music.current ? nameOf(board.music.current.assetId) : "None"}</dd>
        </div>
        <div>
          <dt>Ambience</dt>
          <dd>{layers.length ? layers.join(", ") : "None"}</dd>
        </div>
        {paused && (
          <div>
            <dt className="nh-sr-only">State</dt>
            <dd>
              <Badge tone="caution">Paused</Badge>
            </dd>
          </div>
        )}
      </dl>
      <div className="sound-transport-controls">
        <Button
          variant="primary"
          disabled={!sounding && !paused && board.music.tracks.length === 0}
          onClick={() => void playOrPause(board, send)}
        >
          {paused ? (
            <>
              <IconPlay /> Resume
            </>
          ) : sounding ? (
            <>
              <IconPause /> Pause
            </>
          ) : (
            <>
              <IconPlay /> Play music
            </>
          )}
        </Button>
        <Button disabled={board.music.tracks.length === 0} onClick={() => void send("sound:next-track", {})}>
          <IconSkip /> Next track
        </Button>
        <Button disabled={!sounding && !paused} onClick={() => void send("sound:stop", { target: "all" })}>
          <IconStop /> Stop all
        </Button>
        <LevelSlider
          label="Master volume"
          hideLabel={false}
          saved={board.masterVolume}
          onSend={(level) => void send("sound:arrange", { masterVolume: level })}
        />
      </div>
    </section>
  );
}

/**
 * The GM's sound board, the Shared screen tab's second view: what plays on the table screen and how loud, the
 * library it plays from, and each scene's own sound. Sound comes out of the table screen only; this device and
 * the players' stay silent.
 */
export function SoundBoard({
  gmToken,
  scenes,
  activeSceneId
}: Readonly<{
  gmToken: string;
  scenes: readonly Readonly<{ id: string; name: string }>[];
  activeSceneId: string | null;
}>) {
  const view = useSoundBoard();
  const library = useSoundLibrary(gmToken);
  const send = useSoundCommand();
  const names = useMemo(() => new Map((library.sounds ?? []).map((sound) => [sound.id, sound.name])), [library.sounds]);
  const nameOf = (assetId: string) => names.get(assetId) ?? "Sound";
  // Another GM device put a new upload on the board: fetch the library again for its name.
  const { refresh } = library;
  const missing = Boolean(view && library.sounds && boardSounds(view.board).some((assetId) => !names.has(assetId)));
  useEffect(() => {
    if (missing) void refresh().catch(() => {});
  }, [missing, refresh]);

  return (
    <section className="sound-board pane-frame pane-scene frame-col anim-view" aria-labelledby="sound-board-title">
      <header className="sound-board-heading neon-beam">
        <div className="sound-board-title">
          <Eyebrow>Shared display</Eyebrow>
          <h2 id="sound-board-title">Sound</h2>
          <p>Music and sound play on the table screen only, never on players' devices.</p>
        </div>
        <SharedScreenSwitch current="sound" />
      </header>
      <div className="sound-board-body scroll-y frame-fill">
        {!view ? (
          <p className="sound-empty">Loading the sound board…</p>
        ) : (
          <>
            <Transport view={view} nameOf={nameOf} send={send} />
            <div className="sound-board-grid">
              <div className="sound-board-col">
                <MusicSection board={view.board} nameOf={nameOf} send={send} />
                <AmbienceSection board={view.board} nameOf={nameOf} send={send} />
                <EffectsSection board={view.board} nameOf={nameOf} send={send} />
              </div>
              <div className="sound-board-col">
                <SoundLibraryPanel library={library} board={view.board} send={send} />
                <SceneSounds board={view.board} scenes={scenes} activeSceneId={activeSceneId} send={send} />
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
