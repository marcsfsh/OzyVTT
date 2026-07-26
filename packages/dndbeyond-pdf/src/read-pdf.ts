import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** One D&D Beyond form-field widget: its field name, string value, page, and top-origin position. */
export interface Widget {
  name: string;
  value: string;
  page: number;
  /** Left edge in PDF points. */
  x: number;
  /** Top edge in top-origin PDF points (0 = top of page), for reading-order sorts. */
  y: number;
}

const require = createRequire(import.meta.url);
// pdfjs needs the standard-14 font data to render annotation appearance streams (Helvetica) without warnings.
const standardFontDataUrl = join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts/");

/**
 * Extract every filled character-value widget from a D&D Beyond PDF export.
 * The DDB sheet stores all character data as named AcroForm widgets (`/T` name + `/V` value);
 * template chrome is separate page text we deliberately ignore.
 */
export async function readWidgets(data: Uint8Array): Promise<Widget[]> {
  const doc = await getDocument({ data, standardFontDataUrl, useSystemFonts: false, isEvalSupported: false }).promise;
  const widgets: Widget[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const height = page.getViewport({ scale: 1 }).height;
      for (const a of await page.getAnnotations()) {
        if (a.subtype !== "Widget" || !a.fieldName) continue;
        const raw = a.fieldValue ?? a.contents ?? "";
        const value = (Array.isArray(raw) ? raw.join(" ") : raw).toString().replace(/\s+/g, " ").trim();
        if (value === "") continue;
        const rect = a.rect ?? [0, 0, 0, 0];
        widgets.push({ name: a.fieldName, value, page: p, x: Math.round(rect[0]), y: Math.round(height - rect[3]) });
      }
    }
  } finally {
    await doc.destroy();
  }
  return widgets;
}
