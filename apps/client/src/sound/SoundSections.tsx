import type { SoundBoard } from "@vtt/domain";
import { Button, IconButton, IconChevron, IconMusic, IconPlay, IconSparkle, IconVolume, IconX, Switch } from "@vtt/ui";
import { LevelSlider } from "./LevelSlider";
import { formatDuration, type SendSound } from "./sound-data";

export type SectionProps = Readonly<{ board: SoundBoard; nameOf: (assetId: string) => string; send: SendSound }>;
type SlotInput = Readonly<{ assetId: string; volume: number }>;

const inputs = (slots: readonly SlotInput[]): SlotInput[] => slots.map(({ assetId, volume }) => ({ assetId, volume }));
const withLevel = (slots: readonly SlotInput[], assetId: string, volume: number) =>
  inputs(slots).map((slot) => (slot.assetId === assetId ? { ...slot, volume } : slot));
const without = (slots: readonly SlotInput[], assetId: string) =>
  inputs(slots).filter((slot) => slot.assetId !== assetId);

/** The playlist: one track at a time, in its order or shuffled, the server moving it on. */
export function MusicSection({ board, nameOf, send }: SectionProps) {
  const { tracks, shuffle, current } = board.music;
  const arrange = (next: SlotInput[], nextShuffle = shuffle) =>
    void send("sound:arrange", { music: { tracks: next, shuffle: nextShuffle } });
  const move = (index: number, by: -1 | 1) => {
    const next = inputs(tracks);
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved!);
    arrange(next);
  };
  return (
    <section className="sound-section surface-glass" aria-labelledby="sound-music-title">
      <header className="sound-section-head">
        <h3 id="sound-music-title">
          <IconMusic /> Music
        </h3>
        <Switch checked={shuffle} onChange={(on) => arrange(inputs(tracks), on)} label="Shuffle" />
      </header>
      <p className="sound-hint">One track at a time with a short crossfade. The playlist starts over at its end.</p>
      {tracks.length === 0 ? (
        <p className="sound-empty">No tracks yet. Add them from the library.</p>
      ) : (
        <ol className="sound-rows">
          {tracks.map((track, index) => {
            const name = nameOf(track.assetId);
            const playing = current?.assetId === track.assetId;
            return (
              <li
                key={track.assetId}
                className={`sound-row sound-track${playing ? " is-playing" : ""}`}
                aria-current={playing ? "true" : undefined}
              >
                <IconButton
                  label={`Play ${name}`}
                  onClick={() => void send("sound:play", { target: "music", assetId: track.assetId })}
                >
                  <IconPlay />
                </IconButton>
                <span className="sound-row-name">
                  <strong>{name}</strong>
                  <small>
                    {formatDuration(track.durationMs)}
                    {playing ? " · Playing" : ""}
                  </small>
                </span>
                <LevelSlider
                  label={`${name} volume`}
                  saved={track.volume}
                  onSend={(volume) => arrange(withLevel(tracks, track.assetId, volume))}
                />
                <span className="sound-row-tools">
                  <IconButton label={`Move ${name} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                    <IconChevron className="sound-icon-up" />
                  </IconButton>
                  <IconButton
                    label={`Move ${name} down`}
                    disabled={index === tracks.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <IconChevron />
                  </IconButton>
                  <IconButton
                    label={`Take ${name} off the playlist`}
                    onClick={() => arrange(without(tracks, track.assetId))}
                  >
                    <IconX />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Ambient layers: each loops on its own, any number together (rain and a crackling fire). */
export function AmbienceSection({ board, nameOf, send }: SectionProps) {
  const arrange = (next: SlotInput[]) => void send("sound:arrange", { ambient: next });
  return (
    <section className="sound-section surface-glass" aria-labelledby="sound-ambience-title">
      <header className="sound-section-head">
        <h3 id="sound-ambience-title">
          <IconVolume /> Ambience
        </h3>
      </header>
      <p className="sound-hint">Layers loop together. Switch each one on or off.</p>
      {board.ambient.length === 0 ? (
        <p className="sound-empty">No layers yet. Add rain, wind or a fire from the library.</p>
      ) : (
        <ul className="sound-rows">
          {board.ambient.map((layer) => {
            const name = nameOf(layer.assetId);
            return (
              <li key={layer.assetId} className={`sound-row sound-layer${layer.playing ? " is-playing" : ""}`}>
                <Switch
                  className="sound-layer-switch"
                  checked={layer.playing !== null}
                  label={name}
                  onChange={(on) =>
                    void send(on ? "sound:play" : "sound:stop", { target: "ambient", assetId: layer.assetId })
                  }
                />
                <LevelSlider
                  label={`${name} volume`}
                  saved={layer.volume}
                  onSend={(volume) => arrange(withLevel(board.ambient, layer.assetId, volume))}
                />
                <span className="sound-row-tools">
                  <IconButton
                    label={`Take ${name} off the ambience`}
                    onClick={() => arrange(without(board.ambient, layer.assetId))}
                  >
                    <IconX />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** One-shot effects: a pad per sound that plays it once on the table screen. */
export function EffectsSection({ board, nameOf, send }: SectionProps) {
  const arrange = (next: SlotInput[]) => void send("sound:arrange", { effects: next });
  return (
    <section className="sound-section surface-glass" aria-labelledby="sound-effects-title">
      <header className="sound-section-head">
        <h3 id="sound-effects-title">
          <IconSparkle /> Effects
        </h3>
      </header>
      <p className="sound-hint">Each plays once when pressed, over the music.</p>
      {board.effects.length === 0 ? (
        <p className="sound-empty">No effects yet. Add a door slam or thunder from the library.</p>
      ) : (
        <ul className="sound-pads">
          {board.effects.map((pad) => {
            const name = nameOf(pad.assetId);
            return (
              <li key={pad.assetId} className="sound-pad">
                <Button
                  className="sound-pad-fire"
                  onClick={() => void send("sound:play", { target: "effect", assetId: pad.assetId })}
                >
                  <IconPlay /> {name}
                </Button>
                <span className="sound-pad-tools">
                  <LevelSlider
                    label={`${name} volume`}
                    saved={pad.volume}
                    onSend={(volume) => arrange(withLevel(board.effects, pad.assetId, volume))}
                  />
                  <IconButton
                    label={`Take ${name} off the effects`}
                    onClick={() => arrange(without(board.effects, pad.assetId))}
                  >
                    <IconX />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
