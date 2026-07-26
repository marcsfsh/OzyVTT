// Dev tool: record each source PDF's widgets into a sanitized JSON golden fixture.
// Run when the source PDFs (gitignored) are present locally:  node test/record-fixtures.mjs
// Mirrors src/read-pdf.ts readWidgets() and replaces the player handle for open-source safety.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const standardFontDataUrl = join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts/");
const dir = new URL("./fixtures/", import.meta.url);
const files = ["cleric5", "bard20", "warlock20", "fighter20", "wizard20", "multiclass"];

for (const f of files) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(new URL(`${f}.pdf`, dir))), standardFontDataUrl, useSystemFonts: false, isEvalSupported: false }).promise;
  const widgets = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const height = page.getViewport({ scale: 1 }).height;
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== "Widget" || !a.fieldName) continue;
      const raw = a.fieldValue ?? a.contents ?? "";
      let value = (Array.isArray(raw) ? raw.join(" ") : raw).toString().replace(/\s+/g, " ").trim();
      if (value === "") continue;
      value = value.replace(/Garrett_DM/g, "Player"); // sanitize the user's handle
      const r = a.rect ?? [0, 0, 0, 0];
      widgets.push({ name: a.fieldName, value, page: p, x: Math.round(r[0]), y: Math.round(height - r[3]) });
    }
  }
  await doc.destroy();
  writeFileSync(new URL(`${f}.widgets.json`, dir), JSON.stringify(widgets));
  console.log(f, widgets.length, "widgets");
}
