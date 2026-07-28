/** One D&D Beyond form-field widget: its field name, string value, page, and top-origin position. */
export interface Widget {
  name: string;
  value: string;
  page: number;
  x: number;
  y: number;
}

/** The slice of pdfjs's `getDocument` we depend on. The caller injects it — the Node legacy build
 * (tests/CLI) or the browser build with a worker (client) — so this module stays environment-agnostic. */
export type GetDocument = (opts: Record<string, unknown>) => { promise: Promise<PdfDoc> };
interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void>; }
interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  getAnnotations(): Promise<AnyWidget[]>;
}
interface AnyWidget {
  subtype: string;
  fieldName?: string;
  fieldValue?: string | string[] | null;
  contents?: string | null;
  rect?: [number, number, number, number];
}

/** Read every filled character-value widget from a DDB PDF. The sheet stores all character data as
 * named AcroForm widgets (`/T` name + `/V` value); template chrome is separate page text we ignore. */
export async function readWidgetsWith(getDocument: GetDocument, data: Uint8Array, docOptions: Record<string, unknown> = {}): Promise<Widget[]> {
  const doc = await getDocument({ data, useSystemFonts: false, isEvalSupported: false, ...docOptions }).promise;
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
