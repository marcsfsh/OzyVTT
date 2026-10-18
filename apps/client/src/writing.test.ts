/**
 * The Writing section of docs/DESIGN.md as test failures, in three scans. The first holds every string a person can
 * read in the client, the UI kit, the server and the shared packages to the rules in `writing-rules.ts`, and the second
 * holds the product's own words in the SRD bundles to them. The third bans the em dash, the en dash and curly quotes
 * anywhere in the repository's code, comments, tests and docs. What a regex can't judge ("X, not Y", a clause tacked on
 * with "-ing", a three-part series) is left to review.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { citeCopy, proseStrings, type ProseString } from "./copy-scan";
import { brokenRules, WRITING_RULES } from "./writing-rules";

/** Vite rewrites `import.meta.url`, so paths start from the client workspace, the cwd vitest runs in. */
const REPO = `${process.cwd()}/../..`;

/** Where user-facing strings live: the client, the UI kit, the server, and the packages whose messages reach a user. */
const COPY_ROOTS = [
  "apps/client/src",
  "packages/ui/src",
  "apps/server/src",
  "packages/domain/src",
  "packages/rules-5e/src",
  "packages/schemas/src",
  "packages/api-contract/src",
  "packages/content-srd-5.2.1/src",
  "packages/dndbeyond-pdf/src"
];

/** Source files that are test support or the scanner itself: what they say is read by developers in a failing test. */
const NOT_COPY = /\.test\.|\.d\.ts$|-harness\.ts$|\/(copy-scan|writing-rules|convention-sources)\.ts$/;

/** Every file under `dir` (repo-relative) that `keep` accepts. Directories `skip` names are left out. */
function walk(dir: string, keep: (path: string) => boolean, skip: (path: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const name of readdirSync(`${REPO}/${dir}`).sort()) {
    const path = `${dir}/${name}`;
    if (skip(path)) continue;
    if (statSync(`${REPO}/${path}`).isDirectory()) out.push(...walk(path, keep, skip));
    else if (keep(path)) out.push(path);
  }
  return out;
}

const copyFiles = COPY_ROOTS.flatMap((root) => walk(root, (path) => /\.tsx?$/.test(path) && !NOT_COPY.test(path)));
const strings: readonly ProseString[] = copyFiles.flatMap((file) =>
  proseStrings(file, readFileSync(`${REPO}/${file}`, "utf8"))
);

/**
 * Real exceptions, each with its reason: [file, string as scanned, rule id, why]. Matched on the whole string, so a
 * new string beside an exempted one is still checked. A row that excuses nothing fails the last test below.
 */
const EXEMPT: ReadonlyArray<readonly [file: string, text: string, rule: string, why: string]> = [
  [
    "apps/client/src/codex/BackupView.tsx",
    "Restore this backup?",
    "question",
    "A confirm dialog built on Modal, because its body lists what the restore replaces. This is its title."
  ],
  [
    "apps/client/src/codex/CodexSettings.tsx",
    "Delete all $ saved version$ across every page?",
    "question",
    "The opening line of a confirm dialog's body, built in a variable before the confirm call."
  ],
  [
    "apps/client/src/codex/CodexSettings.tsx",
    "Delete saved versions older than $ day$, across every page?",
    "question",
    "The opening line of a confirm dialog's body, built in a variable before the confirm call."
  ],
  [
    "apps/client/src/codex/autosave.ts",
    "You have unsaved changes. Leave without saving?",
    "question",
    "The text of the browser's own leave-page confirm, passed to window.confirm by name."
  ]
];

const exempt = (entry: ProseString, rule: string) =>
  EXEMPT.some(([file, text, id]) => file === entry.file && text === entry.text && id === rule);

