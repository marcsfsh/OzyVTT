/**
 * Starts the server from source on `PORT` against a fresh temporary data directory, serving the
 * built client. The smoke suite starts one per viewport, so each begins with no GM password.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Without a build the server would redirect to the Vite dev client, which is not running.
if (!existsSync(new URL("../apps/client/dist/index.html", import.meta.url))) {
  console.error("The smoke suite serves the built client. Run `npm run build` first.");
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "ozyvtt-smoke-"));
process.env.DATA_DIR = dataDir;
process.on("exit", () => rmSync(dataDir, { recursive: true, force: true }));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

await import("../apps/server/src/index.js");
