/**
 * The table's sound: the GM puts a sound on the board and plays it, and the paired table screen plays it for real
 * (an <audio> element running) while the GM's devices stay silent and show whether the room can hear it.
 */
import { GM_PASSWORD, ensureGmPassword, expect, expectPageFits, press, signInAsGm, test } from "./smoke";

/** A WAV of a soft 440 Hz tone, built here so the suite carries no binary. */
function toneWav(seconds: number, sampleRate = 22_050): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const file = Buffer.alloc(44 + samples * 2);
  file.write("RIFF", 0, "latin1");
  file.writeUInt32LE(36 + samples * 2, 4);
  file.write("WAVEfmt ", 8, "latin1");
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20);
  file.writeUInt16LE(1, 22);
  file.writeUInt32LE(sampleRate, 24);
  file.writeUInt32LE(sampleRate * 2, 28);
  file.writeUInt16LE(2, 32);
  file.writeUInt16LE(16, 34);
  file.write("data", 36, "latin1");
  file.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++)
    file.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 6_000), 44 + index * 2);
  return file;
}

test("the GM plays music on the table screen and sees that the room hears it", async ({ open, request }) => {
  await ensureGmPassword(request);
  const { token } = (await (await request.post("/api/v1/host/gm/sign-in", { data: { password: GM_PASSWORD } })).json())
    .data;

  // A paired table screen, before any sound is on the board.
  const pairing = await request.post("/api/v1/viewer/pairings", {
    headers: { authorization: `Bearer ${token}` },
    data: {}
  });
  const code = (await pairing.json()).data.pairing.code as string;
  const screen = await open("/viewer.html");
  const paired = await screen.request.post("/api/v1/viewer/pairings/exchange", { data: { code, name: "Smoke TV" } });
  expect(paired.ok()).toBe(true);
  await screen.reload();

  const gm = await open("/");
  await signInAsGm(gm);
  await press(gm.getByRole("tab", { name: "Shared screen" }));
  await press(gm.getByRole("button", { name: "Sound" }));
  await expect(gm.getByRole("heading", { name: "Sound", level: 2 })).toBeVisible();
  await expectPageFits(gm);

  // Upload through the library's own file button, then put the sound on the playlist and play it.
  const chooser = gm.waitForEvent("filechooser");
  await press(gm.getByRole("button", { name: "Add sounds…" }));
  await (await chooser).setFiles({ name: "Smoke Tone.wav", mimeType: "audio/wav", buffer: toneWav(30) });
  await expect(gm.getByText("Smoke Tone.wav added to the library.")).toBeVisible();
  await press(gm.getByRole("button", { name: "Add Smoke Tone to the playlist" }));
  await expect(gm.getByRole("button", { name: "Play Smoke Tone" })).toBeVisible();
  await press(gm.getByRole("button", { name: "Play music" }));
  await expect(gm.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expectPageFits(gm);

  // The table screen plays it. Where the browser holds sound back, the screen asks for the tap a person would give.
  const unlock = screen.getByRole("button", { name: "Tap to turn on sound" });
  if (await unlock.isVisible()) await press(unlock);
  const music = screen.locator('audio[data-kind="music"]');
  await expect(music).toHaveCount(1);
  await expect
    .poll(() => music.evaluate((element: HTMLAudioElement) => !element.paused && element.currentTime > 0.2))
    .toBe(true);
  await expect(gm.getByText("Smoke TV · Sound on")).toBeVisible();
  // Only the table screen makes sound: the GM's page has no audio at all.
  await expect(gm.locator("audio")).toHaveCount(0);

  // Mid-fight, the Table tab's control pauses it.
  await press(gm.getByRole("tab", { name: "Table" }));
  const control = gm.getByRole("region", { name: "Sound" });
  await expect(control.getByText("Smoke Tone")).toBeVisible();
  await expectPageFits(gm);
  await press(control.getByRole("button", { name: "Pause sound" }));
  await expect.poll(() => music.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await press(control.getByRole("button", { name: "Resume sound" }));
  await expect.poll(() => music.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);

  // Leave the board silent for whatever runs next.
  await press(gm.getByRole("tab", { name: "Shared screen" }));
  await press(gm.getByRole("button", { name: "Stop all" }));
  await expect(music).toHaveCount(0);
});
