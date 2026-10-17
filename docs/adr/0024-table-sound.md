# ADR-0024: Music and ambient sound on the table screen

## Status

Accepted — 2026-10-17.

## Context and decision drivers

The GM wants music, ambience and sound effects at the table. The owner decided that sound plays on the table
screen only (the paired table viewer, usually a TV): players' phones never play it, and the GM's laptop doesn't
either. The app ships no music, for licensing; the GM uploads files they have the right to play.

The invariants decide most of the shape:

- **The server decides.** What plays, from when, at what level, which track comes next and in what shuffled order
  are server state. The table screen only plays what it is told.
- **Projections are the boundary.** The library (file names, the GM's names for them), the playlist, the effect
  pads and the scene sounds are GM data. A sound's name can spoil a scene ("Dragon ambush").
- **Phones are first-class**, for the GM's controls; the table screen is a TV.

Two practical drivers: players' token moves and annotations are checked against the game revision
(`expectedRevision`), so a change that bumps it mid-fight turns into a stale-revision refusal for whoever is
dragging; and browsers refuse to start sound until a person has touched the page.

## Considered options

- **Where the board lives.**
  - In `GameState`, through the game store. Rejected: every volume nudge and every automatic track change would bump
    the game revision (refusing in-flight token moves), land in the fight's journal, and rewrite the whole game blob.
  - Inside the viewer presentation store, synced like the encounter. Rejected: each change would bump the
    presentation revision the GM's ping and measure commands carry, and the store would hold a second copy.
  - **Its own store (chosen)**, with its own revision and receipts, like the Codex and homebrew stores. The commands
    still go in the game command table, so both transports, the GM-only gate, the OpenAPI document and the app map
    come from one definition; they write the sound store and leave the game revision alone.
- **Who moves the playlist on.**
  - The table screen, reporting when a track ends. Rejected: two screens disagree, and with no screen nothing moves.
  - **The server, from each file's length (chosen).** The length is read from the file at upload, which the upload
    check walks anyway, and one timer hands over to the next track.
- **How the screen plays.**
  - Decoding each file into Web Audio buffers: gapless loops, but a five-minute stereo track is about 100 MB of
    samples, too much for a TV browser with three layers going.
  - **Streamed `<audio>` elements routed through Web Audio gain nodes (chosen)**: small memory, fast start, smooth
    fades. A loop restarts through the element, so an MP3 loop can carry its encoder's tiny gap; Ogg, WAV and FLAC
    loop cleanly.

## Decision

**Library** (`audio-assets.ts`, `sound-catalog.ts`, `sound-http.ts`). GM-only routes under `/api/v1/sound-assets`
upload, list, rename and delete. Files are content-addressed like map images. The upload is sniffed from its bytes
(MP3, ADTS AAC, M4A/AAC, Ogg Vorbis or Opus, WAV PCM, WebM Opus or Vorbis, FLAC) and walked far enough to read its
length and refuse a file cut short (a frame or page running past the end, a missing end-of-stream page, a failed
last-frame CRC), one holding video, or one that isn't sound, with a message saying which. The cap is 50 MB: about
50 minutes of MP3, and the file sits in the laptop's memory while it is checked and crosses the Wi-Fi before it
plays. Deleting a sound takes it off the board and every scene sound first.

**Board** (`sound-board.ts`, `sound-store.ts`, `sound-service.ts`). One row in its own table: a master level; a
playlist of tracks (each with its own level), shuffle, the current track and the rest of the shuffled pass; ambient
layers, each looping on its own and switched on or off; effect pads; the one-shots fired and still sounding; a
pause that freezes every position; and a sound per scene. The server hands a track over a 2-second crossfade before
its end, and the next track starts at that moment rather than when the timer happened to fire, so every screen
agrees. A shuffled playlist plays each track once per pass and never opens a pass with the track that just played.
Playing anything lifts a pause.

**Commands** (`commands/sound.ts`): `sound.arrange`, `sound.play`, `sound.stop`, `sound.next-track`, `sound.pause`
and `sound.set-scene-preset`, all GM-grade (`scene:write`), plus the GM-only read `sound:board`. Each answers with
the board's `soundRevision` beside the unchanged game `revision`. The GM's devices get the board as `sound:changed`
on every change; no player socket is ever sent it.

**Scene sound.** The GM saves what the board holds (the playlist and the layers that are on) to a prepared scene.
When the scene goes live (`scene.activate`, or `scene.create` with `activate`) its sound starts, unless the GM
switched "Starts when live" off. Effect pads are left alone.

**Table screen** (`viewer-coordinator.ts`, `viewer/sound-engine.ts`, `viewer/TableSound.tsx`). The viewer feed's
projection gains `sound`, composed when it is sent rather than stored, so a sound change never bumps the
presentation revision: the master level, whether it is paused, and for the music, each playing layer and each
sounding effect only its play id, file id, level and how far in it is at that moment. The screen plays each at that
position plus the time since it arrived, so a screen that connects late joins mid-track, and only re-seeks when it
has drifted more than 1.5 s. It may fetch a file only while it is in that projection (an effect a few seconds
longer, for a screen that heard of it late). Until the browser allows sound the screen shows "Tap to turn on
sound" and reports `blocked`; once tapped it reports `on`; it also reports any file its browser couldn't play. The
GM's in-tab preview and pop-out load `/viewer.html?preview` and never play.

**GM controls.** The full board is the Shared screen tab's second view (`/viewer-controls/sound`): now playing and
the table screens' state, play or pause, next track, stop all and the master level; the playlist, ambience and
effects; the library; and scene sound. The Table tab carries one small, self-contained row (`sound/NowPlaying.tsx`):
play or pause, the table's volume, what is on and whether the table screen can be heard, opening the board on a tap.

## Consequences and tradeoffs

- A volume change reaches the table screen within one feed message; the browser check measured an effect starting
  on the screen about 60 ms after the GM's tap, and two screens within 10 ms of each other on the same track.
- Screen reports are memory-only; a screen reports again whenever its feed reconnects.
- Not every browser build plays AAC (open-source Chromium on Linux doesn't); the GM sees which sounds a screen
  can't play.
- Duplicating a scene doesn't copy its sound, and a removed scene's sound is dropped the next time any scene sound
  is saved.
- The GM can't audition a sound on the laptop, by the owner's decision.

## Mobile, security, and visibility impact

Players receive nothing: no projection field, no socket event, and every sound route and command refuses a player
token. The table screen receives only what is playing, with file ids and no names, and fetches only those files with
its own pairing cookie; tests pin both, in `sound-http.test.ts` and `sound-board.test.ts`. The GM's controls work at
390 px with touch (44 px targets, levels as native range inputs) and at laptop width.

## Migration / reversibility

Additive: two new tables (`sound_board_state`, `sound_catalog`) in the shared database, a `sound-assets/` directory
beside the map assets, and an optional `sound` field on the viewer projection. Removing the feature drops those and
the commands; nothing else changes shape.

## Validation evidence

`apps/server/test/audio-assets.test.ts` (each container, cut files, non-sound and video files, and a cross-check
against ffmpeg's own output when ffmpeg is installed), `sound-board.test.ts` (playlist order, shuffle passes,
crossfade hand-over, pause, projection contents, scene sound, deletion), `sound-http.test.ts` (GM-only library and
commands, the game revision untouched, the feed and file access of a table screen, late join, screen status,
automatic hand-over, scene sound on going live); `apps/client/src/viewer/sound-engine.test.ts` (waiting for a tap,
joining mid-track, loops, crossfade, pause, drift, late effects, unplayable files) and `sound/sound-board.test.tsx`;
the smoke journey `e2e/sound.spec.ts` at 390x844 with touch and 1280x800, playing a real WAV on a paired screen.
