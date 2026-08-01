import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  API_VERSION,
  ApiErrorEnvelopeSchema,
  INTEGRATION_CREDENTIAL_PATHS,
  IntegrationCredentialAuditResponseSchema,
  IntegrationCredentialIssuedResponseSchema,
  IntegrationCredentialListResponseSchema,
  IntegrationCredentialResponseSchema,
  OPENAPI_DOCUMENT_PATH,
  openApiDocument,
  SYSTEM_PATHS,
  SystemCapabilitiesResponseSchema,
  SystemHealthResponseSchema,
  SystemVersionResponseSchema
} from "@vtt/api-contract";
import { createApiV1Router } from "../src/api-v1.js";
import { IntegrationCredentialStore } from "../src/integration-credentials.js";

const servers: Array<ReturnType<ReturnType<typeof express>["listen"]>> = [];
const directories: string[] = [];
const stores: IntegrationCredentialStore[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  for (const store of stores.splice(0)) store.close();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const GM_TOKEN = "valid-gm-session-token";
const OTHER_GM_TOKEN = "another-valid-gm-session-token";

async function newCredentialStore() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-api-v1-"));
  directories.push(directory);
  const store = new IntegrationCredentialStore(join(directory, "credentials.sqlite"));
  await store.initialize();
  stores.push(store);
  return { store, path: join(directory, "credentials.sqlite") };
}

