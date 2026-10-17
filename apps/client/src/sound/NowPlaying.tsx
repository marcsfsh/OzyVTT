import { useMemo } from "react";
import { IconButton, IconMusic, IconPause, IconPlay, IconVolume, IconVolumeOff } from "@vtt/ui";
import { navigate, SOUND_BOARD_PATH } from "../router";
import { isSounding, playOrPause, useSoundBoard, useSoundCommand, useSoundLibrary } from "./sound-data";
import { LevelSlider } from "./LevelSlider";
import "./now-playing.css";

/**
 * The sound board's pocket version for the Table tab, for use mid-fight: play or pause, the table's volume, what
 * is on, and whether the table screen can be heard. The full board is one tap away. Renders nothing until the
 * board holds something to play.
 */
export function NowPlaying({ token }: Readonly<{ token: string }>) {
  const view = useSoundBoard();
  const { sounds } = useSoundLibrary(token);
  const send = useSoundCommand();
  const names = useMemo(() => new Map((sounds ?? []).map((sound) => [sound.id, sound.name])), [sounds]);
  if (!view) return null;
  const { board, screens } = view;
  if (!board.music.tracks.length && !board.ambient.length && !board.effects.length) return null;
  const nameOf = (assetId: string) => names.get(assetId) ?? "Sound";
  const paused = board.pausedAt !== null;
  const sounding = isSounding(board);
  const layers = board.ambient.filter((layer) => layer.playing).map((layer) => nameOf(layer.assetId));
  const on = board.music.current ? nameOf(board.music.current.assetId) : layers.join(", ") || "Nothing playing";
  const tables = screens.filter((screen) => screen.sound !== "muted");
  const waiting = tables.some((screen) => screen.sound === "blocked");
  const heard = tables.some((screen) => screen.sound === "on");
  const screenLine = !tables.length
    ? "No table screen"
    : waiting
      ? "Table screen waits for a tap"
      : heard
        ? "Table screen sound on"
        : "Checking the table screen";
  const action = paused ? "Resume sound" : sounding ? "Pause sound" : "Play music";
  return (
    <section className={`now-playing${waiting ? " is-waiting" : ""}`} aria-label="Sound">
      <IconButton
        label={action}
        disabled={!sounding && !paused && !board.music.tracks.length}
        onClick={() => void playOrPause(board, send)}
      >
        {sounding && !paused ? <IconPause /> : <IconPlay />}
      </IconButton>
      <button type="button" className="now-playing-what" onClick={() => navigate(SOUND_BOARD_PATH)}>
        <span className="now-playing-title">
          <IconMusic />
          <span>{paused ? `Paused · ${on}` : on}</span>
        </span>
        <span className="now-playing-screen">
          {heard && !waiting ? <IconVolume /> : <IconVolumeOff />}
          {screenLine}
        </span>
        <span className="nh-sr-only">Open the sound board</span>
      </button>
      <LevelSlider
        label="Table volume"
        saved={board.masterVolume}
        onSend={(level) => void send("sound:arrange", { masterVolume: level })}
      />
    </section>
  );
}