describe("The writing rules, on every string a person reads", () => {
  it("reads the client, the UI kit, the server and the OpenAPI prose", () => {
    // Named anchors, so a scan that stops reading a root fails by name and a count can't hide it.
    const at = (file: string, text: RegExp) => strings.some((entry) => entry.file === file && text.test(entry.text));
    expect(at("apps/client/src/encounter/ActionTargetPicker.tsx", /^Choose what|caught when you roll/)).toBe(true);
    expect(at("packages/ui/src/primitives/Checklist.tsx", /^, done$/)).toBe(true);
    expect(at("apps/server/src/rests.ts", /^A Short Rest is already under way/)).toBe(true);
    // OpenAPI prose lives on the Zod schemas and in the route registry.
    expect(at("packages/domain/src/codex-wire.ts", /^The ordered checklist/)).toBe(true);
    expect(at("packages/api-contract/src/routes/system.ts", /^Answers as soon as the server is serving/)).toBe(true);
    expect(at("packages/rules-5e/src/dice.ts", /^Enter a dice formula/)).toBe(true);
    expect(strings.length).toBeGreaterThan(10_000);
  });

  it("tells a confirm dialog's own question from any other", () => {
    const confirm = strings.find(
      (entry) => entry.file === "apps/client/src/replay/ReplayList.tsx" && entry.text === "Delete this replay?"
    );
    expect(confirm?.confirm, "a confirm({ title }) is confirm text").toBe(true);
    const label = strings.find(
      (entry) => entry.file === "apps/client/src/compendium/NewRecordDialog.tsx" && entry.text === "Kind"
    );
    expect(label?.confirm, "a field label is not").toBe(false);
  });

  for (const rule of WRITING_RULES) {
    it(`breaks no "${rule.id}" rule`, () => {
      const offenders = strings.filter(
        (entry) => brokenRules(entry.text, entry.confirm).includes(rule) && !exempt(entry, rule.id)
      );
      expect(offenders.map(citeCopy), rule.fix).toEqual([]);
    });
  }

  it("catches each rule on a string written to break it", () => {
    const cases: Record<string, string> = {
      dash: "Saved \u2014 reload to see it.",
      "spaced-hyphen": "Saved - reload to see it.",
      "curly-quote": "It\u2019s saved.",
      emoji: "Saved \u{1F389}",
      question: "Ready?",
      exclamation: "Saved!",
      filler: "Just tap Save.",
      inflated: "A robust save.",
      pronoun: "Lyra drops her sword.",
      "ordinal-level": "a 3rd-level slot",
      "srd-term": "Take a long rest."
    };
    for (const rule of WRITING_RULES) {
      expect(cases[rule.id], `no case for "${rule.id}"`).toBeDefined();
      expect(brokenRules(cases[rule.id]).map((broken) => broken.id)).toContain(rule.id);
    }
    // What the rules leave alone: subtraction, a confirm's question, an SRD action name, code in backticks.
    expect(brokenRules("Try 2d6 + 1d4 - 2.")).toEqual([]);
    expect(brokenRules("Delete this replay?", true)).toEqual([]);
    expect(brokenRules("Take the Utilize action.")).toEqual([]);
    expect(brokenRules("Repeatable: `?id=a&id=b`.")).toEqual([]);
  });

  it("has no exemption that excuses nothing, and none without a reason", () => {
    for (const [file, text, id, why] of EXEMPT) {
      const rule = WRITING_RULES.find((candidate) => candidate.id === id);
      expect(rule, `exemption names an unknown rule "${id}"`).toBeDefined();
      const excused = strings.some(
        (entry) => entry.file === file && entry.text === text && brokenRules(entry.text, entry.confirm).includes(rule!)
      );
      expect(excused, `exemption ${JSON.stringify(`${file} :: ${text}`)} excuses nothing: delete it`).toBe(true);
      expect(why.length, `exemption ${JSON.stringify(text)} has no reason`).toBeGreaterThan(40);
    }
  });
});

/**
 * The bundles quote the SRD, so the scan above leaves them out, but these fields are the product's own words, written in
 * `sources/authored/` and `scripts/build-class-bundle.ts`. The builder shows them on its cards and detail panes.
 */
