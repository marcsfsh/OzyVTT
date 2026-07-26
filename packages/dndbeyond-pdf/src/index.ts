import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { readWidgets } from "./read-pdf.js";
import { buildDefinition } from "./extract.js";

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

/** Extract a D&D Beyond PDF export into a draft `actor-character` definition and validate it. */
export async function importCharacterPdf(data: Uint8Array): Promise<ImportResult> {
  const widgets = await readWidgets(data);
  const { draft, warnings } = buildDefinition(widgets);
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

export { buildDefinition } from "./extract.js";
export { readWidgets } from "./read-pdf.js";
export type { Widget } from "./read-pdf.js";
export type { DraftResult } from "./extract.js";
