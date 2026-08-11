/**
 * **The API↔editor parity guard's machinery — unit A1, batch 2 of the remaining program.**
 *
 * An HTTP caller can author capabilities the homebrew editor cannot reach, and until this file
 * nothing measured that asymmetry: `packages/api-contract`'s parity gate holds *editor-written keys*
 * to the published document, but the reverse direction — a key the nine body schemas accept that no
 * control can author — was unguarded (~80 engine-read capabilities at the last hand count). This
 * module walks the nine `HOMEBREW_BODY_SCHEMAS` into editor-addressable questions, asks each of the
 * real form (`authoring-harness.ts`'s `hasControl`), and hands `api-parity.mirror.test.ts` an
 * uncovered set to hold against a reasoned exemption table — exactly, in both directions, the same
 * census discipline `vocabulary-parity.mirror.test.ts` uses for its owed rows.
 *
 * Vitest-free, like `authoring-harness.ts` beside it, so `src` can import it — the test imports it,
 * and so does the generator that writes `docs/product/vocabulary-parity-audit.md` (ruling 19: that
 * document is regenerated from this guard, never hand-edited).
 *
 * ## What the walk sees, and what it cannot
 *
 * The census sees KEYS; the round trip in the test sees VALUES; neither substitutes for the other
 * (`uses.scaling.type` had a control while `class-resource` stayed unauthorable — no key census can
 * see a missing OPTION). And a `z.record(...)` is a wall: `ActorDefinitionSchema.extensions` is
 * `z.record(z.string(), z.unknown())`, so the walk finds *no addresses inside it* — which is exactly
 * where `extensions["open5e.srd-2024"].savingThrows` lives. That blind spot is structural and is
 * declared as such below; unit B0's hand-declared statblock-extension contract is the answer to it,
 * not a cleverer walk.
 *
 * ## The canonicaliser fails loudly
 *
 * The editor's scope model is not isomorphic to the Zod path (container keys have no `FieldDef`;
 * riders are mounted at record scope, so `ActionSchema`'s keys answer at `["actions"]`, never at
 * `["features", "actions"]`). Every rewrite this file performs is validated: a rider restart whose
 * target container `fieldsWithin` cannot resolve throws rather than silently widening the
 * uncovered set. A stale rule is a red build, never a quiet pass.
 */

import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { HOMEBREW_BODY_SCHEMAS, type HomebrewBodyType } from "@vtt/content-srd-5.2.1/schemas";
import { ContentLibrary } from "../../../server/src/content-library.js";
import { createHomebrewRouter, homebrewPackBodyParser, HOMEBREW_PACK_IMPORT_PATH } from "../../../server/src/homebrew-http.js";
import { findCatalogRecord } from "../../../server/src/homebrew-srd-copy.js";
import { HomebrewStore } from "../../../server/src/homebrew-store.js";
import { createHomebrewValidator } from "../../../server/src/homebrew-validate.js";
import { applyField, fieldsOf, fieldsWithin, riderScopeOf } from "./authoring-harness";
import { riderFieldsForTest } from "./RiderEditor";
import { SCHEMAS } from "./schemas";
import type { HomebrewType } from "./types";

/* ================================================================ the schema walk ==== */

/**
 * One question the walk asks of the editor: "at this container, can a GM author this key?"
 * `within` is the editor-canonical rows chain (each segment a dotted `FieldDef` key); `key` is the
 * dotted leaf under that container — the exact vocabulary `hasControl` speaks.
 */
export type ParityAddress = Readonly<{ type: HomebrewBodyType; within: readonly string[]; key: string }>;

/** `a.b[].c`-style rendering, used by the exemption table, failure messages and the generated audit. */
export const addressId = (address: ParityAddress): string =>
  `${address.type}.${address.within.map((segment) => `${segment}[].`).join("")}${address.key}`;

type Def = Record<string, unknown> & { typeName?: string };
const defOf = (schema: unknown): Def => ((schema as { _def?: Def })?._def ?? {}) as Def;

/** Strip wrappers that carry no address of their own. Iterative, because they nest. */
function unwrap(schema: unknown): unknown {
  let cursor = schema;
  for (let hops = 0; hops < 32; hops += 1) {
    const def = defOf(cursor);
    switch (def.typeName) {
      case "ZodOptional": case "ZodNullable": case "ZodReadonly": case "ZodDefault": case "ZodCatch":
        cursor = def.innerType; break;
      case "ZodEffects": cursor = def.schema; break;
      case "ZodPipeline": cursor = def.in; break;
      case "ZodBranded": cursor = def.type; break;
      case "ZodLazy": cursor = (def.getter as () => unknown)(); break;
      default: return cursor;
    }
  }
  throw new Error("Schema wrapper nesting exceeded 32 levels — a cycle, not a schema.");
}

const shapeOf = (schema: unknown): Record<string, unknown> => {
  const shape = defOf(schema).shape;
  return (typeof shape === "function" ? shape() : shape) as Record<string, unknown>;
};

const isObjectSchema = (schema: unknown): boolean => defOf(schema).typeName === "ZodObject";

/** Every object option of a union, so a variant key is asked once whichever arm declares it. */
function objectOptions(schema: unknown): readonly unknown[] {
  const def = defOf(schema);
  if (def.typeName === "ZodUnion" || def.typeName === "ZodDiscriminatedUnion") {
    return ([...(def.options as Iterable<unknown>)]).map(unwrap).flatMap((option) => objectOptions(option));
  }
  return isObjectSchema(schema) ? [schema] : [];
}

/** The two schema-intrinsic counts the plan pins (162 / 709 at plan time) — measured off the same
    walk that produces the addresses, so the pin and the census cannot drift apart. */
