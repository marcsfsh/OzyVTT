import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 3001);
const developmentClientPort = 5173;
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "data");
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
