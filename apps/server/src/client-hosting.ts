import { isIP } from "node:net";

export function developmentClientUrl(hostname: string, originalUrl: string, port: number) {
  const safeHostname = hostname === "localhost" || isIP(hostname) ? hostname : "localhost";
  const formattedHostname = isIP(safeHostname) === 6 ? `[${safeHostname}]` : safeHostname;
  const safePath = originalUrl.startsWith("/") ? originalUrl : `/${originalUrl}`;
  return `http://${formattedHostname}:${port}${safePath}`;
}
