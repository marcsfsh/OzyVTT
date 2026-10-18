/**
 * Sets the first GM password through the server's setup route, which answers only loopback. It runs on the computer
 * that runs OzyVTT while the server is up: `npm run gm-password`, or in Docker, where a browser on the host never
 * reaches the server from loopback, `docker exec -it ozyvtt npm run gm-password`.
 */
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

// The server's port, from the environment or the repo's .env as the server reads it.
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const port = process.env.PORT ?? "3001";

// The typed password is not echoed: the prompt is written, then the terminal output is muted until Enter.
let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  }
});
const prompt = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
const answer = prompt.question("New GM password (at least 12 characters): ");
muted = true;
const password = await answer;
prompt.close();
process.stdout.write("\n");

try {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/host/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password })
  });
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (response.ok) console.log("The GM password is set. Sign in as the GM from any device on the network.");
  else {
    console.error(body?.error?.message ?? `The server answered ${response.status}.`);
    process.exitCode = 1;
  }
} catch {
  console.error(`No OzyVTT server answered on port ${port}. Start it, then run this again.`);
  process.exitCode = 1;
}
