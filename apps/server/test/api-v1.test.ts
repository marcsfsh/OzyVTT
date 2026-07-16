import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  API_VERSION,
  ApiErrorEnvelopeSchema,
  SYSTEM_PATHS,
  SystemCapabilitiesResponseSchema,
  SystemHealthResponseSchema,
  SystemVersionResponseSchema
} from "@vtt/api-contract";
import { createApiV1Router } from "../src/api-v1.js";

const servers: Array<ReturnType<ReturnType<typeof express>["listen"]>> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))); });

async function start(authorizeIntegration = (token: string, scope: string) => token === "valid-token" && scope === "system:read") {
  const app = express();
  app.use(createApiV1Router({ applicationVersion: "0.1.0-test", actorDefinitionVersion: 1, authorizeIntegration }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("API v1 system router", () => {
  it("serves public health and version responses matching the runtime contract", async () => {
    const base = await start();
    const healthResponse = await fetch(base + SYSTEM_PATHS.health);
    const health = SystemHealthResponseSchema.parse(await healthResponse.json());
    expect(healthResponse.status).toBe(200);
    expect(health.data.status).toBe("ok");
    expect(healthResponse.headers.get("cache-control")).toBe("no-store");
    expect(healthResponse.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);

    const version = SystemVersionResponseSchema.parse(await (await fetch(base + SYSTEM_PATHS.version)).json());
    expect(version.apiVersion).toBe(API_VERSION);
    expect(version.data.applicationVersion).toBe("0.1.0-test");
    expect(version.data.schemaVersions.actorDefinition).toBe(1);
  });

  it("requires system:read authorization for capability discovery", async () => {
    const base = await start();
    const missing = await fetch(base + SYSTEM_PATHS.capabilities);
    expect(missing.status).toBe(401);
    expect(ApiErrorEnvelopeSchema.parse(await missing.json()).error.code).toBe("unauthenticated");

    const forbidden = await fetch(base + SYSTEM_PATHS.capabilities, { headers: { authorization: "Bearer invalid-token" } });
    expect(forbidden.status).toBe(403);
    expect(ApiErrorEnvelopeSchema.parse(await forbidden.json()).error.code).toBe("forbidden");

    const allowed = await fetch(base + SYSTEM_PATHS.capabilities, { headers: { authorization: "Bearer valid-token" } });
    expect(allowed.status).toBe(200);
    const capabilities = SystemCapabilitiesResponseSchema.parse(await allowed.json());
    expect(capabilities.data.supportedScopes).toContain("system:read");
    expect(capabilities.data.features.webhooks).toBe(false);
  });

  it("returns stable recipient-safe errors for unknown API routes", async () => {
    const base = await start();
    const suppliedRequestId = "8d976bbc-59f4-4e1b-ac00-e198dbf40d9c";
    const response = await fetch(`${base}/api/v1/private/database`, { headers: { "x-request-id": suppliedRequestId } });
    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(suppliedRequestId);
    const body = ApiErrorEnvelopeSchema.parse(await response.json());
    expect(body.error).toEqual({ code: "not_found", message: "API route not found.", requestId: suppliedRequestId });
    expect(JSON.stringify(body)).not.toMatch(/sqlite|tokenSecret|passwordHash/i);
  });
});