export type WalkStats = Readonly<{ objectSchemas: number; declaredKeys: number }>;

/**
 * Expand the nine body schemas into the full raw address set. Rules, from the plan and verified
 * against the form model:
 *
 *   - a nested OBJECT extends the dotted key (`token.footprint.width` is one record-scope key);
 *   - an ARRAY OF OBJECTS starts a rows container (`actions`, `damage`) — its children restart
 *     their dotted path inside it, and the container key itself is not an address (a container
 *     either resolves for its children or the children are unreachable, which the probe reports);
 *   - an array of primitives, a record bag, a tuple and every scalar are leaves;
 *   - a UNION of objects contributes every arm's keys at the same address.
 */
export function walkBodySchemas(): { addresses: readonly ParityAddress[]; stats: WalkStats } {
  const addresses: ParityAddress[] = [];
  const seenObjects = new Set<unknown>();
  let declaredKeys = 0;

  const countObject = (schema: unknown) => {
    if (seenObjects.has(schema)) return;
    seenObjects.add(schema);
    declaredKeys += Object.keys(shapeOf(schema)).length;
  };

  const descend = (type: HomebrewBodyType, schema: unknown, within: readonly string[], prefix: readonly string[]) => {
    for (const objectSchema of objectOptions(schema)) {
      countObject(objectSchema);
      for (const [key, rawChild] of Object.entries(shapeOf(objectSchema))) {
        const child = unwrap(rawChild);
        const def = defOf(child);
        const dotted = [...prefix, key].join(".");
        if (def.typeName === "ZodArray") {
          const element = unwrap(def.type);
          const elementObjects = objectOptions(element);
          if (elementObjects.length > 0) {
            for (const arm of elementObjects) descend(type, arm, [...within, dotted], []);
          } else {
            addresses.push({ type, within, key: dotted });
          }
        } else if (objectOptions(child).length > 0) {
          descend(type, child, within, [...prefix, key]);
        } else {
          // Scalars, enums, records (opaque bags — the structural blind spot), tuples.
          addresses.push({ type, within, key: dotted });
        }
      }
    }
  };

  for (const [type, schema] of Object.entries(HOMEBREW_BODY_SCHEMAS) as ReadonlyArray<[HomebrewBodyType, unknown]>) {
    descend(type, unwrap(schema), [], []);
  }
  // The same key can arrive twice through two union arms; one question each.
  const unique = new Map(addresses.map((address) => [addressId(address), address]));
  return { addresses: [...unique.values()], stats: { objectSchemas: seenObjects.size, declaredKeys } };
}

/* ==================================================== canonicalisation and probing ==== */

/**
 * The rider surface is mounted at RECORD scope by `fieldsOf`/`fieldsWithin`, wherever the Zod path
 * hangs it — so a chain that reaches one of these segments (bare, or as the dotted suffix of a
 * segment like `feature.actions`) restarts there. Only the ROWS-shaped riders are chain segments:
 * `uses` is a group (its children are dotted record-scope keys, and the walk dots them the same
 * way), `tags` is an array of strings (a leaf), and `grants` has no `FieldDef` at all
 * (`RIDER_EXEMPT`), so no restart could make it resolve.
 */
const RIDER_SEGMENTS: readonly string[] = ["actions", "effects", "modifiers"];

/**
 * The feature-carrier containers, derived from the forms the way `riderScopeOf` derives its answer
 * — every `custom: "features"` field's key (`features`, `traits`, `lineages`, feat's singular
 * `feature`) — so a sixth carrier is covered the day it lands. `FeatureEditor` mounts the rider
 * surface once per feature, which the harness represents at RECORD scope; a chain that enters a
 * carrier therefore also answers with the carrier segment dropped.
 */
function featureCarrierKeys(type: HomebrewBodyType): readonly string[] {
  const keys: string[] = [];
  const walk = (fields: readonly { key: string; custom?: string; rows?: readonly unknown[] }[]) => {
    for (const field of fields) {
      if (field.custom === "features") keys.push(field.key);
      if (field.rows) walk(field.rows as readonly { key: string; custom?: string }[]);
    }
  };
  for (const section of SCHEMAS[type as HomebrewType].sections) walk(section.fields);
  return keys;
}

const containerResolves = (type: HomebrewBodyType, within: readonly string[]): boolean => {
  if (within.length === 0) return true;
  try { fieldsWithin(type as HomebrewType, within); return true; } catch { return false; }
};

type Candidate = Readonly<{ within: readonly string[]; key: string }>;

/**
 * The ordered candidate list for one raw address — the canonicalisation, spelled as data:
 *
 *   1. the address as the walk produced it;
 *   2. the RIDER RESTART — the chain re-rooted at its last rider segment (`…features[].actions[]`
 *      answers at `["actions"]`), including a rider that arrived dotted (`feature.actions`);
 *   3. the CARRIER DROP — a chain entering a feature carrier also answers with the carrier
 *      removed, because the per-feature rider mount is represented at record scope;
 *   4. KEY-PREFIX PROMOTION — a dotted prefix of the key that resolves as a rows container is
 *      entered (`feature.choice.type` at feat's record scope answers inside `["feature"]`,
 *      because the editor models the singular feature as rows the schema spells as an object).
 *
 * Expansion is breadth-first over 1–4 until closed, so combinations compose (promote `feature`,
 * then drop it as a carrier). Deduplicated; order preserved so `via` names the most literal hit.
 */
