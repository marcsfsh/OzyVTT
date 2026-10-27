import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTheme, THEME_COLOURS, THEMES } from "@vtt/ui";

// Each HTML entry decides the theme and the transparency before anything paints, in a script that repeats
// `resolveTheme` and `transparency.ts`. Each script runs here against fake storage and a fake system, and has to
// reach the same answer as the TypeScript for every row of the decision table, storage failures included.

type Stored = string | null | "throws";
type System = boolean | "missing" | "throws";

interface Scenario {
  theme: Stored;
  reduce: Stored;
  writeFails: boolean;
  prefersLight: System;
  prefersReduced: System;
}

function run(script: string, scenario: Scenario) {
  const attributes = new Map<string, string>();
  const meta = { content: "#000000", setAttribute: (_: string, value: string) => (meta.content = value) };
  const store = new Map<string, string>();
  const preset = { "vtt.theme": scenario.theme, "vtt.reduce-transparency": scenario.reduce };
  for (const [key, value] of Object.entries(preset)) if (value !== null && value !== "throws") store.set(key, value);
  const localStorage = {
    getItem(key: keyof typeof preset) {
      if (preset[key] === "throws") throw new Error("blocked");
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (scenario.writeFails) throw new Error("quota");
      store.set(key, value);
    }
  };
  const answer = (system: System) => {
    if (system === "throws") throw new Error("unreadable");
    return { matches: system === true };
  };
  const window = {
    matchMedia:
      scenario.prefersLight === "missing"
        ? undefined
        : (query: string) =>
            query === "(prefers-color-scheme: light)" ? answer(scenario.prefersLight) : answer(scenario.prefersReduced)
  };
  const document = {
    documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) },
    querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? meta : null)
  };
  new Function("document", "localStorage", "window", script)(document, localStorage, window);
  return { attributes, meta: meta.content, stored: store.get("vtt.theme") ?? null };
}

const STORED_THEMES: Stored[] = [...THEMES, "dark", "light", null, "sepia", "throws"];
const scenarios: Scenario[] = STORED_THEMES.flatMap((theme) =>
  ([true, false, "missing", "throws"] as const).flatMap((prefersLight) =>
    (["on", "off", null, "throws"] as const).flatMap((reduce) =>
      ([true, false] as const).flatMap((prefersReduced) =>
        ([false, true] as const).map((writeFails) => ({ theme, reduce, writeFails, prefersLight, prefersReduced }))
      )
    )
  )
);

describe.each(["index.html", "sheet.html", "viewer.html"])("the startup script in %s", (page) => {
  const html = readFileSync(join(process.cwd(), page), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

  it("starts with Dusk's browser chrome colour, before the script runs", () => {
    expect(html).toContain(`<meta name="theme-color" content="${THEME_COLOURS.dusk}" />`);
  });

  it("decides the theme as resolveTheme does, on every row of the table", () => {
    for (const scenario of scenarios) {
      const result = run(script, scenario);
      const stored = scenario.theme === "throws" ? null : scenario.theme;
      const { theme, writeback } = resolveTheme(stored, scenario.prefersLight === true);
      const label = JSON.stringify(scenario);
      expect(result.attributes.get("data-theme"), label).toBe(theme);
      expect(result.meta, label).toBe(THEME_COLOURS[theme]);
      if (writeback && !scenario.writeFails) expect(result.stored, label).toBe(writeback);
      else expect(result.stored, label).toBe(stored);
    }
  });

  it("reduces transparency when the device setting is on or the system asks, and never otherwise", () => {
    for (const scenario of scenarios) {
      const reduced =
        scenario.reduce === "on" || (scenario.prefersReduced === true && scenario.prefersLight !== "missing");
      const result = run(script, scenario);
      expect(result.attributes.get("data-transparency"), JSON.stringify(scenario)).toBe(
        reduced ? "reduced" : undefined
      );
    }
  });
});
