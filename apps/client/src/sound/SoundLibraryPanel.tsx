import { useRef, useState } from "react";
import type { SoundBoard } from "@vtt/domain";
import {
  Button,
  IconButton,
  IconMusic,
  IconPencil,
  IconPlus,
  IconSparkle,
  IconTrash,
  IconVolume,
  Input,
  useToast
} from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { formatDuration, type SendSound, type SoundAsset, type useSoundLibrary } from "./sound-data";

/** A sound added to the board starts a little under full, so a loud file doesn't drown the rest. */
const START_LEVEL = 0.8;
const ACCEPT = "audio/*,.mp3,.ogg,.oga,.opus,.wav,.m4a,.aac,.webm,.flac";

type Library = ReturnType<typeof useSoundLibrary>;
type Slot = "music" | "ambient" | "effects";

/** The GM's uploaded sounds: upload, rename, delete, and put on the board as music, ambience or an effect. */
export function SoundLibraryPanel({
  library,
  board,
  send
}: Readonly<{ library: Library; board: SoundBoard; send: SendSound }>) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<Readonly<{ id: string; name: string }> | null>(null);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const sounds = library.sounds ?? [];
  const onBoard = (slot: Slot, id: string) =>
    (slot === "music" ? board.music.tracks : slot === "ambient" ? board.ambient : board.effects).some(
      (entry) => entry.assetId === id
    );

  const uploadFiles = async (files: readonly File[]) => {
    setBusy(true);
    for (const file of files) {
      try {
        const { duplicate } = await library.upload(file);
        toast(duplicate ? `${file.name} is already in the library.` : `${file.name} added to the library.`, {
          tone: "success"
        });
      } catch (error) {
        toast(`${file.name}: ${(error as Error).message}`, { tone: "error" });
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const add = (slot: Slot, sound: SoundAsset) => {
    const slots = (list: readonly { assetId: string; volume: number }[]) => [
      ...list.map(({ assetId, volume }) => ({ assetId, volume })),
      { assetId: sound.id, volume: START_LEVEL }
    ];
    if (slot === "music")
      void send("sound:arrange", { music: { tracks: slots(board.music.tracks), shuffle: board.music.shuffle } });
    else if (slot === "ambient") void send("sound:arrange", { ambient: slots(board.ambient) });
    else void send("sound:arrange", { effects: slots(board.effects) });
  };

  const rename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!renaming) return;
    try {
      await library.rename(renaming.id, renaming.name);
      setRenaming(null);
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
    }
  };

  const remove = async (sound: SoundAsset) => {
    const ok = await confirm({
      title: `Delete ${sound.name}?`,
      body: "It comes off the sound board and every scene's sound, and stops if it is playing.",
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;
    try {
      await library.remove(sound.id);
      toast(`${sound.name} deleted.`, { tone: "success" });
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
    }
  };

  return (
    <section className="sound-section sound-library surface-glass" aria-labelledby="sound-library-title">
      <header className="sound-section-head">
        <h3 id="sound-library-title">Library</h3>
        <Button disabled={busy} onClick={() => fileRef.current?.click()}>
          <IconPlus /> {busy ? "Uploading…" : "Add sounds…"}
        </Button>
        <input
          ref={fileRef}
          className="sound-file-input"
          type="file"
          multiple
          accept={ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => void uploadFiles([...(event.target.files ?? [])])}
        />
      </header>
      <p className="sound-hint">
        Sounds you have the right to play: MP3, Ogg, WAV, M4A, AAC, WebM or FLAC, up to 50 MB each. The app comes with
        none.
      </p>
      {library.sounds === null ? (
        <p className="sound-empty">Loading the library…</p>
      ) : sounds.length === 0 ? (
        <p className="sound-empty">No sounds yet.</p>
      ) : (
        <ul className="sound-rows">
          {sounds.map((sound) => (
            <li key={sound.id} className="sound-row sound-asset">
              {renaming?.id === sound.id ? (
                <form className="sound-rename" onSubmit={(event) => void rename(event)}>
                  <Input
                    aria-label={`New name for ${sound.name}`}
                    value={renaming.name}
                    maxLength={120}
                    autoFocus
                    onChange={(event) => setRenaming({ id: sound.id, name: event.target.value })}
                  />
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <span className="sound-row-name">
                  <strong>{sound.name}</strong>
                  <small>
                    {formatDuration(sound.durationMs)} · {sound.format.toUpperCase()}
                  </small>
                </span>
              )}
              <span className="sound-asset-add" role="group" aria-label={`Put ${sound.name} on the board`}>
                {(
                  [
                    ["music", "Music", "In playlist", "the playlist", <IconMusic key="icon" />],
                    ["ambient", "Ambience", "In ambience", "the ambience", <IconVolume key="icon" />],
                    ["effects", "Effect", "In effects", "the effects", <IconSparkle key="icon" />]
                  ] as const
                ).map(([slot, label, added, where, icon]) =>
                  onBoard(slot, sound.id) ? (
                    // Already there: said in words at full strength, with no dimmed button.
                    <span key={slot} className="sound-asset-in">
                      {icon} {added}
                    </span>
                  ) : (
                    <Button
                      key={slot}
                      size="sm"
                      aria-label={`Add ${sound.name} to ${where}`}
                      onClick={() => add(slot, sound)}
                    >
                      {icon} {label}
                    </Button>
                  )
                )}
              </span>
              <span className="sound-row-tools">
                <IconButton
                  label={`Rename ${sound.name}`}
                  onClick={() => setRenaming({ id: sound.id, name: sound.name })}
                >
                  <IconPencil />
                </IconButton>
                <IconButton label={`Delete ${sound.name}`} onClick={() => void remove(sound)}>
                  <IconTrash />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </section>
  );
}
