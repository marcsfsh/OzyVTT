import * as pdfjs from "pdfjs-dist";
// Vite bundles the worker locally (LAN-safe: no CDN). The `?url` import yields its hashed asset URL.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { importCharacterPdf, type GetDocument, type ImportResult } from "@vtt/dndbeyond-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Parse a D&D Beyond PDF export entirely in the browser (nothing is uploaded) into a validated draft.
 * `knownSpellIds` (from the cached SRD `content:spells`) lets unmatched/homebrew spells be flagged. */
export async function extractCharacterFromFile(file: File, knownSpellIds?: ReadonlySet<string>): Promise<ImportResult> {
  const data = new Uint8Array(await file.arrayBuffer());
  // verbosity 0 = errors only (the standard-font warning is irrelevant — values come from form fields).
  return importCharacterPdf(pdfjs.getDocument as unknown as GetDocument, data, { docOptions: { verbosity: 0 }, knownSpellIds });
}