const AUTHORED_FIELDS: ReadonlyArray<readonly [bundle: string, fields: readonly string[]]> = [
  ["species", ["summary", "description"]],
  ["backgrounds", ["summary", "description"]],
  ["classes", ["summary", "description"]],
  ["languages", ["name", "description"]],
  ["feats", ["summary"]]
];

describe("The writing rules, on the product's own words in the SRD bundles", () => {
  const entries = AUTHORED_FIELDS.flatMap(([bundle, fields]) => {
    const rows = JSON.parse(
      readFileSync(`${REPO}/packages/content-srd-5.2.1/bundles/${bundle}.v1.json`, "utf8")
    ) as Array<Record<string, unknown>>;
    return rows.flatMap((row) =>
      fields.flatMap((field) => {
        const text = row[field];
        return typeof text === "string" ? [{ where: `${bundle}/${String(row.id)}.${field}`, text }] : [];
      })
    );
  });

  it("reads every authored field", () => {
    expect(entries.some((entry) => entry.where === "species/human.summary")).toBe(true);
    expect(entries.some((entry) => entry.where === "classes/warlock.description")).toBe(true);
    expect(entries.length).toBeGreaterThan(60);
  });

  it("breaks none of the rules", () => {
    const offenders = entries.flatMap((entry) =>
      brokenRules(entry.text).map((rule) => `${rule.id}  ${entry.where}  ${entry.text.slice(0, 120)}`)
    );
    expect(offenders).toEqual([]);
  });
});

/** Directories the repository-wide scan leaves out, each with its reason. */
const QUOTED: ReadonlyArray<readonly [prefix: string, why: string]> = [
  ["packages/content-srd-5.2.1/sources/", "SRD 5.2.1 and Open5e source text, quoted as published"],
  ["packages/content-srd-5.2.1/bundles/", "built from the SRD sources, so it quotes them"],
  ["packages/dndbeyond-pdf/test/fixtures/", "form fields read out of real D&D Beyond PDFs"]
];

// Claude Code's worktrees and local memory are machine-local and git-ignored.
const SKIPPED_DIRS = /\/(node_modules|dist|data|test-results|playwright-report|worktrees|agent-memory-local)$/;
const TEXT_FILE = /\.(ts|tsx|mts|mjs|js|json|md|css|html|yml)$/;
/** The em dash, the en dash and curly quotes. Code that must match one writes the escape (`\u2014`). */
const BANNED = /[\u2013\u2014\u2018\u2019\u201c\u201d]/;

describe("The banned characters, anywhere in the repository", () => {
  const files = [
    ...["README.md", "CLAUDE.md", "Dockerfile", "docker-compose.yml", ".dockerignore", ".env.example"],
    ...["apps", "packages", "docs", "e2e", ".claude", ".github"].flatMap((root) =>
      walk(
        root,
        (path) => TEXT_FILE.test(path) && !path.endsWith("settings.local.json"),
        (path) => SKIPPED_DIRS.test(path) || QUOTED.some(([prefix]) => `${path}/`.startsWith(prefix))
      )
    )
  ];

  it("walks the code, the docs and the tests", () => {
    for (const anchor of [
      "docs/DESIGN.md",
      "apps/server/src/server.ts",
      "packages/ui/src/index.ts",
      "e2e/journeys.spec.ts",
      ".claude/settings.json",
      ".github/workflows/ci.yml"
    ])
      expect(files).toContain(anchor);
  });

  it("has no em dash, en dash or curly quote in code, comments, tests or docs", () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(`${REPO}/${file}`, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (BANNED.test(line)) hits.push(`${file}:${index + 1}  ${line.trim().slice(0, 120)}`);
      });
    }
    expect(
      hits,
      "Use a colon, a full stop or `·` for a dash, a plain hyphen for a range (5-6), and straight quotes. " +
        "Code that has to match one of these characters writes its escape."
    ).toEqual([]);
  });
});
