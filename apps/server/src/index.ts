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

// In a container the network interfaces are the container's own, so JOIN_URL names the addresses players open
// (comma-separated, each with its port).
const joinUrls = (process.env.JOIN_URL ?? "")
  .split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean);
for (const url of joinUrls)
  if (!/^https?:\/\/[^/]+$/i.test(url))
    console.warn(`JOIN_URL has "${url}", which is not an address like http://192.168.1.50:3001.`);

function lanUrls(portNumber: number) {
  if (joinUrls.length > 0) return joinUrls;
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

// In Docker a browser on the host reaches the server from the container network, never from loopback, so the first
// password is set from inside the container.
const gmSetupHint = process.env.OZYVTT_DOCKER
  ? "OzyVTT runs in Docker. On the computer that runs it, set the GM password with docker exec -it ozyvtt npm run gm-password."
  : undefined;

const { httpServer, initialize } = createServer({
  authPath: join(dataDir, "auth.json"),
  databasePath: join(dataDir, "vtt.sqlite"),
  integrationCredentialsPath: join(dataDir, "integration-credentials.sqlite"),
  mapAssetsPath: join(dataDir, "map-assets"),
  webDist,
  useDevelopmentClient,
  developmentClientPort,
  viewerBaseUrls,
  clientOrigin,
  gmSetupHint
});

// As PID 1 in a container, node ignores a signal it has no handler for, and `docker stop` would wait out its timeout.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

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
