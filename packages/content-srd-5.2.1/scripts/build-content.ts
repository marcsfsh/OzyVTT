/**
 * Rebuilds every bundle, in dependency order. Run with `npm run content`.
 *
 *   1. Copies the hand-authored bundles in `sources/authored/` after validating them.
 *   2. `build-bundle.ts`: monsters, spells, weapons, armor and the other open5e reference bundles.
 *   3. `build-class-bundle.ts`: classes and subclasses. Starting equipment resolves against steps 1-2.
 *   4. `build-magic-items.ts`: magic items. Bases resolve against the weapons and armor from step 2.
 *   5. `build-glossary.ts`: the Rules Glossary.
 *
 * No step reads its own output. `--out=<dir>` sends every step's bundles there instead of `bundles/`,
 * and each step reads earlier steps' bundles from the same directory.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  BackgroundReferenceSchema,
  EquipmentReferenceSchema,
  FeatReferenceSchema,
  LanguageReferenceSchema,
  NamePoolReferenceSchema,
  SpeciesReferenceSchema
} from "../src/schemas.js";
import { outDir, packageRoot, sourcePath } from "./paths.js";

/** Bundles with no source to generate them from: `sources/authored/<name>.json` -> `<name>.v1.json`. */
const AUTHORED: ReadonlyArray<readonly [name: string, schema: z.ZodType]> = [
  ["equipment", EquipmentReferenceSchema],
  ["species", SpeciesReferenceSchema],
  ["backgrounds", BackgroundReferenceSchema],
  ["feats", FeatReferenceSchema],
  ["languages", LanguageReferenceSchema],
  ["names", NamePoolReferenceSchema]
];

const STEPS = ["build-bundle.ts", "build-class-bundle.ts", "build-magic-items.ts", "build-glossary.ts"] as const;

mkdirSync(outDir, { recursive: true });

for (const [name, schema] of AUTHORED) {
  const raw = readFileSync(sourcePath("authored", `${name}.json`), "utf8");
  const parsed = z.array(schema).safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error(`REFUSING TO WRITE - sources/authored/${name}.json failed validation:`);
    for (const issue of parsed.error.issues.slice(0, 10))
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  // Copied byte for byte, so the hand formatting (one equipment row per line) survives.
  writeFileSync(join(outDir, `${name}.v1.json`), raw);
}
console.log(`copied ${AUTHORED.length} authored bundles: ${AUTHORED.map(([name]) => name).join(", ")}`);

for (const step of STEPS) {
  console.log(`\n== ${step}`);
  try {
    // The same loader flags this script runs under (`--import tsx`), so each step runs the same way.
    execFileSync(process.execPath, [...process.execArgv, join(packageRoot, "scripts", step), `--out=${outDir}`], {
      stdio: "inherit"
    });
  } catch {
    console.error(`\n${step} failed; the bundles after it were not rebuilt.`);
    process.exit(1);
  }
}