function candidatesFor(type: HomebrewBodyType, address: Candidate): readonly Candidate[] {
  const carriers = featureCarrierKeys(type);
  const queue: Candidate[] = [address];
  const seen = new Set<string>();
  const out: Candidate[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const id = `${current.within.join("¦")}→${current.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(current);
    const { within, key } = current;
    // 2 — rider restart, from the LAST segment that is (or dot-ends with) a rider name.
    for (let index = within.length - 1; index >= 0; index -= 1) {
      const segment = within[index];
      const rider = RIDER_SEGMENTS.find((name) => segment === name || segment.endsWith(`.${name}`));
      if (rider) {
        queue.push({ within: [rider, ...within.slice(index + 1)], key });
        break;
      }
    }
    // 3 — carrier drop.
    if (within.length > 0 && carriers.includes(within[0])) queue.push({ within: within.slice(1), key });
    // 4 — key-prefix promotion, longest prefix first.
    const segments = key.split(".");
    for (let take = segments.length - 1; take >= 1; take -= 1) {
      const prefix = segments.slice(0, take).join(".");
      if (containerResolves(type, [...within, prefix])) {
        queue.push({ within: [...within, prefix], key: segments.slice(take).join(".") });
        break;
      }
    }
  }
  return out;
}

/**
 * A dotted key is covered when it — or any dotted ANCESTOR of it — has a control at a resolvable
 * candidate address. The ancestor fallback is for composite controls only: a field with its own
 * `write` (the "Uses are" select seeding `uses.scaling`, the extension-bag fields) authors a whole
 * subtree, so it covers its children as KEYS — whether it can author every VALUE of them is
 * exactly what the census cannot see and the round trip can. A bare `kind: "group"` container key
 * does NOT count: a group renders its children and authors nothing itself, so crediting it would
 * report a schema key its `rows` never enumerate as covered — `class.skillChoices.fromCatalog`
 * was exactly that false green, found by this batch's adversarial review.
 */
export type ProbeResult = Readonly<{
  address: ParityAddress;
  covered: boolean;
  /** How it resolved: the winning chain+key, or why it did not. */
  via: string;
}>;

const controlAt = (type: HomebrewBodyType, key: string, within: readonly string[]): { write?: unknown } | undefined => {
  const fields = within.length === 0 ? fieldsOf(type as HomebrewType) : fieldsWithin(type as HomebrewType, within);
  return fields.find((field) => field.key === key);
};

/**
 * Keys a control authors although its OWN key is not the key and not an ancestor of it — the
 * "Uses are" select is a field named `mode` whose `write` sets `uses.scaling.type` (U7's worked
 * example: "the select always wrote it"). A key-addressed probe cannot see that, so each claim is
 * declared here and PROVED at probe time by running the real write and checking the key arrives —
 * a renamed writer or a changed seed shape flips the address to open instead of lying covered.
 */
const SIDE_EFFECT_WRITERS: ReadonlyArray<{
  key: string;
  writer: string;
  sample: unknown;
  /** Real writes run first so the writer has the container it expects (`mode` edits `scope.uses`). */
  prepare: ReadonlyArray<readonly [string, unknown]>;
  proves: (written: unknown) => boolean;
}> = [
  {
    key: "uses.scaling.type",
    writer: "mode",
    sample: "by-level",
    prepare: [["uses.limit", 1]],
    proves: (written) =>
      (written as { uses?: { scaling?: { type?: unknown } } })?.uses?.scaling?.type === "by-level"
  }
];

const sideEffectProofs = new Map<string, boolean>();
function sideEffectCovers(type: HomebrewBodyType, candidate: Candidate): string | null {
  for (const entry of SIDE_EFFECT_WRITERS) {
    if (candidate.key !== entry.key) continue;
    const cacheKey = `${type}¦${entry.key}`;
    if (!sideEffectProofs.has(cacheKey)) {
      // The writer is looked up in the RIDER MOUNT itself, not through the key-addressed flat
      // list: a bare key like `mode` is shadowed there by same-named schema fields (measured —
      // the flat lookup wrote `amount: 1` through an unrelated field), and the claim under proof
      // is about the rider's own control, so its own `write` is what runs.
      type LooseField = { key: string; write?: unknown; rows?: readonly LooseField[] };
      let writer: LooseField | undefined;
      const scope = riderScopeOf(type as HomebrewType);
      if (scope) {
        const walk = (fields: readonly LooseField[]) => {
          for (const field of fields) {
            if (!writer && field.key === entry.writer && typeof field.write === "function") writer = field;
            if (field.rows) walk(field.rows);
          }
        };
        walk(riderFieldsForTest(scope) as readonly LooseField[]);
      }
      let proved = false;
      if (writer) {
        try {
          let prepared: Record<string, unknown> = {};
          for (const [key, value] of entry.prepare) {
            prepared = applyField(type as HomebrewType, prepared, key, value, []) as Record<string, unknown>;
          }
          proved = entry.proves((writer.write as (next: unknown, scope: object) => object)(entry.sample, prepared));
        } catch {
          proved = false;
        }
      }
      sideEffectProofs.set(cacheKey, proved);
    }
    if (sideEffectProofs.get(cacheKey)) return `${entry.writer} (side-effect writer, proved)`;
  }
  return null;
}

export function probeAddress(address: ParityAddress): ProbeResult {
  const { type } = address;
  let sawContainer = false;
  for (const candidate of candidatesFor(type, { within: address.within, key: address.key })) {
    if (!containerResolves(type, candidate.within)) continue;
    sawContainer = true;
    const sideEffect = sideEffectCovers(type, candidate);
    if (sideEffect) return { address, covered: true, via: sideEffect };
    const segments = candidate.key.split(".");
    for (let take = segments.length; take >= 1; take -= 1) {
      const candidateKey = segments.slice(0, take).join(".");
      const field = controlAt(type, candidateKey, candidate.within);
      if (!field) continue;
      const exact = take === segments.length;
      if (!exact && typeof field.write !== "function") continue;
      return { address, covered: true, via: `${candidate.within.length > 0 ? `${candidate.within.join("[].")}[]. ` : ""}${candidateKey}${exact ? "" : " (composite ancestor)"}` };
    }
  }
  return { address, covered: false, via: sawContainer ? "no control" : "container unreachable" };
}

/**
 * The rider-restart rewrite, validated as the module header promises: every ROWS-bearing field the
 * type's rider mount declares at record scope must resolve as a container, and every restart target
 * in `RIDER_SEGMENTS` must be one of them somewhere. A rename in `RiderEditor` breaks this loudly
 * instead of silently flooding the uncovered set.
 */
export function assertCanonicaliserSound(): void {
  const resolvableSomewhere = new Set<string>();
  for (const type of Object.keys(HOMEBREW_BODY_SCHEMAS) as readonly HomebrewBodyType[]) {
    const scope = riderScopeOf(type as HomebrewType);
    if (scope === null) continue;
    for (const field of riderFieldsForTest(scope)) {
      if (!field.rows || field.kind !== "rows") continue;
      if (!containerResolves(type, [field.key])) {
        throw new Error(`Canonicaliser rule is stale: rider rows field "${field.key}" on ${type} does not resolve as a container.`);
      }
      resolvableSomewhere.add(field.key);
    }
  }
  for (const segment of RIDER_SEGMENTS) {
    if (!resolvableSomewhere.has(segment)) {
      throw new Error(`Canonicaliser rule is stale: restart target "${segment}" is not a rows field on any rider mount.`);
    }
  }
}

/* ============================================================== the exemption table ==== */

/**
 * One reasoned row per uncovered address GROUP — 1,611 open addresses is a fact, but 1,611
 * hand-written rows would bury the gaps the table exists to surface, so a row names a subtree and
 * the types it is open on. The census in `api-parity.mirror.test.ts` still holds the RAW open set
 * to these rows in both directions: every open address must land on a row (first match wins, so
 * order specific rows before general ones), every row must still match something, and the total
 * counts are pinned — a control landing on even one type moves a pinned number and goes red.
 *
 * `owner` is the unit that closes the group (from the four committed program plans),
 * `permanent: <why>` for a group no unit will ever cover, or `unowned: <why>` for a real gap no
 * plan owns yet — recorded honestly rather than dressed as permanent.
 */
export type ExemptionRow = Readonly<{
  /**
   * The path after the type, in `addressId` spelling. Three forms:
   *   - exact:            `spellcasting.saveDc` — matches that path alone;
   *   - subtree:          `actions[].grants.**` — the prefix before `**` matches at the path start
   *                       or at any `.`-boundary inside it (`features[].actions[].grants.name`);
   *   - anchored subtree: `^grants.**` — the prefix matches at the path start only, for a
   *                       record-scope subtree whose name recurs deeper in other rows' territory.
   */
  at: string;
  /** The record types the row exempts, or `"*"` for every type the walk finds the path on. */
  types: "*" | readonly HomebrewBodyType[];
  reason: string;
  owner: string;
}>;

/** The path half of an addressId — what `ExemptionRow.at` is matched against. */
export const pathOf = (address: ParityAddress): string =>
  `${address.within.map((segment) => `${segment}[].`).join("")}${address.key}`;

export function rowMatches(row: ExemptionRow, address: ParityAddress): boolean {
  if (row.types !== "*" && !row.types.includes(address.type)) return false;
  const path = pathOf(address);
  const anchored = row.at.startsWith("^");
  const pattern = anchored ? row.at.slice(1) : row.at;
  // An exact row floats to any `.`-boundary suffix unless anchored, the same way a subtree row
  // floats its prefix — `actions[].legendary.cost` is one gap wherever a carrier mounts actions.
  if (!pattern.endsWith("**")) return path === pattern || (!anchored && path.endsWith(`.${pattern}`));
  const prefix = pattern.slice(0, -2);
  if (path.startsWith(prefix)) return true;
  if (anchored) return false;
  for (let from = path.indexOf(prefix); from !== -1; from = path.indexOf(prefix, from + 1)) {
    if (path[from - 1] === ".") return true;
  }
  return false;
}

/**
 * The census's two directions, as data the test asserts empty: `unmatched` (an open address no row
 * carries — a new gap arrived un-reasoned) and `stale` (a row whose group no longer exists — a
 * control landed and the row must be deleted in the same commit). Assignment is first-match-wins
 * over the table's order, and `matched` reports each row's live count for the generated audit.
 */
export function censusVerdict(open: readonly ProbeResult[], rows: readonly ExemptionRow[]): {
  unmatched: readonly string[];
  stale: readonly string[];
  matched: ReadonlyMap<ExemptionRow, number>;
} {
  const matched = new Map<ExemptionRow, number>(rows.map((row) => [row, 0]));
  const unmatched: string[] = [];
  for (const result of open) {
    const row = rows.find((candidate) => rowMatches(candidate, result.address));
    if (row) matched.set(row, (matched.get(row) ?? 0) + 1);
    else unmatched.push(`${addressId(result.address)} (${result.via})`);
  }
  const stale = rows.filter((row) => (matched.get(row) ?? 0) === 0)
    .map((row) => `${row.types === "*" ? "*" : row.types.join("|")}.${row.at} (${row.owner})`);
  return { unmatched: unmatched.sort(), stale, matched };
}

/** The seven types that mount the action rider surface (spell and spell-list do not). */
const ACTION_CARRIERS: readonly HomebrewBodyType[] =
  ["background", "class", "equipment", "feat", "monster", "species", "subclass"];
/** The six that mount effects/feature riders (every action carrier except the statblock). */
const FEATURE_CARRIERS: readonly HomebrewBodyType[] =
  ["background", "class", "equipment", "feat", "species", "subclass"];

/**
 * THE TABLE. Measured against the walk on 2026-08-11 (the day this guard was written, per the
 * plan's own instruction to pin what the canonicaliser produces). Order matters: first match wins,
 * so the specific rows sit above the general ones. Owners cite
 * `docs/product/plan-api-program.md` (§3 units, §4 exclusions, §4.1 the C7 hand-off) unless named
 * otherwise; `docs/product/plan-engine-program.md` owns the U-numbered rows.
 */
export const EXEMPTIONS: readonly ExemptionRow[] = [
  // ---- the action rider surface (shared by every carrier that mounts actions) ----
  { at: "actions[].onHit[].**", types: ACTION_CARRIERS,
    reason: "a hit that lands a condition — no rows control on the action row", owner: "C1" },
  { at: "actions[].legendary.cost", types: ACTION_CARRIERS,
    reason: "the per-round pool cost — the record has actionsPerRound, the action has no cost", owner: "C2" },
  { at: "actions[].damageByLevel[].**", types: FEATURE_CARRIERS,
    reason: "damage that grows with level — feature-carrier actions only (a statblock ActionSchema has no such key, which is why monster is absent)", owner: "C3" },
  { at: "actions[].attack.count", types: ACTION_CARRIERS,
    reason: "attack keys the action rows do not enumerate — surfaced when the bare-group false credit was removed (this batch's adversarial review)", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "actions[].attack.criticalBonusDice", types: ACTION_CARRIERS,
    reason: "attack keys the action rows do not enumerate — surfaced when the bare-group false credit was removed (this batch's adversarial review)", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "actions[].attack.proficient", types: FEATURE_CARRIERS,
    reason: "the feature attack shape's proficiency flag — no row enumerates it (the statblock shape does not carry it)", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "actions[].save.dc.**", types: FEATURE_CARRIERS,
    reason: "the feature save's DERIVED dc object (ability/base/proficiencyBonus) — the rows author the statblock's flat number only", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "actions[].grants.**", types: ACTION_CARRIERS,
    reason: "an action that grants itself an effect, the whole EffectGrant subtree included", owner: "C4" },
  { at: "actions[].multiattack[].**", types: ACTION_CARRIERS,
    reason: "126 SRD authors; owned outside this program (census row at vocabulary-parity.mirror.test.ts:3416)", owner: "U21a (engine program)" },
  { at: "actions[].reaction.**", types: ACTION_CARRIERS,
    reason: "one SRD author (rogue uncanny-dodge) — test 2's 'not a lone record' is unsatisfiable (§4)", owner: "permanent: lone SRD record" },
  { at: "actions[].spellId", types: ACTION_CARRIERS,
    reason: "synthesised at character-build.ts:443, zero hand authors (§4)", owner: "permanent: system-synthesised" },
  { at: "actions[].spellSlot.level", types: ACTION_CARRIERS,
    reason: "synthesised from an item's consumesSpellSlot (equipment-derivation.ts:918), zero hand authors (§4)", owner: "permanent: system-synthesised" },
  { at: "actions[].requiresEffectTag", types: ACTION_CARRIERS,
    reason: "zero SRD authors; read at action-resolution.ts:230 — C4 authors the effect side it reads (§4)", owner: "permanent: zero SRD authors" },
  { at: "actions[].targetRules", types: ACTION_CARRIERS,
    reason: "one SRD author (§4, lone record)", owner: "permanent: lone SRD record" },

  // ---- the effect rider surface ----
  { at: "effects[].onEnd[].**", types: FEATURE_CARRIERS,
    reason: "what happens when an effect ends — no program unit authors it", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "effects[].endsWithTag", types: FEATURE_CARRIERS,
    reason: "effect linkage vocabulary with no control — no program unit authors it", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "effects[].target", types: FEATURE_CARRIERS,
    reason: "effect linkage vocabulary with no control — no program unit authors it", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "effects[].voidWhileIncapacitated", types: FEATURE_CARRIERS,
    reason: "effect linkage vocabulary with no control — no program unit authors it", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "modifiers[].**", types: FEATURE_CARRIERS,
    reason: "the modifier rows beyond U6's type control — neither union's per-key internals (appliesTo/damageTypes on effects; the feature union's filters) have fields", owner: "unowned: recorded by this census, owned by no plan" },

  // ---- feature-scope machinery shared by the five feature carriers ----
  { at: "choice.options[].**", types: "*",
    reason: "an option's own payload (nested choice, grants, uses, extraPicks) — the choice panel authors one level and no deeper", owner: "unowned: the panel's depth-1 boundary, recorded by this census" },
  { at: "choices[].**", types: "*",
    reason: "the plural choices list — the panel writes the singular choice; the list shape has no control at all", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "choice.**", types: "*",
    reason: "the parts of a feature's choice beyond the panel's fields", owner: "unowned: the panel's field set, recorded by this census" },
  // The GrantsEditor territory, spelled per mount rather than as a catch-all — a bare `grants.**`
  // would also float under `actions[].grants.` and silently absorb C4's group if C4's row were
  // deleted, which is exactly the rot T3's control probe checks for (measured while writing it).
  { at: "grants.spells[].**", types: "*",
    reason: "GrantsEditor writes the spells array whole (grantsFromRows, U9); the per-row keys have no FieldDef the probe can see", owner: "content-program C7, then the GrantsEditor→declarative follow-on (§4.1)" },
  { at: "features[].grants.**", types: "*",
    reason: "bespoke GrantsEditor JSX with no FieldDef — authored today through grantsFromRows and driven in pick-fields.test.tsx, invisible to the probe", owner: "content-program C7, then the GrantsEditor→declarative follow-on (§4.1)" },
  { at: "traits[].grants.**", types: "*",
    reason: "bespoke GrantsEditor JSX with no FieldDef — authored today through grantsFromRows and driven in pick-fields.test.tsx, invisible to the probe", owner: "content-program C7, then the GrantsEditor→declarative follow-on (§4.1)" },
  { at: "^feature.grants.**", types: ["feat"],
    reason: "bespoke GrantsEditor JSX at the feat's singular-feature scope — open now that the bare-group credit is gone", owner: "content-program C7, then the GrantsEditor\u2192declarative follow-on (\u00a74.1)" },
  { at: "^grants.**", types: "*",
    reason: "bespoke GrantsEditor JSX at record scope — same probe-blind mount", owner: "content-program C7, then the GrantsEditor→declarative follow-on (§4.1)" },
  { at: "uses.scaling.table[].**", types: "*",
    reason: "the by-level table at the three mounts the canonicaliser cannot reach — lineage depth, the feat's dotted singular feature, a cast's row scope (instrumented: exactly those six). The plain feature mounts author the table and probe covered", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "casts[].uses.scaling.**", types: ["equipment"],
    reason: "an item cast's scaling — zero SRD authors until the magic-item bundle lands", owner: "content-program C7, then the GrantsEditor→declarative follow-on (§4.1)" },
  { at: "extraPicks[].**", types: "*",
    reason: "extra-pick rows beyond the resolver U15 wired — no rows control at feature scope", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "replaces[].**", types: "*",
    reason: "the replacement clause's rows — written whole by the U14 control, per-key fields invisible to the probe", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "replacesFeatureId", types: ["species"],
    reason: "supersession at species-trait scope — the control exists on class features (U14), not here", owner: "unowned: recorded by this census, owned by no plan" },

  // ---- record-scope gaps, per type ----
  { at: "^lineages[].**", types: ["species"],
    reason: "a lineage's own traits — today a lineage row is name + description only", owner: "D2" },
  { at: "languageChoices.**", types: ["species"],
    reason: "9 of 9 SRD species author languageChoices — the builder's language offer has no authoring end", owner: "D1" },
  { at: "languageChoices.**", types: ["background"],
    reason: "zero SRD backgrounds author it (§4)", owner: "permanent: zero SRD authors" },
  { at: "^languages", types: ["background"],
    reason: "zero SRD backgrounds author it (§4)", owner: "permanent: zero SRD authors" },
  { at: "skillChoices.**", types: ["background"],
    reason: "zero SRD backgrounds author it (§4)", owner: "permanent: zero SRD authors" },
  { at: "toolChoices.**", types: ["background"],
    reason: "one SRD background authors it (§4, lone record)", owner: "permanent: lone SRD record" },
  { at: "abilityBonusChoice.**", types: ["species"],
    reason: "zero SRD species author it (§4)", owner: "permanent: zero SRD authors" },
  { at: "skillChoices.fromCatalog", types: ["class"],
    reason: "zero of 12 SRD classes author it — every class uses the from list, which has a control (\u00a74); the group's rows never offered it", owner: "permanent: zero SRD authors" },
  { at: "toolChoices.fromCatalog", types: ["class"],
    reason: "zero of 12 SRD classes author it (\u00a74); the group's rows never offered it", owner: "permanent: zero SRD authors" },
  { at: "multiclassProficiencies.**", types: ["class"],
    reason: "the builder does not multiclass — no reader on the build path and no control", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "multiclassPrerequisites.**", types: ["class"],
    reason: "the builder does not multiclass — the schema key has no reader on the build path and no control", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "levelTable[].classResources[].**", types: ["class", "subclass"],
    reason: "the resource rows LevelTableEditor writes without FieldDefs — E1's refactor gives them real fields plus the missing id/display pair", owner: "E1" },
  { at: "levelTable[].**", types: ["class", "subclass"],
    reason: "bespoke LevelTableEditor JSX with no FieldDef — authored today, invisible to the probe (the E1 refactor is the visibility fix)", owner: "E1" },
  { at: "^uses.scaling.id", types: ["equipment"],
    reason: "the class-resource id at ITEM scope — the dedicated field exists on feature mounts only; the item's uses rows omit it", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "weapon.mastery", types: ["equipment"],
    reason: "owned outside this program (census row at vocabulary-parity.mirror.test.ts:3415)", owner: "U38 (mastery program)" },
  { at: "weapon.properties", types: ["equipment"],
    reason: "batch 0 landed the plumbing; the editor control belongs to the content program (§4)", owner: "content-program C3" },
  { at: "prerequisite.**", types: ["feat"],
    reason: "feat prerequisites have no controls — the ability-score rows, the requires slug and the printed text alike", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "castingOptions[].**", types: ["spell"],
    reason: "a spell's casting options — the spell form has no rows control for them", owner: "unowned: recorded by this census, owned by no plan" },
  { at: "^add", types: ["spell-list"],
    reason: "written whole by the bespoke SpellListContents editor — no FieldDef the probe can see", owner: "permanent: bespoke editor, probe-blind" },
  { at: "^remove", types: ["spell-list"],
    reason: "written whole by the bespoke SpellListContents editor — no FieldDef the probe can see", owner: "permanent: bespoke editor, probe-blind" },

  // ---- the monster statblock's shared-schema tail ----
  { at: "^extensions", types: ["monster"],
    reason: "the opaque bag itself — the census's structural blind spot; B0 declares the key contract the walk cannot see", owner: "B0" },
  { at: "proficiencies.**", types: ["monster"],
    reason: "0 of 330 SRD monsters author it, and a control would change which rung saves resolve on (§4, B1's trap)", owner: "permanent: zero SRD authors" },
  { at: "spellcasting.**", types: ["monster"],
    reason: "a built-character field on the shared ActorDefinition — 0 of 330 SRD monster rows author it (§4)", owner: "permanent: built-character field" },
  { at: "character.**", types: ["monster"],
    reason: "a built-character field on the shared ActorDefinition — 0 of 330 SRD monster rows author it (§4)", owner: "permanent: built-character field" },
  { at: "startingInventory[].**", types: ["monster"],
    reason: "a built-character field on the shared ActorDefinition — 0 of 330 SRD monster rows author it (§4)", owner: "permanent: built-character field" },
  { at: "startingCurrency.**", types: ["monster"],
    reason: "a built-character field on the shared ActorDefinition — 0 of 330 SRD monster rows author it (§4)", owner: "permanent: built-character field" }
];

/* ============================================================ the round-trip compare ==== */

/**
 * The keys `normalizeBody` (`apps/server/src/homebrew-store.ts:791-800`) forces after a POST —
 * stripped from BOTH sides before the deep-equal, exactly the plan's list: `type`, `id`, and a
 * monster's `source.externalId`.
 */
export function comparableBody(type: HomebrewBodyType, body: Record<string, unknown>): Record<string, unknown> {
  const { type: _type, id: _id, ...rest } = body;
  if (type === "monster" && rest.source && typeof rest.source === "object") {
    const { externalId: _externalId, ...source } = rest.source as Record<string, unknown>;
    return { ...rest, source };
  }
  return rest;
}

/**
 * The first path at which two bodies differ, or null when they are deep-equal — so a T2 failure
 * names the field, not two multi-kilobyte JSON dumps. Arrays compare by index; objects by the
 * union of their keys, sorted, so a key present on one side alone is named too.
 */
export function firstDifference(api: unknown, editor: unknown, path = ""): { path: string; api: unknown; editor: unknown } | null {
  if (Object.is(api, editor)) return null;
  const bothArrays = Array.isArray(api) && Array.isArray(editor);
  const bothObjects = !bothArrays && typeof api === "object" && typeof editor === "object" && api !== null && editor !== null;
  if (!bothArrays && !bothObjects) return { path: path || "(root)", api, editor };
  if (bothArrays) {
    if (api.length !== editor.length) return { path: `${path}.length`, api: api.length, editor: editor.length };
    for (let index = 0; index < api.length; index += 1) {
      const difference = firstDifference(api[index], editor[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  const keys = [...new Set([...Object.keys(api as object), ...Object.keys(editor as object)])].sort();
  for (const key of keys) {
    const difference = firstDifference(
      (api as Record<string, unknown>)[key],
      (editor as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key
    );
    if (difference) return difference;
  }
  return null;
}

/**
 * Keys the system stamps that no GM ever authors by hand. These are subtracted STRUCTURALLY (with
 * one standing reason) rather than row-by-row, because listing ~140 forced-key rows would bury the
 * real gaps the table exists to surface.
 */
export const SYSTEM_FORCED = Object.freeze({
  /** Record identity and provenance: forced by `normalizeBody` / the row, never authored. */
  recordKeys: ["id", "type", "schemaId", "schemaVersion",
    // The feat's SINGULAR feature is one row spelled as a record-scope object, so its id is the
    // same newRow/bodyForPublish stamp as any row's — the dotted spelling of the rule below.
    "feature.id"] as readonly string[],
  /** The provenance bag and everything inside it (`source.externalId` is forced to the row id). */
  recordPrefixes: ["source."] as readonly string[],
  reason: "system-forced: stamped by the store, the row, or a rows editor's newRow — never authored by hand"
});

export const isSystemForced = (address: ParityAddress): boolean => {
  if (address.within.length === 0) {
    return SYSTEM_FORCED.recordKeys.includes(address.key)
      || SYSTEM_FORCED.recordPrefixes.some((prefix) => address.key === prefix.slice(0, -1) || address.key.startsWith(prefix));
  }
  // A row's own `id` is minted by the rows editor's `newRow` (and backfilled by `bodyForPublish`),
  // so it is the row-scope spelling of the same stamp.
  return address.key === "id";
};

/* ================================================================= the API fixture ==== */

/**
 * The real router over the real store, publish gate included — `apps/server/test/homebrew-http.test.ts`'s
 * fixture lifted whole, minus its vitest lifecycle: callers own `close()`. One boot per test FILE
 * (`beforeAll`), because `ContentLibrary` loads the full SRD bundle and per-test boot would dominate
 * the run.
 */
export type ApiFixture = Readonly<{ base: string; store: HomebrewStore; close: () => Promise<void> }>;

export async function bootHomebrewApi(): Promise<ApiFixture> {
  const directory = mkdtempSync(join(tmpdir(), "vtt-api-parity-"));
  const store = new HomebrewStore(join(directory, "vtt.sqlite"), () => Date.parse("2026-08-11T03:00:00.000Z"));
  await store.initialize();
  const contentLibrary = new ContentLibrary(store);
  const app = express();
  app.use(HOMEBREW_PACK_IMPORT_PATH, homebrewPackBodyParser());
  app.use(express.json({ limit: "512kb" }));
  app.use(createHomebrewRouter({
    store,
    authorizeGm: (token) => token === "gm-token",
    authorizePlayer: (token) => token === "player-token",
    notifyChanged: () => {},
    validate: createHomebrewValidator({
      forAudience: (audience) => contentLibrary.forAudience(audience),
      publishedSpellLists: () => store.publishedFor("gm").spellLists,
      authoredIndex: () => store.authoredIndex()
    }),
    catalogRecord: (id) => findCatalogRecord(contentLibrary.forAudience("gm"), id)
  }));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("API parity fixture did not bind.");
  return {
    base: `http://127.0.0.1:${bound.port}`,
    store,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

/* ============================================================== the generated audit ==== */

/**
 * `docs/product/vocabulary-parity-audit.md`, built from the guard's own census (ruling 19). The
 * hand-written four-way analysis this replaces is archived beside the other retired ledgers; this
 * document now states only what the guard can measure and re-measure — coverage — and points at
 * the census in `vocabulary-parity.mirror.test.ts` and the plans for ownership arguments.
 */
export function renderParityAudit(input: Readonly<{
  stats: WalkStats;
  results: readonly ProbeResult[];
  exemptions: readonly ExemptionRow[];
}>): string {
  const { stats, results, exemptions } = input;
  const covered = results.filter((result) => result.covered);
  const uncovered = results.filter((result) => !result.covered);
  const forced = uncovered.filter((result) => isSystemForced(result.address));
  const open = uncovered.filter((result) => !isSystemForced(result.address));
  const byType = new Map<string, { covered: number; open: number }>();
  for (const result of results) {
    const bucket = byType.get(result.address.type) ?? { covered: 0, open: 0 };
    if (result.covered) bucket.covered += 1;
    else if (!isSystemForced(result.address)) bucket.open += 1;
    byType.set(result.address.type, bucket);
  }
  const { matched } = censusVerdict(open, exemptions);
  const bucketOf = (row: ExemptionRow): string =>
    row.owner.startsWith("permanent:") ? "permanent"
      : row.owner.startsWith("unowned:") ? "unowned"
        : row.owner.split(" ")[0];
  const owners = new Map<string, ExemptionRow[]>();
  for (const row of exemptions) {
    const key = bucketOf(row);
    owners.set(key, [...(owners.get(key) ?? []), row]);
  }
  const lines: string[] = [];
  lines.push("# Vocabulary parity audit — the guard's census of the API↔editor gap");
  lines.push("");
  lines.push("**GENERATED — do not hand-edit.** Regenerate with `npm run docs` (or");
  lines.push("`npm run docs:parity --workspace=@vtt/web`); `apps/client/src/homebrew/api-parity.mirror.test.ts`");
  lines.push("fails when this file and the guard disagree. It replaces the hand-maintained audit of");
  lines.push("2026-08-09 (ruling 19, decision log 2026-08-10), which is archived at");
  lines.push("`docs/archive/vocabulary-parity-audit-hand-2026-08-09.md` — the four-way engine/SRD verdicts");
  lines.push("in that document were measurements of their day and are NOT reproduced by this generator,");
  lines.push("which states only what the guard itself measures: whether the editor can author each key");
  lines.push("the nine homebrew body schemas accept.");
  lines.push("");
  lines.push("## Headline counts");
  lines.push("");
  lines.push(`- **${stats.objectSchemas} distinct object schemas** carrying **${stats.declaredKeys} declared keys**, expanded to **${results.length} editor-addressable questions**.`);
  lines.push(`- **${covered.length} covered** — the editor has a control (or a composite ancestor control) for the key.`);
  lines.push(`- **${forced.length} system-forced** — stamped by the store or the row, never authored (id/type/source/schema stamps).`);
  lines.push(`- **${open.length} open**, every one carried by a reasoned exemption row below.`);
  lines.push("");
  lines.push("| type | covered | open |");
  lines.push("| --- | ---: | ---: |");
  for (const [type, bucket] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| ${type} | ${bucket.covered} | ${bucket.open} |`);
  }
  lines.push("");
  lines.push("## The exemption table — every open address, its reason, and who closes it");
  lines.push("");
  lines.push("A unit that lands a control deletes its rows here **in the same commit** (the census fails");
  lines.push("in both directions). `permanent:` rows are gaps no unit will close, each with why.");
  lines.push("");
  for (const [owner, rows] of [...owners.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`### ${owner === "permanent" ? "Permanent, with reasons"
      : owner === "unowned" ? "Unowned — real gaps no plan has claimed"
        : `Owner: ${owner}`}`);
    lines.push("");
    lines.push("| group | open | reason |");
    lines.push("| --- | ---: | --- |");
    for (const row of rows) {
      const spelled = `${row.types === "*" ? "*" : (row.types as readonly string[]).join("\\|")}.${row.at}`;
      lines.push(`| \`${spelled}\` | ${matched.get(row) ?? 0} | ${row.reason} |`);
    }
    lines.push("");
  }
  lines.push("## What this census cannot see, stated so nobody over-reads a green run");
  lines.push("");
  lines.push("- **Values.** A key with a control can still have an unauthorable value (an option missing");
  lines.push("  from a select). The round trip in `api-parity.mirror.test.ts` covers the values its");
  lines.push("  fixtures exercise; nothing covers the rest.");
  lines.push("- **The `extensions` bag.** `z.record(...)` has no addresses inside it, and the sharpest");
  lines.push("  monster gap (`extensions[\"open5e.srd-2024\"].savingThrows`, read by `saving-throws.ts`)");
  lines.push("  lives exactly there. Unit B0's hand-declared statblock-extension contract is the answer.");
  lines.push("- **Engine readers and SRD authorship.** This guard measures the editor. Whether the engine");
  lines.push("  reads a key and how many SRD records author it are the census in");
  lines.push("  `vocabulary-parity.mirror.test.ts` and the four program plans' evidence, not this file's.");
  lines.push("");
  return lines.join("\n");
}
