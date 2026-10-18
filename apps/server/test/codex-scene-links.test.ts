import { describe, expect, it } from "vitest";
import { CODEX_PATHS } from "@vtt/api-contract";
import { codexHttp, PLAYER } from "./codex-http-fixture.js";

// The Scenes tab asks which Codex sessions and pins name each table scene. Scene links are GM-only everywhere, so
// this read answers the GM alone.

const SCENE_A = "40000000-0000-4000-8000-000000000001";
const SCENE_B = "40000000-0000-4000-8000-000000000002";
const fixture = codexHttp();
const path = CODEX_PATHS.sceneLinks.replace("/api/v1/codex", "");

describe("the scenes the Codex names", () => {
  it("lists each scene with the sessions that stage it, by the session or its prep, and the pins that link it", async () => {
    const { store, get } = await fixture();
    store.createSession({ sessionNumber: 3, sceneIds: [SCENE_A] });
    store.createSession({
      sessionNumber: 4,
      prep: [{ type: "encounters", title: "Fights", sceneIds: [SCENE_A, SCENE_B] }]
    });
    const map = store.createMap({ assetId: "20000000-0000-5000-8000-000000000001", name: "Saltmere", kind: "regional" });
    store.createMarker(map.id, { x: 10, y: 20, iconId: "pin", iconColor: "#ff2e9a", label: "Bridge", sceneIds: [SCENE_B] });

    const answer = await get(path);
    expect(answer.status).toBe(200);
    const links = answer.body.data!.links as Array<{
      sceneId: string;
      sessions: Array<{ sessionNumber: number; via: string }>;
      pins: Array<{ label: string; mapName: string }>;
    }>;
    const byScene = new Map(links.map((link) => [link.sceneId, link]));
    expect(byScene.get(SCENE_A)!.sessions.map((session) => [session.sessionNumber, session.via])).toEqual([
      [3, "session"],
      [4, "prep"]
    ]);
    expect(byScene.get(SCENE_A)!.pins).toEqual([]);
    expect(byScene.get(SCENE_B)!.sessions.map((session) => session.sessionNumber)).toEqual([4]);
    expect(byScene.get(SCENE_B)!.pins).toMatchObject([{ label: "Bridge", mapName: "Saltmere" }]);
  });

  it("answers no player", async () => {
    const { get } = await fixture();
    expect((await get(path, PLAYER)).status).toBe(403);
  });
});