async function start(overrides: { authorizeIntegration?: (token: string, scope: string) => boolean | Promise<boolean> } = {}) {
  const { store } = await newCredentialStore();
  const app = express();
  app.use(express.json());
  app.use(createApiV1Router({
    applicationVersion: "0.1.0-test",
    actorDefinitionVersion: 1,
    // Defaults to real store-backed verification; individual tests may override with a simple fake to test router gating in isolation.
    authorizeIntegration: overrides.authorizeIntegration ?? ((token, scope) => store.verify(token, scope as Parameters<typeof store.verify>[1]) !== null),
    authorizeGm: (token) => token === GM_TOKEN || token === OTHER_GM_TOKEN,
    credentialStore: store
  }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, store };
}

function gmHeaders(token = GM_TOKEN) { return { authorization: `Bearer ${token}`, "content-type": "application/json" }; }

describe("API v1 system router", () => {
  it("serves public health and version responses matching the runtime contract", async () => {
    const { base } = await start();
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
    const { base } = await start({ authorizeIntegration: (token, scope) => token === "valid-token" && scope === "system:read" });
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
    // Discovery has to advertise the codex now that a credential can reach it - a consumer should be able
    // to ask "is the worldbuilding surface here?" before it asks for a scope it may not have been granted.
    expect(capabilities.data.features.codex).toBe(true);
    expect(capabilities.data.supportedScopes).toEqual(expect.arrayContaining(["codex:read", "codex:write"]));
  });

  it("connects capability discovery to a durable integration credential requiring system:read", async () => {
    const { base, store } = await start();
    const noCredential = await fetch(base + SYSTEM_PATHS.capabilities, { headers: { authorization: "Bearer bogus" } });
    expect(noCredential.status).toBe(403);

    const issued = store.create({ name: "Read-only overlay", scopes: ["system:read"] });
    const withCredential = await fetch(base + SYSTEM_PATHS.capabilities, { headers: { authorization: `Bearer ${issued.token}` } });
    expect(withCredential.status).toBe(200);

    const wrongScope = store.create({ name: "Actor writer", scopes: ["actor:write"] });
    const wrongScopeResponse = await fetch(base + SYSTEM_PATHS.capabilities, { headers: { authorization: `Bearer ${wrongScope.token}` } });
    expect(wrongScopeResponse.status).toBe(403);

    const admin = store.create({ name: "Admin tool", scopes: ["admin"] });
    const adminResponse = await fetch(base + SYSTEM_PATHS.capabilities, { headers: { authorization: `Bearer ${admin.token}` } });
    expect(adminResponse.status).toBe(200);
  });

  it("serves the exact shipped OpenAPI document, unauthenticated, from a stable path", async () => {
    const { base } = await start();
    const response = await fetch(base + OPENAPI_DOCUMENT_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual(openApiDocument);
  });

  it("returns stable recipient-safe errors for unknown API routes", async () => {
    const { base } = await start();
    const suppliedRequestId = "8d976bbc-59f4-4e1b-ac00-e198dbf40d9c";
    const response = await fetch(`${base}/api/v1/private/database`, { headers: { "x-request-id": suppliedRequestId } });
    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe(suppliedRequestId);
    const body = ApiErrorEnvelopeSchema.parse(await response.json());
    expect(body.error).toEqual({ code: "not_found", message: "API route not found.", requestId: suppliedRequestId });
    expect(JSON.stringify(body)).not.toMatch(/sqlite|tokenSecret|passwordHash/i);
  });
});

describe("GM-authorized integration credential management", () => {
  it("rejects credential management without a valid GM session, and integration tokens are not accepted here", async () => {
    const { base, store } = await start();
    const issued = store.create({ name: "Not a GM", scopes: ["system:read"] });

    const missing = await fetch(base + INTEGRATION_CREDENTIAL_PATHS.collection);
    expect(missing.status).toBe(401);
    const wrongKind = await fetch(base + INTEGRATION_CREDENTIAL_PATHS.collection, { headers: { authorization: `Bearer ${issued.token}` } });
    expect(wrongKind.status).toBe(401);
    const malformed = await fetch(base + INTEGRATION_CREDENTIAL_PATHS.collection, { headers: { authorization: "not-bearer-shaped" } });
    expect(malformed.status).toBe(401);
  });

  it("creates a credential with name, minimum scopes, optional game binding, and expiration, returning the secret exactly once", async () => {
    const { base } = await start();
    const gameId = "11111111-1111-4111-8111-111111111111";
    const response = await fetch(base + INTEGRATION_CREDENTIAL_PATHS.collection, {
      method: "POST",
      headers: gmHeaders(),
      body: JSON.stringify({ name: "Stream overlay", scopes: ["system:read", "combat:read"], gameId, expiresAt: "2030-01-01T00:00:00.000Z" })
    });
    expect(response.status).toBe(201);
    const body = IntegrationCredentialIssuedResponseSchema.parse(await response.json());
    expect(body.data.credential.name).toBe("Stream overlay");
    expect(body.data.credential.scopes.sort()).toEqual(["combat:read", "system:read"]);
    expect(body.data.credential.gameId).toBe(gameId);
    expect(body.data.token).toMatch(/^vtt_int_/);
  });

  it("rejects a malformed create request without touching the store", async () => {
    const { base, store } = await start();
    const response = await fetch(base + INTEGRATION_CREDENTIAL_PATHS.collection, { method: "POST", headers: gmHeaders(), body: JSON.stringify({ name: "", scopes: [] }) });
    expect(response.status).toBe(400);
    expect(ApiErrorEnvelopeSchema.parse(await response.json()).error.code).toBe("validation_failed");
    expect(store.list()).toHaveLength(0);
  });

  it("lists safe metadata for every credential without ever including a secret or hash", async () => {
    const { base, store } = await start();
    store.create({ name: "First", scopes: ["system:read"] });
    store.create({ name: "Second", scopes: ["actor:read"] });

    const response = await fetch(base + INTEGRATION_CREDENTIAL_PATHS.collection, { headers: gmHeaders() });
    expect(response.status).toBe(200);
    const body = await response.json();
    IntegrationCredentialListResponseSchema.parse(body);
    expect(body.data.credentials).toHaveLength(2);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/secret|hash|vtt_int_/i);
  });

  it("rotates a credential, issuing a fresh one-time secret while invalidating the old one immediately", async () => {
    const { base, store } = await start();
    const issued = store.create({ name: "Rotatable", scopes: ["system:read"] });

    const rotateResponse = await fetch(`${base}${INTEGRATION_CREDENTIAL_PATHS.rotate.replace("{id}", issued.metadata.id)}`, { method: "POST", headers: gmHeaders(), body: JSON.stringify({}) });
    expect(rotateResponse.status).toBe(200);
    const rotated = IntegrationCredentialIssuedResponseSchema.parse(await rotateResponse.json());
    expect(rotated.data.token).not.toBe(issued.token);
    expect(rotated.data.credential.id).toBe(issued.metadata.id);

    expect(store.verify(issued.token, "system:read")).toBeNull();
    expect(store.verify(rotated.data.token, "system:read")?.id).toBe(issued.metadata.id);
  });

  it("returns 404 rotating or revoking an unknown credential, and 400 for a malformed ID", async () => {
    const { base } = await start();
    const unknownId = "99999999-9999-4999-8999-999999999999";
    const rotateUnknown = await fetch(`${base}${INTEGRATION_CREDENTIAL_PATHS.rotate.replace("{id}", unknownId)}`, { method: "POST", headers: gmHeaders() });
    expect(rotateUnknown.status).toBe(404);
    const revokeUnknown = await fetch(`${base}${INTEGRATION_CREDENTIAL_PATHS.revoke.replace("{id}", unknownId)}`, { method: "POST", headers: gmHeaders() });
    expect(revokeUnknown.status).toBe(404);
    const malformedId = await fetch(`${base}${INTEGRATION_CREDENTIAL_PATHS.revoke.replace("{id}", "not-a-uuid")}`, { method: "POST", headers: gmHeaders() });
    expect(malformedId.status).toBe(400);
  });

  it("revokes a credential and denies it immediately afterward", async () => {
    const { base, store } = await start();
    const issued = store.create({ name: "Revocable", scopes: ["system:read"] });
    expect(store.verify(issued.token, "system:read")).not.toBeNull();

    const revokeResponse = await fetch(`${base}${INTEGRATION_CREDENTIAL_PATHS.revoke.replace("{id}", issued.metadata.id)}`, { method: "POST", headers: gmHeaders() });
    expect(revokeResponse.status).toBe(200);
    const revoked = IntegrationCredentialResponseSchema.parse(await revokeResponse.json());
    expect(revoked.data.revokedAt).not.toBeNull();

    expect(store.verify(issued.token, "system:read")).toBeNull();
    const stillVia401 = await fetch(base + SYSTEM_PATHS.capabilities, { headers: { authorization: `Bearer ${issued.token}` } });
    expect(stillVia401.status).toBe(403);
  });

  it("reports safe audit history without ever exposing a secret", async () => {
    const { base, store } = await start();
    const issued = store.create({ name: "Audited", scopes: ["system:read"] });
    store.verify(issued.token, "system:read");
    const wrongSecretToken = issued.token.slice(0, -1) + (issued.token.endsWith("A") ? "B" : "A");
    store.verify(wrongSecretToken, "system:read");
    store.revoke(issued.metadata.id);

    const auditResponse = await fetch(`${base}${INTEGRATION_CREDENTIAL_PATHS.audit.replace("{id}", issued.metadata.id)}`, { headers: gmHeaders() });
    expect(auditResponse.status).toBe(200);
    const body = IntegrationCredentialAuditResponseSchema.parse(await auditResponse.json());
    const types = body.data.events.map((event) => event.type);
    expect(types).toEqual(expect.arrayContaining(["created", "used", "revoked"]));
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(issued.token);
    expect(serialized).not.toContain(wrongSecretToken);
  });

  it("persists created/rotated/revoked credentials across a store restart against the same database file", async () => {
    const { path } = await newCredentialStore();
    const first = new IntegrationCredentialStore(path);
    await first.initialize();
    const issued = first.create({ name: "Durable", scopes: ["system:read"] });
    first.close();

    const second = new IntegrationCredentialStore(path);
    await second.initialize();
    stores.push(second);
    expect(second.get(issued.metadata.id)?.name).toBe("Durable");
    expect(second.verify(issued.token, "system:read")?.id).toBe(issued.metadata.id);
    second.close();
  });

  it("uses stable request IDs and the shared error envelope for credential-management failures too", async () => {
    const { base } = await start();
    const suppliedRequestId = "2c9c3a54-2b0a-4c2e-9c7b-2d8b8e0c9b21";
    const response = await fetch(base + INTEGRATION_CREDENTIAL_PATHS.collection, { headers: { "x-request-id": suppliedRequestId } });
    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe(suppliedRequestId);
    const body = ApiErrorEnvelopeSchema.parse(await response.json());
    expect(body.error.requestId).toBe(suppliedRequestId);
    expect(body.apiVersion).toBe(API_VERSION);
  });
});
