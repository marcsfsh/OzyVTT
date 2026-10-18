import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, parseColour, type Rgb } from "@vtt/ui";

/**
 * The real stylesheets, loaded into jsdom for the checks that are about paint: jsdom runs the cascade (which rule
 * wins, custom properties and their inheritance) and leaves `var()` unresolved, so `colourOf` resolves it here.
 * It does no layout, so geometry stays with the browser smoke suite.
 */

const repo = join(process.cwd(), "..", "..");

/** The UI kit's whole stylesheet (tokens and every primitive) and the client's shared one. */
export function baseStylesheets(): string[] {
  const ui = join(repo, "packages/ui/src");
  return [
    join(ui, "styles/design-tokens.css"),
    ...readdirSync(join(ui, "primitives"))
      .filter((name) => name.endsWith(".css"))
      .map((name) => join(ui, "primitives", name)),
    join(ui, "theme/ThemeSwitch.css"),
    join(repo, "apps/client/src/styles.css")
  ];
}

/** Appends each file as a `<style>` in `<head>`, in order; returns the cleanup. */
export function loadStylesheets(paths: readonly string[]): () => void {
  const added = paths.map((path) => {
    const style = document.createElement("style");
    style.dataset.source = path;
    style.textContent = readFileSync(path.startsWith("/") ? path : join(repo, path), "utf8");
    document.head.append(style);
    return style;
  });
  return () => added.forEach((style) => style.remove());
}

/** A value with every `var(--x, fallback)` replaced from the custom properties `element` sees. */
export function resolveVars(element: Element, value: string): string {
  let text = value.trim();
  for (let hop = 0; hop < 20 && text.includes("var("); hop++)
    text = text.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/, (_, name: string, fallback?: string) => {
      const found = getComputedStyle(element).getPropertyValue(name).trim();
      return found || (fallback ?? "").trim();
    });
  return text;
}

/** The colour `element` paints its text in, with `currentColor` and `inherit` followed up the tree. */
export function textColourOf(element: Element): Rgb {
  let at: Element | null = element;
  for (let hop = 0; at && hop < 30; hop++) {
    const value = resolveVars(at, getComputedStyle(at).color);
    if (value && value !== "currentcolor" && value.toLowerCase() !== "currentcolor" && value !== "inherit") {
      const colour = parseColour(value);
      if (colour) return colour;
    }
    at = at.parentElement;
  }
  throw new Error(`no text colour resolves for ${element.outerHTML.slice(0, 80)}`);
}

/** A token's colour as `element` sees it. */
export function tokenColourOf(element: Element, token: string): Rgb {
  const value = resolveVars(element, `var(${token})`);
  const colour = parseColour(value);
  if (!colour) throw new Error(`${token} is not a plain colour here: ${value}`);
  return colour;
}

export { contrastRatio };
