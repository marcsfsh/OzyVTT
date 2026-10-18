import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { SceneSchema } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

vi.mock("./socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));
// Every map here is ready at once, 700 by 500; thumbnails stay as their placeholder.
vi.mock("./scene/mapImage", async (original) => ({
  ...(await original<typeof import("./scene/mapImage")>()),
  useAuthorizedMapImage: () => ({ status: "ready", url: "blob:map", width: 700, height: 500 }),
  useCachedMapThumbnail: () => null
}));
// The viewer preview asks the server for a session on mount; here the answer never comes.
vi.mock("./lib/api", async (original) => ({
  ...(await original<typeof import("./lib/api")>()),
  apiRequest: () => new Promise(() => {})
}));

import { touchMoveCancelled } from "../test/drag-surface";
import { MapSurface } from "./codex/MapSurface";
import { ConnectionGraph } from "./codex/RelationshipGraph";
import { CalibrationPane } from "./maps/CalibrationPane";
import { MapTokenTray } from "./scene/MapTokenTray";
import { SceneGallery } from "./scenes/SceneGallery";
import { FloatingSheet } from "./sheet/CharacterSheet";
import { PaneDivider } from "./table/PaneDivider";
import { Initiative, MapStage, type Presentation } from "./viewer/ViewerApp";
import { ViewerPreviewPanel } from "./viewer/ViewerPreviewPanel";

// Every element with `touch-action: none` is a drag surface, and each one cancels its own touchmove: a drag that lifts
// mid-motion otherwise starts a browser fling, and the tap that follows only stops it. The encounter map's stage is
// checked where that map is rendered, in `table/tap-to-target.test.tsx`; the row editor's grip in `@vtt/ui`.

const MAP_ID = "20000000-0000-5000-8000-000000000001";
const presentation: Presentation = {
  schemaVersion: 1,
  revision: 1,
  enabled: true,
  activeMap: { assetId: MAP_ID, altText: "Smoke cavern" },
  camera: null,
  measurement: null,
  pings: [],
  initiative: {
    visible: true,
    round: 1,
    hiddenTurn: false,
    entries: [{ actorId: "a", name: "Lyra", initiative: 15, active: true }]
  },
  encounter: { mapAssetId: MAP_ID, tokens: [] }
};
const scene = (id: string, name: string) =>
  SceneSchema.parse({ id: `30000000-0000-4000-8000-00000000000${id}`, name, mapAssetId: MAP_ID });

const SURFACES: ReadonlyArray<Readonly<{ selector: string; ui: () => ReactElement }>> = [
  {
    selector: ".map-preview",
    ui: () => (
      <CalibrationPane
        map={{
          id: MAP_ID,
          name: "Smoke cavern",
          kind: "battlemap",
          folder: null,
          originalName: "smoke.png",
          format: "png",
          mediaType: "image/png",
          width: 700,
          height: 500,
          byteLength: 1,
          importedAt: "2026-10-17T00:00:00.000Z",
          calibration: null,
          scale: null
        }}
        previewUrl="blob:map"
        gmToken="gm"
        folderNames={[]}
        onSaved={async () => {}}
        onShowRail={() => {}}
      />
    )
  },
  {
    selector: ".tray-token",
    ui: () => (
      <MapTokenTray
        trayRef={{ current: null }}
        unplaced={[{ actorId: "a", position: null } as never]}
        actorsById={
          new Map([["a", { id: "a", name: "Lyra", kind: "player-character", visibility: "public" } as never]])
        }
        dragging={false}
        busy={false}
        placeAtCenter={() => {}}
      />
    )
  },
  {
    selector: ".codex-mapsurface",
    ui: () => (
      <MapSurface
        token="gm"
        assetId={MAP_ID}
        markers={[]}
        placing={false}
        selectedMarkerId={null}
        onBackgroundClick={() => {}}
        onMarkerClick={() => {}}
        onMarkerDragEnd={() => {}}
      />
    )
  },
  {
    selector: ".codex-graph-svg",
    ui: () => (
      <ConnectionGraph
        nodes={[
          { id: "p1", title: "Vallaki", entityType: "note" },
          { id: "p2", title: "Ireena", entityType: "character" }
        ]}
        connections={[]}
        onOpen={() => {}}
      />
    )
  },
  { selector: ".viewer-stage", ui: () => <MapStage presentation={presentation} /> },
  {
    selector: ".viewer-initiative-resize",
    ui: () => <Initiative presentation={presentation} onResize={() => {}} />
  },
  { selector: ".viewer-preview-titlebar", ui: () => <ViewerPreviewPanel gmToken="gm" onClose={() => {}} /> },
  { selector: ".viewer-preview-resize", ui: () => <ViewerPreviewPanel gmToken="gm" onClose={() => {}} /> },
  {
    selector: ".pane-divider",
    ui: () => <PaneDivider value={50} onChange={() => {}} container={() => null} />
  },
  { selector: ".cs-float-grip", ui: () => <FloatingSheet name="Lyra">Sheet</FloatingSheet> },
  { selector: ".cs-float-resize", ui: () => <FloatingSheet name="Lyra">Sheet</FloatingSheet> },
  {
    selector: ".scene-card-grip",
    ui: () => (
      <SceneGallery
        scenes={[scene("1", "Cavern"), scene("2", "Bridge")]}
        activeSceneId={null}
        combatActive={false}
        liveCombatantCount={0}
        previewingSceneId={null}
        onNewScene={() => {}}
      />
    )
  }
];

describe("drag surfaces", () => {
  it.each(SURFACES)("$selector cancels a finger's movement, so a drag never becomes a scroll", ({ selector, ui }) => {
    const { container, unmount } = render(<ToastProvider>{ui()}</ToastProvider>);
    const surfaces = [...container.querySelectorAll(selector)];
    expect(surfaces.length, `${selector} rendered`).toBeGreaterThan(0);
    for (const surface of surfaces) expect(touchMoveCancelled(surface)).toBe(true);
    // A finger moving anywhere else on the page is left alone.
    expect(touchMoveCancelled(document.body)).toBe(false);
    unmount();
    for (const surface of surfaces) expect(touchMoveCancelled(surface)).toBe(false);
  });

  it("covers every element the client's stylesheets and components give `touch-action: none`", () => {
    // Vite rewrites `import.meta.url`, so the path starts from the client workspace, the cwd vitest runs in.
    const source = join(process.cwd(), "src");
    const files = readdirSync(source, { recursive: true, encoding: "utf8" });
    const ruled = new Set<string>();
    for (const file of files.filter((name) => name.endsWith(".css"))) {
      const css = readFileSync(join(source, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of css.matchAll(/([^{}]+)\{[^{}]*touch-action:\s*none[^{}]*\}/g))
        for (const selector of match[1].split(",")) ruled.add(selector.trim());
    }
    const inline = files
      .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
      .filter((name) => /touchAction:\s*"none"/.test(readFileSync(join(source, name), "utf8")))
      .map((name) => relative(source, join(source, name)));
    const covered = [...SURFACES.map((surface) => surface.selector), ".encounter-map-stage"];
    expect([...ruled].sort()).toEqual(covered.filter((selector) => selector !== ".codex-graph-svg").sort());
    // The relationship graph sets it inline on its svg, which is `.codex-graph-svg`.
    expect(inline).toEqual(["codex/RelationshipGraph.tsx"]);
  });
});
