/**
 * The HTTP shapes the server's routers parse and answer with, beyond the ones in the package root. Kept out of the
 * root so the client, which imports the root for its path constants, does not load them.
 */
export * from "./assets.js";
export * from "./codex.js";
export * from "./host.js";
export * from "./viewer.js";
