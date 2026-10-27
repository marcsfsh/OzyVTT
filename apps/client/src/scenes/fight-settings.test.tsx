import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SceneSchema, type Scene } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";
import { ScenesContext, type ScenesContextValue } from "./context";
import { FightSettings } from "./SceneEncounterTab";
import type { SceneFacts } from "./sceneFacts";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
const command = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("../lib/command", () => ({ command, read: () => new Promise(() => {}) }));

const SCENE_ID = "30000000-0000-4000-8000-000000000001";
const sceneWith = (initiativeDefaults?: Scene["initiativeDefaults"]) =>
  SceneSchema.parse({
    id: SCENE_ID,
    name: "Warren",
    mapAssetId: "20000000-0000-5000-8000-000000000001",
    ...(initiativeDefaults ? { initiativeDefaults } : {})
  });
const context = (scene: Scene): ScenesContextValue => ({
  state: { revision: 7, combat: { scenes: [scene], activeSceneId: null, active: false }, actors: [] } as never,
  token: "gm",
  maps: [],
  reloadMaps: async () => [],
  links: new Map(),
  reloadLinks: () => {},
  phone: false,
  narrow: false,
  go: () => {},
  onOpenMap: () => {}
});
const show = (scene: Scene) =>
  render(
    <ToastProvider>
      <ScenesContext.Provider value={context(scene)}>
        <FightSettings facts={{ scene } as SceneFacts} />
      </ScenesContext.Provider>
    </ToastProvider>
  );

describe("a scene's Fight settings", () => {
  it("reads as Start the fight would open when the scene has none", () => {
    show(sceneWith());
    expect(screen.getByRole("switch", { name: "Players roll their own initiative" }).getAttribute("aria-checked")).toBe(
      "false"
    );
    expect(
      screen.getByRole("switch", { name: "One roll for each group of identical monsters" }).getAttribute("aria-checked")
    ).toBe("true");
  });

  it("saves both choices through the scene's command when one changes", async () => {
    show(sceneWith({ groupMonsters: false }));
    await userEvent.click(screen.getByRole("switch", { name: "Players roll their own initiative" }));
    expect(command).toHaveBeenCalledWith("scene:set-initiative-defaults", {
      sceneId: SCENE_ID,
      initiativeDefaults: { playersRollInitiative: true, groupMonsters: false },
      expectedRevision: 7
    });
  });
});
