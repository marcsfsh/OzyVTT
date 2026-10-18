import { CODEX_ROUTES } from "./codex.js";
import { CONTENT_ROUTES } from "./content.js";
import type { ApiRoute } from "./define.js";
import { ENCOUNTER_ROUTES } from "./encounters.js";
import { GAME_ROUTES } from "./game.js";
import { HOMEBREW_ROUTES } from "./homebrew.js";
import { HOST_ROUTES } from "./host.js";
import { MAP_ASSET_ROUTES, SOUND_ASSET_ROUTES, TOKEN_ASSET_ROUTES } from "./assets.js";
import { CREDENTIAL_ROUTES, SESSION_ROUTES, SYSTEM_ROUTES } from "./system.js";
import { VIEWER_ROUTES } from "./viewer.js";

/**
 * The route registry: every HTTP operation the server mounts, declared once. The game commands' routes are made
 * from the server's command table with `gameCommandRoute` and join these where the document is built.
 */

export * from "./define.js";
export * from "./tags.js";
export { named, nameOf, namedSchemas, documentAs, documentedAs } from "./components.js";
export { gameCommandRoute, type CommandDefinition } from "./commands.js";
export * as systemRoutes from "./system.js";
export * as hostRoutes from "./host.js";
export * as assetRoutes from "./assets.js";
export * as viewerRoutes from "./viewer.js";
export * as gameRoutes from "./game.js";
export * as contentRoutes from "./content.js";
export * as encounterRoutes from "./encounters.js";
export * as codexRoutes from "./codex.js";
export * as homebrewRoutes from "./homebrew.js";

/** Every route but the game commands', in the order the document lists them within each tag. */
export const API_ROUTES: readonly ApiRoute[] = [
  ...SYSTEM_ROUTES,
  ...HOST_ROUTES,
  ...CREDENTIAL_ROUTES,
  ...SESSION_ROUTES,
  ...GAME_ROUTES,
  ...CONTENT_ROUTES,
  ...ENCOUNTER_ROUTES,
  ...MAP_ASSET_ROUTES,
  ...TOKEN_ASSET_ROUTES,
  ...SOUND_ASSET_ROUTES,
  ...VIEWER_ROUTES,
  ...CODEX_ROUTES,
  ...HOMEBREW_ROUTES
];
