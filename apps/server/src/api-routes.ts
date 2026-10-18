import { buildOpenApiDocument } from "@vtt/api-contract/openapi";
import { API_ROUTES, gameCommandRoute, type ApiRoute } from "@vtt/api-contract/routes";
import { gameCommands } from "./commands/index.js";

/**
 * Every HTTP operation the server mounts, from the route registry in `@vtt/api-contract/routes`: the declared routes
 * and one per game command, made from the command table. The OpenAPI document at `/api/v1/openapi.json` is built
 * from these alone, and `api-routes.test.ts` fails when a mounted route has no entry here or an entry no route.
 */
export const apiRoutes: readonly ApiRoute[] = [...API_ROUTES, ...gameCommands.map(gameCommandRoute)];

export const openApiDocument = buildOpenApiDocument(apiRoutes);
