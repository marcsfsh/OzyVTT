/**
 * Where a content script writes its bundles and reads the bundles of the steps before it: `--out=<dir>`,
 * else the committed `bundles/`. `build-content.ts` hands every step the same directory, so a run into a
 * scratch directory never reads a committed bundle.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const outFlag = process.argv.slice(2).find((argument) => argument.startsWith("--out="));
export const outDir = outFlag ? resolve(outFlag.slice("--out=".length)) : join(packageRoot, "bundles");

/** A source file under `sources/`, which no script ever writes. */
export const sourcePath = (...parts: string[]): string => join(packageRoot, "sources", ...parts);
