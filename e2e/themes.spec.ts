/**
 * The themes as the browser paints them: Dusk's glass composited over the real sky, Dawn's paper, and
 * reduced transparency, from the built client's own stylesheets. The unit tests check the token values; this checks
 * the layers they become. It reads the app's ground alone, so it changes nothing on the server.
 */
import type { Page } from "@playwright/test";
import { contrastRatio, luminance, parseColour, type Rgb } from "../packages/ui/src/theme/colour";
import { expect, settleLight, test } from "./smoke";

const INKS = ["--text", "--text-dim", "--text-muted", "--magenta-text", "--cyan-hi", "--hp-text"] as const;

/** Where the sky is darkest (top left) and where the rose afterglow is strongest (bottom right). */
const PROBES = [
  { name: "top left", left: 16, top: 72 },
  { name: "bottom right", right: 16, bottom: 16 }
] as const;

async function openIn(open: (path: string) => Promise<Page>, theme: "dusk" | "dawn", reduce: boolean) {
  const page = await open("/");
  await page.evaluate(
    ({ theme, reduce }) => {
      localStorage.setItem("vtt.theme", theme);
      localStorage.setItem("vtt.reduce-transparency", reduce ? "on" : "off");
    },
    { theme, reduce }
  );
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/**
 * Hides the page's own content and floats glass plates over the ground: a panel (--glass-surface-1 with the blur) with
 * a control on it (--glass-surface-3), as a bar and a sidebar hold them.
 */
async function floatPlates(page: Page) {
  await page.evaluate((probes) => {
    const root = document.getElementById("root");
    if (root) root.style.visibility = "hidden";
    for (const probe of probes) {
      const panel = document.createElement("div");
      panel.className = "surface-glass theme-probe";
      Object.assign(panel.style, {
        position: "fixed",
        width: "160px",
        height: "96px",
        left: "left" in probe ? `${probe.left}px` : "",
        top: "top" in probe ? `${probe.top}px` : "",
        right: "right" in probe ? `${probe.right}px` : "",
        bottom: "bottom" in probe ? `${probe.bottom}px` : ""
      });
      const control = document.createElement("div");
      Object.assign(control.style, {
        position: "absolute",
        left: "16px",
        bottom: "16px",
        width: "128px",
        height: "32px",
        background: "var(--glass-surface-3)"
      });
      panel.append(control);
      document.body.append(panel);
    }
  }, PROBES);
  await page.waitForTimeout(100);
  await settleLight(page);
}

/** The lightest and darkest pixels in a region of the screenshot, as the screen shows them. */
async function pixelRange(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const png = await page.screenshot({ clip: box });
  const [lightest, darkest] = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let light = [0, 0, 0];
    let dark = [255, 255, 255];
    const weight = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    for (let at = 0; at < pixels.length; at += 4) {
      const pixel = [pixels[at], pixels[at + 1], pixels[at + 2]];
      if (weight(pixel[0], pixel[1], pixel[2]) > weight(light[0], light[1], light[2])) light = pixel;
      if (weight(pixel[0], pixel[1], pixel[2]) < weight(dark[0], dark[1], dark[2])) dark = pixel;
    }
    return [light, dark];
  }, png.toString("base64"));
  return { lightest: lightest as unknown as Rgb, darkest: darkest as unknown as Rgb };
}

async function inks(page: Page) {
  return page.evaluate(
    (names) =>
      Object.fromEntries(names.map((name) => [name, getComputedStyle(document.body).getPropertyValue(name).trim()])),
    [...INKS]
  );
}

/** Every ink against the worst pixel of each plate: the lightest for light ink, the darkest for dark ink. */
async function expectInksReadOnPlates(page: Page, label: string) {
  const colours = await inks(page);
  const plates = page.locator(".theme-probe");
  for (let index = 0; index < PROBES.length; index++) {
    const panel = (await plates.nth(index).boundingBox())!;
    const control = (await plates.nth(index).locator("div").boundingBox())!;
    const regions = {
      panel: { x: panel.x + 4, y: panel.y + 4, width: panel.width - 8, height: 36 },
      control: { x: control.x + 2, y: control.y + 2, width: control.width - 4, height: control.height - 4 }
    };
    for (const [plate, box] of Object.entries(regions)) {
      const { lightest, darkest } = await pixelRange(page, box);
      for (const ink of INKS) {
        const colour = parseColour(colours[ink])!;
        const worst = luminance(colour) < luminance(lightest) ? lightest : darkest;
        expect
          .soft(contrastRatio(colour, worst), `${label} · ${ink} on the ${plate} at ${PROBES[index].name}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  }
}

test("Dusk paints glass over the sky with no scanlines, and every ink reads on it", async ({ open }) => {
  const page = await openIn(open, "dusk", false);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dusk");
  await expect(page.locator("html")).not.toHaveAttribute("data-transparency", "reduced");
  const layers = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const probe = document.createElement("div");
    probe.className = "surface-glass";
    document.body.append(probe);
    const glass = getComputedStyle(probe).backdropFilter;
    probe.remove();
    return {
      sky: body.backgroundImage,
      overlay: getComputedStyle(document.body, "::after").content,
      glass,
      scheme: getComputedStyle(document.documentElement).colorScheme
    };
  });
  // Each face loads from the built client itself, so the app works on a LAN with no font service.
  const fonts = await page.evaluate(async () =>
    Promise.all(
      ["Bungee", "Mr Dafoe", "Bai Jamjuree", "VT323"].map(
        async (family) => (await document.fonts.load(`16px "${family}"`)).length
      )
    )
  );
  const external = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /\.woff2?($|\?)/.test(name) && !name.startsWith(location.origin))
  );
  expect(layers.sky).toContain("radial-gradient");
  // No scanlines lie over the app (ADR-0045).
  expect(layers.overlay).toBe("none");
  expect(layers.glass).toContain("blur(16px)");
  expect(layers.scheme).toBe("dark");
  for (const [index, count] of fonts.entries()) expect(count, `font face ${index} loads`).toBeGreaterThan(0);
  expect(external, "fonts from another origin").toEqual([]);
  await floatPlates(page);
  await expectInksReadOnPlates(page, "Dusk");
});

for (const [theme, reduce] of [
  ["dusk", true],
  ["dawn", false],
  ["dawn", true]
] as const) {
  test(`${theme === "dusk" ? "Dusk" : "Dawn"}${reduce ? " with reduced transparency" : ""} paints solid plates with no scanlines`, async ({
    open
  }) => {
    const page = await openIn(open, theme, reduce);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    if (reduce) await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduced");
    const layers = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "surface-glass";
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const result = {
        glass: style.backdropFilter,
        plate: style.backgroundColor,
        solid: getComputedStyle(document.body).getPropertyValue("--surface-1").trim(),
        overlay: getComputedStyle(document.body, "::after").content,
        scheme: getComputedStyle(document.documentElement).colorScheme
      };
      probe.remove();
      return result;
    });
    expect(layers.glass).toBe("none");
    expect(parseColour(layers.plate)).toEqual(parseColour(layers.solid));
    expect(layers.overlay).toBe("none");
    expect(layers.scheme).toBe(theme === "dawn" ? "light" : "dark");
    await floatPlates(page);
    await expectInksReadOnPlates(page, `${theme}${reduce ? " reduced" : ""}`);
  });
}
