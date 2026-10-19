import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Input, Select, Textarea } from "@vtt/ui";
import { loadStylesheets, resolveVars } from "../../test/real-css";
import { pinchZoomAllowed, setPinchZoom } from "../settings/preferences";
import { FREE_VIEWPORT, HELD_VIEWPORT, TOUCH_SCREEN, installZoomGuard } from "./zoom-guard";

const repo = join(process.cwd(), "..", "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Answers the touch screen's query as `touch` says, and every other query false. */
function setTouchScreen(touch: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: touch && query === TOUCH_SCREEN,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

/** Sends a cancelable touchmove with one finger on each of `targets`; reports whether the page cancelled it. */
function fingersMove(...targets: Element[]): boolean {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: targets.map((target) => ({ target })) });
  targets[0].dispatchEvent(event);
  return event.defaultPrevented;
}

/** Sends Safari's `gesturestart` on `target`; reports whether the page cancelled it. */
function gestureStarts(target: Element): boolean {
  const event = new Event("gesturestart", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

const viewport = () => document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!.content;
const held = () => document.documentElement.hasAttribute("data-zoom-guard");

describe("the zoom guard", () => {
  const original = window.matchMedia;
  let uninstall = () => {};
  let unloadCss = () => {};

  beforeEach(() => {
    const meta = document.createElement("meta");
    meta.name = "viewport";
    meta.content = HELD_VIEWPORT;
    document.head.append(meta);
    // The real rules decide who handles their own fingers: the tokens give every element `pan-x pan-y`, and the map
    // and the atlas keep `none`.
    unloadCss = loadStylesheets([
      "packages/ui/src/styles/design-tokens.css",
      "apps/client/src/scene/encounter-map.css",
      "apps/client/src/codex/atlas/atlas.css"
    ]);
    setTouchScreen(true);
  });

  afterEach(() => {
    uninstall();
    uninstall = () => {};
    unloadCss();
    setPinchZoom(false);
    document.head.querySelector('meta[name="viewport"]')?.remove();
    window.matchMedia = original;
  });

  /** A scrolling list beside the battle map and the atlas, as the table and the Codex render them. */
  function page() {
    const { container } = render(
      <main>
        <div className="scroll-y">
          <p>Lyra Emberwise</p>
        </div>
        <div className="encounter-map-stage">
          <svg>
            <rect width="10" height="10" />
          </svg>
        </div>
        <div className="atlas-map">
          <svg>
            <circle r="4" />
          </svg>
        </div>
      </main>
    );
    return {
      row: container.querySelector("p")!,
      map: container.querySelector(".encounter-map-stage rect")!,
      atlas: container.querySelector(".atlas-map circle")!
    };
  }

  it("is on until the person turns pinch zoom on", () => {
    expect(pinchZoomAllowed()).toBe(false);
  });

  it("stops two fingers zooming the page, and leaves one finger to scroll", () => {
    uninstall = installZoomGuard();
    const { row } = page();
    expect(held()).toBe(true);
    expect(getComputedStyle(row).touchAction).toBe("pan-x pan-y");
    expect(fingersMove(row, row)).toBe(true);
    expect(gestureStarts(row)).toBe(true);
    expect(fingersMove(row)).toBe(false);
    expect(viewport()).toBe(HELD_VIEWPORT);
  });

  it("leaves the same pinch alone on the battle map and the atlas, which zoom themselves", () => {
    uninstall = installZoomGuard();
    const { map, atlas } = page();
    for (const surface of [map, atlas]) {
      expect(getComputedStyle(surface.closest("div")!).touchAction).toBe("none");
      expect(fingersMove(surface, surface), surface.tagName).toBe(false);
      expect(gestureStarts(surface), surface.tagName).toBe(false);
    }
  });

  it("stops a pinch with one finger on the map and one off it", () => {
    uninstall = installZoomGuard();
    const { row, map } = page();
    expect(fingersMove(map, row)).toBe(true);
  });

  it("lets go of the page while the setting allows pinch zoom, and holds it again when it is turned off", () => {
    uninstall = installZoomGuard();
    const { row } = page();
    setPinchZoom(true);
    expect(held()).toBe(false);
    expect(getComputedStyle(row).touchAction).toBe("auto");
    expect(fingersMove(row, row)).toBe(false);
    expect(gestureStarts(row)).toBe(false);
    expect(viewport()).toBe(FREE_VIEWPORT);

    setPinchZoom(false);
    expect(held()).toBe(true);
    expect(fingersMove(row, row)).toBe(true);
    expect(viewport()).toBe(HELD_VIEWPORT);
  });

  it("starts free when the setting was already on", () => {
    setPinchZoom(true);
    uninstall = installZoomGuard();
    expect(held()).toBe(false);
    expect(viewport()).toBe(FREE_VIEWPORT);
  });

  it("lets a page that is already zoomed in be pinched back out", () => {
    const visual = Object.assign(new EventTarget(), { scale: 2 });
    Object.defineProperty(window, "visualViewport", { value: visual, configurable: true });
    try {
      uninstall = installZoomGuard();
      const { row } = page();
      expect(fingersMove(row, row)).toBe(false);
      visual.scale = 1;
      visual.dispatchEvent(new Event("resize"));
      expect(fingersMove(row, row)).toBe(true);
    } finally {
      Reflect.deleteProperty(window, "visualViewport");
    }
  });

  it("leaves a trackpad's pinch alone on a device without a touch screen", () => {
    setTouchScreen(false);
    uninstall = installZoomGuard();
    const { row } = page();
    expect(gestureStarts(row)).toBe(false);
  });

  it("puts everything back when it is removed", () => {
    uninstall = installZoomGuard();
    const { row } = page();
    uninstall();
    uninstall = () => {};
    expect(held()).toBe(false);
    expect(fingersMove(row, row)).toBe(false);
    expect(gestureStarts(row)).toBe(false);
  });

  it.each(["apps/client/index.html", "apps/client/sheet.html", "apps/client/viewer.html"])(
    "%s holds the page from first paint and installs the guard",
    (entry) => {
      expect(read(entry)).toContain(`<meta name="viewport" content="${HELD_VIEWPORT}" />`);
      const script = /<script type="module" src="\/(src\/[\w-]+\.tsx)"><\/script>/.exec(read(entry))![1];
      expect(read(`apps/client/${script}`)).toMatch(/^installZoomGuard\(\);$/m);
    }
  );
});

/**
 * jsdom drops `!important` from a value that holds `var()` and resolves the `font` shorthand on its own, so these
 * read the floor's rule from the stylesheet and check which fields it matches. The smoke suite measures the real
 * sizes on a phone.
 */
describe("fields on a touch screen", () => {
  let unloadCss = () => {};
  afterEach(() => unloadCss());

  const tokens = () => withoutComments(read("packages/ui/src/styles/design-tokens.css"));

  /** The floor's selector, from the touch screen's media block in the tokens. */
  function floorSelector(): string {
    const media = `@media ${TOUCH_SCREEN} {`.replace(/[()]/g, "\\$&");
    const rule = new RegExp(`${media}\\s*([^{}]+)\\{\\s*font-size: var\\(--fs-field-touch\\) !important;\\s*\\}`);
    const found = rule.exec(tokens());
    expect(found, "the floor's rule").not.toBeNull();
    return found![1].trim();
  }

  it("is 16px, and no other rule can beat it", () => {
    unloadCss = loadStylesheets(["packages/ui/src/styles/design-tokens.css"]);
    expect(resolveVars(document.documentElement, "var(--fs-field-touch)")).toBe("16px");
    // `!important` beats every rule that sets a field's size, unless another `!important` font rule is there too.
    const offenders: string[] = [];
    for (const root of ["apps/client/src", "packages/ui/src"])
      for (const file of readdirSync(join(repo, root), { recursive: true, encoding: "utf8" })) {
        if (!file.endsWith(".css")) continue;
        for (const match of withoutComments(read(join(root, file))).matchAll(/font(?:-size)?\s*:[^;{}]*!important/g))
          if (!match[0].includes("var(--fs-field-touch)")) offenders.push(`${root}/${file}: ${match[0]}`);
      }
    expect(offenders).toEqual([]);
  });

  it("covers every field a person types in or picks from, so focusing one never zooms the page on iOS", () => {
    const { container } = render(
      <div>
        <Input aria-label="Name" />
        <Input aria-label="Search" type="search" />
        <Input aria-label="Level" type="number" />
        <Input aria-label="Password" type="password" />
        <Select aria-label="Size">
          <option>Medium</option>
        </Select>
        <Textarea aria-label="Notes" />
        <input aria-label="Range" />
        <select aria-label="Light">
          <option>Bright</option>
        </select>
        <textarea aria-label="Message" />
      </div>
    );
    const selector = floorSelector();
    for (const field of container.querySelectorAll("input, select, textarea"))
      expect(field.matches(selector), field.outerHTML).toBe(true);
  });

  it("leaves the title field, which is larger already, and the controls that take no typing", () => {
    unloadCss = loadStylesheets(["packages/ui/src/styles/design-tokens.css"]);
    const { container } = render(
      <div>
        <Input aria-label="Title" variant="title" />
        <input aria-label="Ready" type="checkbox" />
        <input aria-label="Side" type="radio" />
        <input aria-label="Volume" type="range" />
        <input aria-label="Colour" type="color" />
        <input aria-label="Map" type="file" />
      </div>
    );
    const selector = floorSelector();
    for (const field of container.querySelectorAll("input"))
      expect(field.matches(selector), field.outerHTML).toBe(false);
    const title = /\.nh-input--title \{\s*font: 400 var\((--fs-[\w-]+)\)/.exec(
      read("packages/ui/src/primitives/forms.css")
    );
    expect(parseFloat(resolveVars(document.documentElement, `var(${title![1]})`))).toBeGreaterThan(16);
  });
});
