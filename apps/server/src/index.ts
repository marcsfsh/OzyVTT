import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";

// The repo's .env is found from this file, since npm runs workspace scripts from apps/server. A variable already set
// in the environment wins over the file.
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 3001);
const developmentClientPort = 5173;
// A relative DATA_DIR is read from apps/server, where npm runs the server's scripts, so the default and an existing
// .env both find the campaign `npm run start` keeps in apps/server/data, wherever node was started.
const dataDir = resolve(fileURLToPath(new URL("..", import.meta.url)), process.env.DATA_DIR ?? "data");
const clientOrigin = process.env.CLIENT_ORIGIN;
const webDist = join(fileURLToPath(new URL("../../client/dist", import.meta.url)));
const hasBuiltClient = existsSync(join(webDist, "index.html"));
const useDevelopmentClient = process.env.npm_lifecycle_event === "dev" || !hasBuiltClient;

function lanUrls(portNumber: number) {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.add(`http://${entry.address}:${portNumber}`);
    }
  }
  return [...addresses];
}

const clientPort = useDevelopmentClient ? developmentClientPort : port;
const viewerBaseUrls = [`http://localhost:${clientPort}`, ...lanUrls(clientPort)];

const { httpServer, initialize } = createServer({
  authPath: join(dataDir, "auth.json"),
  databasePath: join(dataDir, "vtt.sqlite"),
  integrationCredentialsPath: join(dataDir, "integration-credentials.sqlite"),
  mapAssetsPath: join(dataDir, "map-assets"),
  webDist,
  useDevelopmentClient,
  developmentClientPort,
  viewerBaseUrls,
  clientOrigin
});

await initialize();
httpServer.listen(port, "0.0.0.0", () => {
  if (!useDevelopmentClient) {
    console.log(`VTT server ready on http://localhost:${port}`);
    for (const url of lanUrls(port)) console.log(`LAN join URL: ${url}`);
  } else {
    console.log(`VTT API ready on http://localhost:${port}`);
    console.log(`Development client: http://localhost:${developmentClientPort}`);
    for (const url of lanUrls(developmentClientPort)) console.log(`LAN development client: ${url}`);
  }
});
