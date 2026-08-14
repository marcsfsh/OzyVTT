/**
 * A module-loader stub for Node scripts that import client sources: `.css` imports resolve to an
 * empty module instead of `ERR_UNKNOWN_FILE_EXTENSION`. Vitest does this for tests; this is the
 * same courtesy for `generate-parity-audit.ts`, whose import graph reaches UI primitives.
 *
 * Self-registering: `--import` this file on the main thread and it installs itself as a loader;
 * the loader thread then imports it again purely for the `load` hook below.
 */
import { register } from "node:module";
import { isMainThread } from "node:worker_threads";

if (isMainThread) {
  register(new URL(import.meta.url));
  // tsx compiles JSX against the tsconfig nearest the cwd — the solution-style file, which carries
  // no `jsx` — so workspace TSX lands on the classic runtime and expects a global `React`. Nothing
  // in a docs script renders; the global satisfies the transform.
  const react = await import("react");
  globalThis.React ??= react.default ?? react;
}

export async function load(url, context, nextLoad) {
  if (url.split("?")[0].endsWith(".css")) {
    return { format: "module", source: "export default {};", shortCircuit: true };
  }
  return nextLoad(url, context);
}
