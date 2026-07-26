import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readWidgetsWith, type Widget } from "./widgets.js";

export type { Widget } from "./widgets.js";

const require = createRequire(import.meta.url);
// Standard-14 font data lets pdfjs render annotation appearance streams (Helvetica) without warnings.
const standardFontDataUrl = join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts/");

/** Node entry: read widgets from raw PDF bytes using the bundled legacy pdfjs build (used by tests/CLI). */
export function readWidgets(data: Uint8Array): Promise<Widget[]> {
  return readWidgetsWith(getDocument, data, { standardFontDataUrl });
}
