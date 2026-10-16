/**
 * The SRD 5.2.1 Rules Glossary as a lookup bundle: one entry per term, its tag ("Condition", "Action"...),
 * and its text with tables inlined. Source: the vendored markdown transcription (see its PROVENANCE.json).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { GlossaryEntrySchema } from "../src/schemas.js";
import { strip, slug, withTables } from "./markdown.js";
import { outDir, sourcePath } from "./paths.js";

const markdown = readFileSync(sourcePath("dnd-5e-srd-markdown", "rules-glossary.md"), "utf8");
const definitions = markdown.slice(markdown.indexOf("## Rules Definitions"));

/** Markdown emphasis and HTML out, paragraphs and list items kept as lines. `strip` folds all whitespace, so
 *  list breaks ride through it as a marker. */
const LIST_BREAK = "~list~";
function plain(body: string): string {
  return withTables(body)
    .split(/\n{2,}/)
    .map((paragraph) =>
      strip(paragraph.replace(/\n(?=[-*] )/g, LIST_BREAK))
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/(^|[\s("\u201c])_([^_]+)_/g, "$1$2")
        .replaceAll(LIST_BREAK, "\n")
    )
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n");
}

const entries = [...definitions.matchAll(/^#{3,4} (.+)\n([\s\S]*?)(?=^#{2,4} |(?![\s\S]))/gm)].map(
  ([, heading, body]) => {
    const tagged = heading.trim().match(/^(.*?)\s*\[([^\]]+)\]$/);
    const name = tagged ? tagged[1] : heading.trim();
    return { id: slug(name), name, tag: tagged ? tagged[2] : null, description: plain(body) };
  }
);

const parsed = z.array(GlossaryEntrySchema).safeParse(entries);
if (!parsed.success) {
  console.error("REFUSING TO WRITE - glossary failed validation:");
  for (const issue of parsed.error.issues.slice(0, 10)) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
const ids = new Set<string>();
for (const entry of entries) {
  if (ids.has(entry.id)) throw new Error(`Duplicate glossary id: ${entry.id}`);
  ids.add(entry.id);
}
writeFileSync(join(outDir, "glossary.v1.json"), `${JSON.stringify(entries, null, 1)}\n`);
console.log(`glossary: ${entries.length} entries`);
