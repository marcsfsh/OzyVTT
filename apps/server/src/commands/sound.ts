import {
  SoundArrangeSchema,
  SoundNextTrackSchema,
  SoundPauseSchema,
  SoundPlaySchema,
  SoundScenePresetSchema,
  SoundStopSchema
} from "@vtt/domain/commands";
import { CommandRejectedError } from "../game-store.js";
import {
  applyScenePreset,
  arrangeBoard,
  clearScenePreset,
  nextTrack,
  playEffect,
  playMusic,
  prunePresets,
  saveScenePreset,
  setLayerPlaying,
  setPaused,
  setPresetAutoplay,
  stopAll,
  stopMusic
} from "../sound-board.js";
import type { Kit, SoundPort } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// The table's music and ambient sound (ADR-0024). All of it is the GM's. The board lives in its own store, so these
// commands leave the game revision alone and answer with the board's own revision beside it.

const GM_ONLY = "Only the GM controls the table's sound.";

function soundOf(kit: Kit): SoundPort {
  if (!kit.context.sound) throw new CommandRejectedError("Sound is not available on this server.");
  return kit.context.sound;
}

/** The game revision is unchanged by a sound command; it is reported so the reply keeps the usual shape. */
const accepted = (kit: Kit, result: Readonly<{ soundRevision: number; duplicate: boolean }>) => ({
  revision: kit.read().revision,
  soundRevision: result.soundRevision,
  duplicate: result.duplicate
});

export const soundCommands = [
  defineCommand({
    type: "sound.arrange",
    operationId: "arrangeSound",
    description:
      "Replaces any part of the sound board's arrangement (GM-grade only): the master volume, the playlist (its tracks, their order and volumes, and shuffle), the ambient layers and the effect pads. A part left out stays as it is. A sound new to the board must be in the sound library. What stays on the board keeps playing at its new volume; what is taken off stops. Answers with the board's own `soundRevision`; the game `revision` is unchanged.",
    summary: "Arrange the sound board: master volume, playlist, ambient layers and effect pads (GM).",
    schema: SoundArrangeSchema,
    malformed: "The sound board arrangement is malformed.",
    gmOnly: GM_ONLY,
    async run({ request }, kit) {
      const sound = soundOf(kit);
      const { commandId, ...arrangement } = request;
      return accepted(
        kit,
        await sound.run(commandId, (board, deps) => arrangeBoard(board, arrangement, sound.durationOf, deps))
      );
    }
  }),

  defineCommand({
    type: "sound.play",
    operationId: "playSound",
    description:
      "Starts sound on the table screen (GM-grade only): the playlist (at `assetId`, or its first track, or a random one when shuffled), an ambient layer, a one-shot effect, or an encounter's saved sound (`encounterId`). Playing anything lifts a pause. The server moves the playlist on by itself, with a short crossfade.",
    summary: "Play the playlist, an ambient layer, an effect, or an encounter's saved sound on the table screen (GM).",
    schema: SoundPlaySchema,
    malformed: "The sound to play is malformed.",
    issueMessage: true,
    gmOnly: GM_ONLY,
    async run({ request }, kit) {
      const { commandId, target, assetId, encounterId } = request;
      const result = await soundOf(kit).run(commandId, (board, deps) => {
        if (target === "music") playMusic(board, assetId, deps);
        else if (target === "ambient") setLayerPlaying(board, assetId!, true, deps);
        else if (target === "effect") playEffect(board, assetId!, deps);
        else if (!applyScenePreset(board, encounterId!, deps))
          throw new CommandRejectedError("That encounter has no sound saved.");
      });
      return accepted(kit, result);
    }
  }),

  defineCommand({
    type: "sound.stop",
    operationId: "stopSound",
    description:
      "Stops the music, one ambient layer (`assetId`), or everything playing on the table screen (GM-grade only). The board's arrangement stays.",
    summary: "Stop the music, an ambient layer, or all sound (GM).",
    schema: SoundStopSchema,
    malformed: "The sound to stop is malformed.",
    issueMessage: true,
    gmOnly: GM_ONLY,
    async run({ request }, kit) {
      const { commandId, target, assetId } = request;
      const result = await soundOf(kit).run(commandId, (board, deps) => {
        if (target === "music") stopMusic(board);
        else if (target === "ambient") setLayerPlaying(board, assetId!, false, deps);
        else stopAll(board);
      });
      return accepted(kit, result);
    }
  }),

  defineCommand({
    type: "sound.next-track",
    operationId: "nextSoundTrack",
    description:
      "Moves the playlist to its next track now, with the usual crossfade (GM-grade only). Starts the playlist when no music is playing.",
    summary: "Skip to the playlist's next track (GM).",
    schema: SoundNextTrackSchema,
    malformed: "The next-track command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request }, kit) {
      return accepted(kit, await soundOf(kit).run(request.commandId, (board, deps) => nextTrack(board, deps)));
    }
  }),

  defineCommand({
    type: "sound.pause",
    operationId: "pauseSound",
    description:
      "Pauses or resumes everything playing on the table screen (GM-grade only). A paused board holds its place: each sound carries on from where it stopped.",
    summary: "Pause or resume all sound on the table screen (GM).",
    schema: SoundPauseSchema,
    malformed: "The pause command is malformed.",
    gmOnly: GM_ONLY,
    async run({ request }, kit) {
      const { commandId, paused } = request;
      return accepted(kit, await soundOf(kit).run(commandId, (board, deps) => setPaused(board, paused, deps)));
    }
  }),

  defineCommand({
    type: "sound.set-encounter-preset",
    operationId: "setEncounterSound",
    description:
      "Gives a prepared encounter a sound of its own (GM-grade only): `preset: save-current` saves the board's playlist and the ambient layers that are on, `clear` removes it, and `autoplay` says whether it starts when the encounter goes live. Sounds of encounters that no longer exist are dropped.",
    summary: "Save, clear, or switch on or off the sound an encounter starts when it goes live (GM).",
    schema: SoundScenePresetSchema,
    malformed: "The encounter sound command is malformed.",
    issueMessage: true,
    gmOnly: GM_ONLY,
    async run({ request }, kit) {
      const { commandId, encounterId, preset, autoplay } = request;
      const encounterIds = new Set(kit.read().combat.encounters.map((scene) => scene.id));
      if (preset !== "clear" && !encounterIds.has(encounterId))
        throw new CommandRejectedError("That encounter no longer exists.");
      const result = await soundOf(kit).run(commandId, (board) => {
        prunePresets(board, encounterIds);
        if (preset === "save-current") saveScenePreset(board, encounterId);
        else if (preset === "clear") clearScenePreset(board, encounterId);
        if (autoplay !== undefined) setPresetAutoplay(board, encounterId, autoplay);
      });
      return accepted(kit, result);
    }
  })
];
