import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VIEWER_SESSION_COOKIE } from "@vtt/api-contract";
import { MapAssetStore } from "../src/map-assets.js";
import { MapCatalogStore } from "../src/map-catalog.js";
import { createMapRouter } from "../src/map-http.js";
import { openApiDocument } from "../src/openapi/document.js";
import { png } from "./image-fixtures.js";
import { fixedVerifiers } from "./fixed-verifiers.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-map-http-"));
  const assets = new MapAssetStore(join(directory, "map-assets"));
  const catalog = new MapCatalogStore(join(directory, "vtt.sqlite"), () => Date.parse("2026-07-16T03:00:00.000Z"));
  await assets.initialize();
  await catalog.initialize();
  const app = express();
  app.use(express.json());
  app.use(
    createMapRouter({
      assets,
      catalog,
      verifiers: fixedVerifiers({ gm: ["gm-token"], player: ["player-token"], viewer: ["viewer-token"] }),
      playerMayLoad: () => true,
      viewerMayLoad: () => true,
      now: () => Date.parse("2026-07-16T03:00:00.000Z")
    })
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Map test server did not bind.");
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    catalog.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${address.port}`, input: png(500, 400), directory };
}

function gm(contentType = "application/json") {
  return { authorization: "Bearer gm-token", "content-type": contentType };
}
async function body(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

describe("map asset HTTP workflow", () => {
  it("uploads, deduplicates, lists safe metadata, and serves authenticated ranges", async () => {
    const test = await fixture();
    const path = `${test.base}/api/v1/map-assets?filename=keep.fake.jpg&name=Ruined%20Keep&kind=battlemap`;
    expect(
      (await fetch(path, { method: "POST", headers: { "content-type": "image/png" }, body: test.input })).status
    ).toBe(401);
    const uploaded = await fetch(path, { method: "POST", headers: gm("image/png"), body: test.input });
    expect(uploaded.status).toBe(201);
    const uploadBody = await body(uploaded);
    expect(uploadBody.data.asset).toMatchObject({
      name: "Ruined Keep",
      kind: "battlemap",
      format: "png",
      width: 500,
      height: 400
    });
    expect(JSON.stringify(uploadBody)).not.toMatch(/checksum|\/tmp|map-assets\/originals/i);
    const id = uploadBody.data.asset.id;

    const duplicate = await fetch(path, { method: "POST", headers: gm("image/png"), body: test.input });
    expect(duplicate.status).toBe(200);
    expect((await body(duplicate)).data.duplicate).toBe(true);
    const list = await body(await fetch(`${test.base}/api/v1/map-assets`, { headers: gm() }));
    expect(list.data.assets).toHaveLength(1);

    const contentPath = `${test.base}/api/v1/map-assets/${id}/content`;
    expect((await fetch(contentPath)).status).toBe(401);
    const whole = await fetch(contentPath, { headers: { authorization: "Bearer player-token" } });
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(test.input);
    expect(whole.headers.get("cache-control")).toBe("private, no-store");
    const range = await fetch(contentPath, {
      headers: { cookie: `${VIEWER_SESSION_COOKIE}=viewer-token`, range: "bytes=0-7" }
    });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe(`bytes 0-7/${test.input.length}`);
    expect(Buffer.from(await range.arrayBuffer())).toEqual(test.input.subarray(0, 8));
    const notModified = await fetch(contentPath, {
      headers: { authorization: "Bearer gm-token", "if-none-match": whole.headers.get("etag")! }
    });
    expect(notModified.status).toBe(304);
  });

  it("answers in the shapes the API document publishes, folder included", async () => {
    const test = await fixture();
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(openApiDocument as unknown as Record<string, unknown>, "openapi");
    const expectShape = (schemaName: string, payload: unknown) => {
      const validate = ajv.compile({ $ref: `openapi#/components/schemas/${schemaName}` });
      expect(validate(payload), `${schemaName}: ${JSON.stringify(validate.errors)}`).toBe(true);
    };
    const path = `${test.base}/api/v1/map-assets?filename=keep.png&name=Keep&kind=battlemap`;
    const uploaded = await body(await fetch(path, { method: "POST", headers: gm("image/png"), body: test.input }));
    expectShape("MapAssetUploadData", uploaded.data);
    const id = uploaded.data.asset.id;
    const filed = await body(
      await fetch(`${test.base}/api/v1/map-assets/${id}`, {
        method: "PATCH",
        headers: gm(),
        body: JSON.stringify({ folder: "Dungeons" })
      })
    );
    expect(filed.data.map.folder).toBe("Dungeons");
    expectShape("MapAssetData", filed.data);
    expectShape(
      "MapAssetData",
      (await body(await fetch(`${test.base}/api/v1/map-assets/${id}`, { headers: gm() }))).data
    );
    expectShape(
      "MapAssetListData",
      (await body(await fetch(`${test.base}/api/v1/map-assets`, { headers: gm() }))).data
    );
  });

  it("files a new upload under the folder it names, and stores nothing for a folder it refuses", async () => {
    const test = await fixture();
    const upload = (query: string, bytes: Buffer<ArrayBuffer>) =>
      fetch(`${test.base}/api/v1/map-assets?filename=crypt.png&name=Crypt&kind=battlemap&${query}`, {
        method: "POST",
        headers: gm("image/png"),
        body: bytes
      });
    const filed = await upload("folder=%20Dungeons%20", test.input);
    expect(filed.status).toBe(201);
    expect((await body(filed)).data.asset.folder).toBe("Dungeons");

    const refused = await upload("folder=a%2Fb", png(320, 200));
    expect(refused.status).toBe(400);
    const listed = await body(await fetch(`${test.base}/api/v1/map-assets`, { headers: gm() }));
    expect(listed.data.assets).toHaveLength(1);

    // The same bytes again keep the folder they were first filed under.
    const again = await upload("folder=Elsewhere", test.input);
    expect((await body(again)).data.asset.folder).toBe("Dungeons");
  });

  it("serves grid calibration to anyone who can already read the map's content, but not to strangers", async () => {
    const test = await fixture();
    const upload = await body(
      await fetch(`${test.base}/api/v1/map-assets?filename=grid.png&kind=battlemap`, {
        method: "POST",
        headers: gm("image/png"),
        body: test.input
      })
    );
    const id = upload.data.asset.id;
    const gridPath = `${test.base}/api/v1/map-assets/${id}/grid`;
    expect((await fetch(gridPath)).status).toBe(401);
    expect(
      (await body(await fetch(gridPath, { headers: { authorization: "Bearer gm-token" } }))).data.calibration
    ).toBeNull();
    expect((await fetch(gridPath, { headers: { authorization: "Bearer player-token" } })).status).toBe(200);
    expect((await fetch(gridPath, { headers: { cookie: `${VIEWER_SESSION_COOKIE}=viewer-token` } })).status).toBe(200);

    const started = await body(
      await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards`, {
        method: "POST",
        headers: gm(),
        body: JSON.stringify({
          start: { x: 0, y: 0 },
          end: { x: 150, y: 150 },
          cellsAcross: 3,
          cellsDown: 3,
          distancePerCell: 5
        })
      })
    );
    await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards/${started.data.wizardId}/complete`, {
      method: "POST",
      headers: gm(),
      body: "{}"
    });
    const afterCalibration = await body(await fetch(gridPath, { headers: { authorization: "Bearer gm-token" } }));
    expect(afterCalibration.data.calibration.cellSizePx).toBeCloseTo(50);
    expect(
      (
        await fetch(`${test.base}/api/v1/map-assets/does-not-exist/grid`, {
          headers: { authorization: "Bearer gm-token" }
        })
      ).status
    ).toBe(400);
  });

  it("runs a server-owned calibration wizard through verification and durable completion", async () => {
    const test = await fixture();
    const upload = await body(
      await fetch(`${test.base}/api/v1/map-assets?filename=grid.png&kind=battlemap`, {
        method: "POST",
        headers: gm("image/png"),
        body: test.input
      })
    );
    const id = upload.data.asset.id;
    const wrongSize = await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards`, {
      method: "POST",
      headers: gm(),
      body: JSON.stringify({
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        cellsAcross: 2,
        cellsDown: 2,
        distancePerCell: 5
      })
    });
    expect(wrongSize.status).toBe(400);
    const started = await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards`, {
      method: "POST",
      headers: gm(),
      body: JSON.stringify({
        start: { x: 0, y: 0 },
        end: { x: 150, y: 150 },
        cellsAcross: 3,
        cellsDown: 3,
        distancePerCell: 5
      })
    });
    expect(started.status).toBe(201);
    const startedBody = await body(started);
    expect(startedBody.data.state.calibration.cellSizePx).toBeCloseTo(50);
    const wizardId = startedBody.data.wizardId;

    const adjusted = await body(
      await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards/${wizardId}/actions`, {
        method: "POST",
        headers: gm(),
        body: JSON.stringify({ action: "adjust", adjustment: { originDelta: { x: 1, y: 1 } } })
      })
    );
    expect(adjusted.data.state.calibration.origin).toEqual({ x: 1, y: 1 });
    const undone = await body(
      await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards/${wizardId}/actions`, {
        method: "POST",
        headers: gm(),
        body: JSON.stringify({ action: "undo" })
      })
    );
    expect(undone.data.state.calibration.origin).toEqual({ x: 0, y: 0 });
    const verified = await body(
      await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards/${wizardId}/actions`, {
        method: "POST",
        headers: gm(),
        body: JSON.stringify({ action: "verify", imagePoint: { x: 100, y: 100 } })
      })
    );
    expect(verified.data.state.verification).toMatchObject({ accepted: true });
    expect(verified.data.state.verification.errorPx).toBeCloseTo(0);
    const completed = await body(
      await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards/${wizardId}/complete`, {
        method: "POST",
        headers: gm(),
        body: "{}"
      })
    );
    expect(completed.data.map.calibration.calibration.cellSizePx).toBeCloseTo(50);
    expect(completed.data.map.calibration.verificationErrorPx).toBeCloseTo(0);
    expect(
      (
        await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards/${wizardId}/complete`, {
          method: "POST",
          headers: gm(),
          body: "{}"
        })
      ).status
    ).toBe(404);
  });

  it("completes calibration from the 3-by-3 drag alone, with no verification step required", async () => {
    const test = await fixture();
    const upload = await body(
      await fetch(`${test.base}/api/v1/map-assets?filename=grid.png&kind=battlemap`, {
        method: "POST",
        headers: gm("image/png"),
        body: test.input
      })
    );
    const id = upload.data.asset.id;
    const started = await body(
      await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards`, {
        method: "POST",
        headers: gm(),
        body: JSON.stringify({
          start: { x: 20, y: 20 },
          end: { x: 275, y: 170 },
          cellsAcross: 3,
          cellsDown: 3,
          distancePerCell: 5
        })
      })
    );
    expect(started.data.state.calibration.rotationRadians).toBe(0);
    const wizardId = started.data.wizardId;
    const completed = await body(
      await fetch(`${test.base}/api/v1/map-assets/${id}/calibration/wizards/${wizardId}/complete`, {
        method: "POST",
        headers: gm(),
        body: "{}"
      })
    );
    expect(completed.data.map.calibration.calibration.rotationRadians).toBe(0);
    expect(completed.data.map.calibration.verificationErrorPx).toBeNull();
    expect(completed.data.map.calibration.verifiedAt).toBeNull();
  });

  it("calibrates gridless regional scale and rejects spoofed or unsafe inputs", async () => {
    const test = await fixture();
    const rejected = await fetch(`${test.base}/api/v1/map-assets?filename=malware.png`, {
      method: "POST",
      headers: gm("image/png"),
      body: Buffer.from("not an image")
    });
    expect(rejected.status).toBe(400);
    expect((await body(rejected)).error.message).toContain("Unsupported");

    const upload = await body(
      await fetch(`${test.base}/api/v1/map-assets?filename=region.png&kind=regional`, {
        method: "POST",
        headers: gm("image/png"),
        body: test.input
      })
    );
    const id = upload.data.asset.id;
    const scaled = await body(
      await fetch(`${test.base}/api/v1/map-assets/${id}/scale`, {
        method: "PUT",
        headers: gm(),
        body: JSON.stringify({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, knownDistance: 50, unit: "miles" })
      })
    );
    expect(scaled.data.map.scale).toEqual({ kind: "image-scale", distancePerPixel: 0.5, unit: "miles" });
    expect(
      (
        await fetch(`${test.base}/api/v1/map-assets/../../auth.json/content`, {
          headers: { authorization: "Bearer gm-token" }
        })
      ).status
    ).not.toBe(200);
  });

  it("answers a storage fault with a fixed message, never the server's file paths", async () => {
    const test = await fixture();
    await rm(join(test.directory, "map-assets"), { recursive: true, force: true });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await fetch(`${test.base}/api/v1/map-assets?filename=arena.png`, {
      method: "POST",
      headers: gm("image/png"),
      body: test.input
    });
    expect(failed.status).toBe(500);
    const text = await failed.text();
    expect(JSON.parse(text).error).toMatchObject({ code: "internal_error", message: "Map request failed." });
    expect(text).not.toContain(test.directory);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
