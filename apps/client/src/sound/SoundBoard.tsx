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
import { useMediaQuery } from "../lib/useMediaQuery";
import { replaceQuery, useRoute } from "../router";

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
 * The GM's sound board, the Table screen tab's second view: what plays on the table screen and how loud, the
 * library it plays from, and each scene's own sound. Sound comes out of the table screen only; this device and
 * the players' stay silent.
 */
const PARTS = ["playlist", "ambience", "effects", "library", "unused"] as const;
type Part = (typeof PARTS)[number];

export function SoundBoard({
  gmToken,
  scenes,
  activeEncounterId
}: Readonly<{
  gmToken: string;
  scenes: readonly Readonly<{ id: string; name: string }>[];
  activeEncounterId: string | null;
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
  const phone = useMediaQuery("(max-width: 760px)");
  const { query } = useRoute();
  const part = PARTS.includes(query.get("part") as Part) ? (query.get("part") as Part) : "playlist";
  const onBoard = new Set(view ? boardSounds(view.board) : []);
  const unused = (library.sounds ?? []).filter((sound) => !onBoard.has(sound.id));
  const partButton = (id: Part, label: string, count: number) => (
    <button
      type="button"
      className={part === id ? "sound-board-side-row interactive is-on" : "sound-board-side-row interactive"}
      aria-pressed={part === id}
      onClick={() => replaceQuery((params) => (id === "playlist" ? params.delete("part") : params.set("part", id)))}
    >
      <span>{label}</span>
      <span className="sound-board-side-count">{count}</span>
    </button>
  );

  return (
    <section className="sound-board pane-frame pane-scene frame-col anim-view" aria-labelledby="sound-board-title">
      <header className="sound-board-heading neon-beam">
        <div className="sound-board-title">
          <Eyebrow>Table screen</Eyebrow>
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
            {/* The board as kinds at the side (E3 spec 2.1): what is on the board, then the library; the chosen part
                is in the address, its rows at the right. On a phone the parts are chips. */}
            <div className={phone ? "sound-board-parts is-phone" : "sound-board-parts"}>
              <nav className="sound-board-side" aria-label="Sound board">
                <p className="sound-board-side-head">On the board</p>
                {partButton("playlist", "Playlist", view.board.music.tracks.length)}
                {partButton("ambience", "Ambience", view.board.ambient.length)}
                {partButton("effects", "Effects", view.board.effects.length)}
                <p className="sound-board-side-head">Library</p>
                {partButton("library", "All sounds", library.sounds?.length ?? 0)}
                {partButton("unused", "Not on the board", unused.length)}
              </nav>
              <div className="sound-board-part">
                {part === "playlist" && <MusicSection board={view.board} nameOf={nameOf} send={send} />}
                {part === "ambience" && <AmbienceSection board={view.board} nameOf={nameOf} send={send} />}
                {part === "effects" && <EffectsSection board={view.board} nameOf={nameOf} send={send} />}
                {(part === "library" || part === "unused") && (
                  <SoundLibraryPanel
                    library={part === "unused" ? { ...library, sounds: unused } : library}
                    board={view.board}
                    send={send}
                  />
                )}
                {part === "playlist" && (
                  <SceneSounds board={view.board} scenes={scenes} activeEncounterId={activeEncounterId} send={send} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
