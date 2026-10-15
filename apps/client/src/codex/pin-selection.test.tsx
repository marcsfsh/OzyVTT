import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Selecting a pin is a navigation (`?pin=`), so a dirty inspector prompts before another pin is selected;
 * refusing keeps both the pin and the draft, accepting moves, and the filters on the address survive.
 * Uses the real router, since the guard lives there.
 */

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
/** A stand-in surface that reports the selected pin and offers a button per marker. */
vi.mock("./MapSurface", () => ({
  MapSurface: (props: {
    selectedMarkerId: string | null;
    markers: ReadonlyArray<{ id: string; label: string | null }>;
    onMarkerClick: (id: string) => void;
  }) => (
    <div data-testid="map-surface" data-selected={props.selectedMarkerId ?? ""}>
      {props.markers.map((marker) => (
        <button key={marker.id} type="button" onClick={() => props.onMarkerClick(marker.id)}>
          Pin {marker.label ?? marker.id}
        </button>
      ))}
    </div>
  )
}));

const listMaps = vi.fn();
const listAssets = vi.fn();
const listMarkers = vi.fn();
const listPages = vi.fn();
const updateMarker = vi.fn();
const forMarker = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: { ...actual.codexApi, listPages: (...a: unknown[]) => listPages(...a) },
    journalApi: { ...actual.journalApi, forMarker: (...a: unknown[]) => forMarker(...a) },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: (...a: unknown[]) => listAssets(...a),
      listMarkers: (...a: unknown[]) => listMarkers(...a),
      updateMarker: (...a: unknown[]) => updateMarker(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { AtlasView } from "./AtlasView";
import type { CodexMap, CodexMarker } from "@vtt/domain";
import { navigate, replaceQuery, currentHref } from "../router";
import { goTo } from "../../test/route";

const MAP: CodexMap = {
  id: "m1",
  assetId: "a1",
  name: "Barovia",
  kind: "regional",
  parentMapId: null,
  revealedToPlayers: true,
  sortKey: 0,
  tags: [],
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z"
};
const marker = (id: string, label: string): CodexMarker => ({
  id,
  mapId: "m1",
  x: 10,
  y: 10,
  label,
  iconId: "pin",
  iconColor: "#fff",
  tags: [],
  pageIds: [],
  sceneIds: [],
  subMapId: null,
  actorId: null,
  isParty: false,
  revealedToPlayers: false,
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z"
});
const MARKERS = [marker("k1", "Village"), marker("k2", "Castle")];

const AUTOSAVE_OFF = { enabled: false, intervalSeconds: 1 } as const;

/** The atlas wired to the real router, as `CodexShell` wires it. */
function renderAtlas(query: URLSearchParams) {
  return render(
    <ToastProvider>
      <AtlasView
        gmToken="gm"
        scenes={[]}
        actors={[]}
        activeSceneId={null}
        onActivateScene={vi.fn()}
        mapId="m1"
        pinId={query.get("pin")}
        filter={query.get("q") ?? ""}
        tagFilter={query.get("tag")}
        autosave={AUTOSAVE_OFF}
        onQuickCreate={vi.fn()}
        onNavigate={navigate}
        onReplaceQuery={replaceQuery}
      />
    </ToastProvider>
  );
}

/** Re-render at the router's current address (the shell's job, done by hand). */
function atlasAt(view: ReturnType<typeof renderAtlas>) {
  const query = new URLSearchParams(window.location.search);
  view.rerender(
    <ToastProvider>
      <AtlasView
        gmToken="gm"
        scenes={[]}
        actors={[]}
        activeSceneId={null}
        onActivateScene={vi.fn()}
        mapId="m1"
        pinId={query.get("pin")}
        filter={query.get("q") ?? ""}
        tagFilter={query.get("tag")}
        autosave={AUTOSAVE_OFF}
        onQuickCreate={vi.fn()}
        onNavigate={navigate}
        onReplaceQuery={replaceQuery}
      />
    </ToastProvider>
  );
}

describe("Selecting another pin passes the autosave-off leave guard", () => {
  beforeEach(() => {
    listMaps.mockResolvedValue([MAP]);
    listAssets.mockResolvedValue([]);
    listMarkers.mockResolvedValue(MARKERS);
    listPages.mockResolvedValue([]);
    forMarker.mockResolvedValue([]);
    updateMarker.mockImplementation((_token: string, id: string) =>
      Promise.resolve({ ...marker(id, "Village"), label: "Village keep" })
    );
    goTo("/codex/atlas/m1?pin=k1");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prompts, and refusing keeps the pin AND the typed label", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = renderAtlas(new URLSearchParams("pin=k1"));

    const label = await screen.findByLabelText("Label");
    await user.type(label, " keep");
    await waitFor(() => expect(screen.getByText("Unsaved changes")).toBeInTheDocument());

    await user.click(await screen.findByRole("button", { name: "Pin Castle" }));
    atlasAt(view);

    // The guard ran and the GM said stay.
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(currentHref()).toBe("/codex/atlas/m1?pin=k1");
    expect(screen.getByTestId("map-surface")).toHaveAttribute("data-selected", "k1");
    // The draft is still there.
    expect(screen.getByLabelText("Label")).toHaveValue("Village keep");
    expect(updateMarker).not.toHaveBeenCalled();
  });

  it("moves when the GM accepts, and the new pin is in the address", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = renderAtlas(new URLSearchParams("pin=k1"));

    await user.type(await screen.findByLabelText("Label"), " keep");
    await user.click(await screen.findByRole("button", { name: "Pin Castle" }));
    atlasAt(view);

    await waitFor(() => expect(currentHref()).toBe("/codex/atlas/m1?pin=k2"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("map-surface")).toHaveAttribute("data-selected", "k2");
  });

  it("keeps the pin filters on the address it navigates to", async () => {
    const user = userEvent.setup();
    goTo("/codex/atlas/m1?q=cas&tag=ruin");
    const view = renderAtlas(new URLSearchParams("q=cas&tag=ruin"));

    await user.click(await screen.findByRole("button", { name: "Pin Castle" }));
    atlasAt(view);

    // The selection keeps `?q=`/`?tag=`.
    await waitFor(() => expect(currentHref()).toBe("/codex/atlas/m1?q=cas&tag=ruin&pin=k2"));
  });
});
