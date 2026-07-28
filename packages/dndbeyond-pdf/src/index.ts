import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { buildDefinition } from "./extract.js";
import { readWidgetsWith, type GetDocument } from "./widgets.js";

// Browser-safe entry: no Node built-ins, so this bundles into the client. The Node reader
// (raw-bytes -> widgets via the legacy pdfjs build) lives in ./read-pdf and is used by tests/CLI.

export interface ImportResult {
  /** The validated canonical definition, or null when the draft failed schema validation. */
  definition: ActorDefinition | null;
  /** The pre-validation draft (shown in the review UI even when invalid, so the GM can correct it). */
  draft: Record<string, unknown>;
  /** Low-confidence / dropped-data notices for the review screen. */
  warnings: string[];
  valid: boolean;
  /** Human-readable schema issues when `valid` is false. */
  issues: string[];
}

/** Validate a draft against the canonical schema, packaged for the review UI. */
export function validateDraft(draft: Record<string, unknown>, warnings: string[] = []): ImportResult {
  const parsed = ActorDefinitionSchema.safeParse(draft);
  if (parsed.success) return { definition: parsed.data, draft, warnings, valid: true, issues: [] };
  return {
    definition: null,
    draft,
    warnings,
    valid: false,
    issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

export interface ImportOptions {
  /** Passed through to pdfjs getDocument (e.g. `{ verbosity: 0 }`). */
  docOptions?: Record<string, unknown>;
  /** SRD content spell ids (from `content:spells`) — spells not in the set are flagged as unmatched. */
  knownSpellIds?: ReadonlySet<string>;
}

/** Extract a DDB PDF into a validated draft. Caller injects `getDocument` (browser build with a worker,
 * or the Node build) so this works in either environment. */
export async function importCharacterPdf(getDocument: GetDocument, data: Uint8Array, options: ImportOptions = {}): Promise<ImportResult> {
  const widgets = await readWidgetsWith(getDocument, data, options.docOptions);
  const { draft, warnings } = buildDefinition(widgets, { knownSpellIds: options.knownSpellIds });
  return validateDraft(draft, warnings);
}

export { buildDefinition } from "./extract.js";
export { readWidgetsWith } from "./widgets.js";
export type { GetDocument, Widget } from "./widgets.js";
export type { DraftResult } from "./extract.js";
