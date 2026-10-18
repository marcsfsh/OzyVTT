// PostToolUse hook: formats the file an Edit or Write just changed, so `npm run format:check` in CI
// passes. It never blocks: a file Prettier can't parse is left for the typecheck to report.
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";

try {
  const { tool_input: input } = JSON.parse(readFileSync(0, "utf8"));
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const file = input?.file_path;
  const inside = file && !relative(root, file).startsWith("..") && !isAbsolute(relative(root, file));
  if (inside) {
    const prettier = await import("prettier");
    const info = await prettier.getFileInfo(file, { ignorePath: join(root, ".prettierignore") });
    if (!info.ignored && info.inferredParser) {
      const source = readFileSync(file, "utf8");
      const options = (await prettier.resolveConfig(file)) ?? {};
      const formatted = await prettier.format(source, { ...options, filepath: file });
      if (formatted !== source) writeFileSync(file, formatted);
    }
  }
} catch {
  // Before `npm ci`, or on a syntax error: nothing to format.
}
