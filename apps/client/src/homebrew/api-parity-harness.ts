/**
 * Machinery for the API-to-editor parity guard (`api-parity.mirror.test.ts`): walks the
 * `HOMEBREW_BODY_SCHEMAS` into editor-addressable keys, asks the real form (`hasControl`) whether a
 * GM can author each, and checks the uncovered set against a reasoned exemption table in both
 * directions. Vitest-free, like `authoring-harness.ts`.
 *
 * The walk sees keys, not values (a missing enum option is invisible here; the round trip in the
 * test catches that). A `z.record(...)` is opaque, so nothing inside
 * `ActorDefinitionSchema.extensions` is addressed.
 *
 * Every canonicalising rewrite is validated: a rider restart whose container `fieldsWithin` cannot
 * resolve throws rather than silently widening the uncovered set.
 */

import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { HOMEBREW_BODY_SCHEMAS, type HomebrewBodyType } from "@vtt/content-srd-5.2.1/schemas";
import { ContentLibrary } from "../../../server/src/content-library.js";
import {
  createHomebrewRouter,
  homebrewPackBodyParser,
  HOMEBREW_PACK_IMPORT_PATH
} from "../../../server/src/homebrew-http.js";
import { findCatalogRecord } from "../../../server/src/homebrew-srd-copy.js";
import { HomebrewStore } from "../../../server/src/homebrew-store.js";
import { createHomebrewValidator } from "../../../server/src/homebrew-validate.js";
import { applyField, fieldsOf, fieldsWithin, riderScopeOf } from "./authoring-harness";
import { riderFieldsForTest } from "./RiderEditor";
import { SCHEMAS } from "./schemas";
import type { HomebrewType } from "./types";

/* ================================================================ the schema walk ==== */

/** One question for the editor: can a GM author `key` in this container? `within` is the
    editor-canonical rows chain; `key` is the dotted leaf, as `hasControl` takes them. */
export type ParityAddress = Readonly<{ type: HomebrewBodyType; within: readonly string[]; key: string }>;

/** `a.b[].c` rendering, used by the exemption table, failure messages and the audit. */
export const addressId = (address: ParityAddress): string =>
  `${address.type}.${address.within.map((segment) => `${segment}[].`).join("")}${address.key}`;

type Def = Record<string, unknown> & { type?: string };
const defOf = (schema: unknown): Def => ((schema as { _zod?: { def?: Def } })?._zod?.def ?? {}) as Def;

/** Strip wrappers that carry no address of their own. Iterative, because they nest. Refinements
    live inside a schema in Zod 4, so only wrappers and pipes remain to peel. */
function unwrap(schema: unknown): unknown {
  let cursor = schema;
  for (let hops = 0; hops < 32; hops += 1) {
    const def = defOf(cursor);
    switch (def.type) {
      case "optional":
      case "nullable":
      case "readonly":
      case "default":
      case "prefault":
      case "catch":
      case "nonoptional":
        cursor = def.innerType;
        break;
      case "pipe":
        // `.transform()` pipes the schema into a transform; `z.preprocess` pipes a transform into it.
        cursor = defOf(def.in).type === "transform" ? def.out : def.in;
        break;
      case "lazy":
        cursor = (def.getter as () => unknown)();
        break;
      default:
        return cursor;
    }
  }
  throw new Error("Schema wrapper nesting exceeded 32 levels — a cycle, not a schema.");
}

const shapeOf = (schema: unknown): Record<string, unknown> => defOf(schema).shape as Record<string, unknown>;

const isObjectSchema = (schema: unknown): boolean => defOf(schema).type === "object";

/** Every object option of a union, so a variant key is asked once whichever arm declares it. */
function objectOptions(schema: unknown): readonly unknown[] {
  const def = defOf(schema);
  if (def.type === "union") {
    return [...(def.options as Iterable<unknown>)].map(unwrap).flatMap((option) => objectOptions(option));
  }
  return isObjectSchema(schema) ? [schema] : [];
}

/** Schema-intrinsic counts from the same walk that produces the addresses, so the pins cannot drift. */
export type WalkStats = Readonly<{ objectSchemas: number; declaredKeys: number }>;

/**
 * Expands the body schemas into the full address set:
 * - a nested object extends the dotted key (`token.footprint.width`);
 * - an array of objects starts a rows container whose children restart their path; the container
 *   key itself is not an address;
 * - arrays of primitives, records, tuples and scalars are leaves;
 * - a union of objects contributes every arm's keys at the same address.
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
        if (def.type === "array") {
          const element = unwrap(def.element);
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

/** Rider segments: the rider surface is mounted at record scope, so a chain reaching one of these
    (bare, or as a dotted suffix like `feature.actions`) restarts there. Only rows-shaped riders
    qualify: `uses` is a group, `tags` a leaf, and `grants` has no `FieldDef`. */
const RIDER_SEGMENTS: readonly string[] = ["actions", "effects", "modifiers"];

/** The feature-carrier container keys (every `custom: "features"` field), derived from the forms.
    `FeatureEditor` mounts the rider surface per feature, which the harness represents at record
    scope, so a chain entering a carrier also answers with the carrier segment dropped. */
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
  try {
    fieldsWithin(type as HomebrewType, within);
    return true;
  } catch {
    return false;
  }
};

type Candidate = Readonly<{ within: readonly string[]; key: string }>;

/**
 * Ordered candidate addresses for one raw address:
 * 1. as walked;
 * 2. rider restart: re-rooted at the last rider segment (`…features[].actions[]` → `["actions"]`);
 * 3. carrier drop: a chain entering a feature carrier, with the carrier removed;
 * 4. key-prefix promotion: a dotted key prefix that resolves as a rows container is entered (the
 *    feat's singular `feature` object is modelled as rows).
 * Expanded breadth-first until closed, deduplicated, order preserved so `via` names the most
 * literal hit.
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
    // 2: rider restart, from the last segment that is (or dot-ends with) a rider name.
    for (let index = within.length - 1; index >= 0; index -= 1) {
      const segment = within[index];
      const rider = RIDER_SEGMENTS.find((name) => segment === name || segment.endsWith(`.${name}`));
      if (rider) {
        queue.push({ within: [rider, ...within.slice(index + 1)], key });
        break;
      }
    }
    // 3: carrier drop.
    if (within.length > 0 && carriers.includes(within[0])) queue.push({ within: within.slice(1), key });
    // 4: key-prefix promotion, longest prefix first.
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

/** A dotted key is covered when it, or a dotted ancestor, has a control at a resolvable candidate.
    Ancestors count only for composite controls with their own `write` (they author a whole subtree);
    a bare `group` container authors nothing itself and does not count. */
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

/** Keys a control authors under a different key (e.g. the "Uses are" `mode` select writes
    `uses.scaling.type`). Each claim is proved at probe time by running the real write, so a renamed
    writer leaves the address open instead of falsely covered. */
const SIDE_EFFECT_WRITERS: ReadonlyArray<{
  key: string;
  writer: string;
  sample: unknown;
  /** Writes run first so the writer has the container it expects (`mode` edits `scope.uses`). */
  prepare: ReadonlyArray<readonly [string, unknown]>;
  proves: (written: unknown) => boolean;
}> = [
  {
    key: "uses.scaling.type",
    writer: "mode",
    sample: "by-level",
    prepare: [["uses.limit", 1]],
    proves: (written) => (written as { uses?: { scaling?: { type?: unknown } } })?.uses?.scaling?.type === "by-level"
  }
];

const sideEffectProofs = new Map<string, boolean>();
function sideEffectCovers(type: HomebrewBodyType, candidate: Candidate): string | null {
  for (const entry of SIDE_EFFECT_WRITERS) {
    if (candidate.key !== entry.key) continue;
    const cacheKey = `${type}¦${entry.key}`;
    if (!sideEffectProofs.has(cacheKey)) {
      // Look the writer up in the rider mount itself: a bare key like `mode` is shadowed by
      // same-named schema fields in the flat list.
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
      return {
        address,
        covered: true,
        via: `${candidate.within.length > 0 ? `${candidate.within.join("[].")}[]. ` : ""}${candidateKey}${exact ? "" : " (composite ancestor)"}`
      };
    }
  }
  return { address, covered: false, via: sawContainer ? "no control" : "container unreachable" };
}

/** Validates the rider-restart rewrite: every rows-bearing rider field must resolve as a container,
    and every `RIDER_SEGMENTS` target must exist, so a `RiderEditor` rename fails loudly. */
export function assertCanonicaliserSound(): void {
  const resolvableSomewhere = new Set<string>();
  for (const type of Object.keys(HOMEBREW_BODY_SCHEMAS) as readonly HomebrewBodyType[]) {
    const scope = riderScopeOf(type as HomebrewType);
    if (scope === null) continue;
    for (const field of riderFieldsForTest(scope)) {
      if (!field.rows || field.kind !== "rows") continue;
      if (!containerResolves(type, [field.key])) {
        throw new Error(
          `Canonicaliser rule is stale: rider rows field "${field.key}" on ${type} does not resolve as a container.`
        );
      }
      resolvableSomewhere.add(field.key);
    }
  }
  for (const segment of RIDER_SEGMENTS) {
    if (!resolvableSomewhere.has(segment)) {
      throw new Error(
        `Canonicaliser rule is stale: restart target "${segment}" is not a rows field on any rider mount.`
      );
    }
  }
}

/* ============================================================== the exemption table ==== */

/**
 * One reasoned row per uncovered address group (a subtree plus the types it is open on). The test
 * holds the raw open set to these rows in both directions: every open address matches a row (first
 * match wins, so specific rows come first), every row still matches something, and totals are
 * pinned. `status` is `gap` when an editor control could close the group, or `permanent:` and why not.
 */
export type ExemptionRow = Readonly<{
  /**
   * The path after the type, in `addressId` spelling:
   * - exact: `spellcasting.saveDc`;
   * - subtree: `actions[].grants.**` matches at the path start or any `.` boundary inside it;
   * - anchored subtree: `^grants.**` matches at the path start only.
   */
  at: string;
  /** The record types the row exempts, or `"*"` for every type the walk finds the path on. */
  types: "*" | readonly HomebrewBodyType[];
  reason: string;
  status: string;
}>;

/** The path half of an addressId — what `ExemptionRow.at` is matched against. */
export const pathOf = (address: ParityAddress): string =>
  `${address.within.map((segment) => `${segment}[].`).join("")}${address.key}`;

export function rowMatches(row: ExemptionRow, address: ParityAddress): boolean {
  if (row.types !== "*" && !row.types.includes(address.type)) return false;
  const path = pathOf(address);
  const anchored = row.at.startsWith("^");
  const pattern = anchored ? row.at.slice(1) : row.at;
  // An exact row also matches at any `.` boundary suffix unless anchored.
  if (!pattern.endsWith("**")) return path === pattern || (!anchored && path.endsWith(`.${pattern}`));
  const prefix = pattern.slice(0, -2);
  if (path.startsWith(prefix)) return true;
  if (anchored) return false;
  for (let from = path.indexOf(prefix); from !== -1; from = path.indexOf(prefix, from + 1)) {
    if (path[from - 1] === ".") return true;
  }
  return false;
}

/** The census in both directions: `unmatched` (an open address no row covers) and `stale` (a row
    whose group no longer exists). First match wins in table order; `matched` gives each row's live
    count. */
export function censusVerdict(
  open: readonly ProbeResult[],
  rows: readonly ExemptionRow[]
): {
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
  const stale = rows
    .filter((row) => (matched.get(row) ?? 0) === 0)
    .map((row) => `${row.types === "*" ? "*" : row.types.join("|")}.${row.at} (${row.status})`);
  return { unmatched: unmatched.sort(), stale, matched };
}

/** The seven types that mount the action rider surface (spell and spell-list do not). */
const ACTION_CARRIERS: readonly HomebrewBodyType[] = [
  "background",
  "class",
  "equipment",
  "feat",
  "monster",
  "species",
  "subclass"
];
/** The six that mount effects/feature riders (every action carrier except the statblock). */
const FEATURE_CARRIERS: readonly HomebrewBodyType[] = [
  "background",
  "class",
  "equipment",
  "feat",
  "species",
  "subclass"
];

/** The save-block keys that say how a failure's conditions end (`SaveOutcomeFields`). */
const SAVE_LIFETIME_KEYS = [
  "failureDuration.**",
  "repeatSave",
  "escapeDc",
  "endsOnDamage",
  "speedZero",
  "rangeFeet",
  "failsAtHitPoints",
  "ongoingDamage.**",
  "failureHazard"
] as const;

/** The exemption table. First match wins, so specific rows sit above general ones. */
export const EXEMPTIONS: readonly ExemptionRow[] = [
  // ---- action rider surface (every carrier that mounts actions) ----
  {
    at: "actions[].onHit[].**",
    types: ACTION_CARRIERS,
    reason: "a hit that lands a condition — no rows control on the action row",
    status: "gap"
  },
  {
    at: "actions[].useCost",
    types: ACTION_CARRIERS,
    reason:
      "how many uses one activation spends (Lay on Hands' points, its 5-point cure) - authored in the class overlays; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].endsConditions",
    types: ACTION_CARRIERS,
    reason:
      "conditions an action ends on its target (Lay on Hands' cure) - authored in the class overlays; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].legendary.cost",
    types: ACTION_CARRIERS,
    reason: "the per-round pool cost — the record has actionsPerRound, the action has no cost",
    status: "gap"
  },
  {
    at: "actions[].legendary.oncePerRound",
    types: ACTION_CARRIERS,
    reason:
      "a legendary action that can't be taken again until the creature's next turn - read from stat-block prose; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].damageByLevel[].**",
    types: FEATURE_CARRIERS,
    reason:
      "damage that grows with level — feature-carrier actions only (a statblock ActionSchema has no such key, which is why monster is absent)",
    status: "gap"
  },
  {
    at: "actions[].multiattackByLevel[].**",
    types: FEATURE_CARRIERS,
    reason:
      "a compound plan that grows with level (Flurry of Blows' third strike) - feature-carrier actions only, and multiattack itself has no control yet either",
    status: "gap"
  },
  {
    at: "actions[].attack.count",
    types: ACTION_CARRIERS,
    reason:
      "attack keys the action rows do not enumerate — surfaced when the bare-group false credit was removed (this batch's adversarial review)",
    status: "gap"
  },
  {
    at: "actions[].attack.criticalBonusDice",
    types: ACTION_CARRIERS,
    reason:
      "attack keys the action rows do not enumerate — surfaced when the bare-group false credit was removed (this batch's adversarial review)",
    status: "gap"
  },
  {
    at: "actions[].attack.proficient",
    types: FEATURE_CARRIERS,
    reason:
      "the feature attack shape's proficiency flag — no row enumerates it (the statblock shape does not carry it)",
    status: "gap"
  },
  {
    at: "actions[].save.dc.**",
    types: FEATURE_CARRIERS,
    reason:
      "the feature save's DERIVED dc object (ability/base/proficiencyBonus) — the rows author the statblock's flat number only",
    status: "gap"
  },
  ...SAVE_LIFETIME_KEYS.map((key): ExemptionRow => ({
    at: `actions[].save.${key}`,
    types: ACTION_CARRIERS,
    reason:
      "how a failed save's conditions end (duration, repeated save, grapple escape and range, ending on damage, Speed 0, an HP gate) - read from SRD prose or authored in the class and item overlays; no editor control yet",
    status: "gap"
  })),
  ...SAVE_LIFETIME_KEYS.map((key): ExemptionRow => ({
    at: `save.${key}`,
    types: ["spell"],
    reason: "how a failed save's conditions end, read from the spell's description as the catalog is built",
    status: "gap"
  })),
  {
    at: "actions[].grants.**",
    types: ACTION_CARRIERS,
    reason: "an action that grants itself an effect, the whole EffectGrant subtree included",
    status: "gap"
  },
  {
    at: "actions[].multiattack[].**",
    types: ACTION_CARRIERS,
    reason: "177 SRD authors; owned outside this program (census row in vocabulary-parity.mirror.test.ts)",
    status: "gap"
  },
  {
    at: "actions[].multiattackAlternatives",
    types: ACTION_CARRIERS,
    reason:
      'a Multiattack\'s other plan ("or it makes two Hurl Flame attacks") - read from stat-block prose like the plan',
    status: "gap"
  },
  {
    at: "actions[].multiattackReplacements[].**",
    types: ACTION_CARRIERS,
    reason:
      'an action a Multiattack lets replace one of its attacks ("it can replace one attack with a use of Roar") - read from stat-block prose like the plan',
    status: "gap"
  },
  {
    at: "actions[].reaction.**",
    types: ACTION_CARRIERS,
    reason:
      "authored in the class overlays, spell effects and stat-block prose (Uncanny Dodge, Shield, Parry); no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].extraAttack.**",
    types: ACTION_CARRIERS,
    reason: "minted by the engine beside an equipped weapon (Light, Cleave), never authored",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].spellId",
    types: ACTION_CARRIERS,
    reason: "synthesised by the character build, zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].damageTypes",
    types: ACTION_CARRIERS,
    reason: "synthesised from a spell's cast model by the character build (Chromatic Orb), zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].save.ignoresCover",
    types: ACTION_CARRIERS,
    reason: "one SRD author (Sacred Flame), copied from the spell by the character build; no editor control yet",
    status: "gap"
  },
  {
    at: "save.ignoresCover",
    types: ["spell"],
    reason: "one SRD author (Sacred Flame), a reviewed override in the content build; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].save.failureEffect.**",
    types: ACTION_CARRIERS,
    reason: "synthesised from a spell's cast model by the character build (Bane, Faerie Fire), zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].darts",
    types: ACTION_CARRIERS,
    reason: "synthesised from a spell's cast model by the character build (Magic Missile), zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].area.**",
    types: ACTION_CARRIERS,
    reason: "read from the action's description as the catalog is built; the editor writes the description",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].untrackedMultiattack",
    types: ACTION_CARRIERS,
    reason: "marked as the catalog is built, on a Multiattack whose attacks nothing structured names",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].healing.**",
    types: ACTION_CARRIERS,
    reason: "hit points an action restores - no control on the action row yet",
    status: "gap"
  },
  {
    at: "actions[].conditionalDamage[].**",
    types: ACTION_CARRIERS,
    reason:
      "a stat block's damage under a printed condition (Bloodied swarms, a charge), read from the hit clause as the catalog is built; no control on the action row yet",
    status: "gap"
  },
  {
    at: "actions[].reminder",
    types: ACTION_CARRIERS,
    reason: "what the engine leaves to the GM, read from a save's later-turn damage as the catalog is built",
    status: "gap"
  },
  {
    at: "actions[].healingByLevel[].**",
    types: FEATURE_CARRIERS,
    reason: "healing that grows with level - feature-carrier actions only, beside damageByLevel",
    status: "gap"
  },
  {
    at: "actions[].adds.**",
    types: FEATURE_CARRIERS,
    reason:
      "a level multiple or ability modifier added at build (Second Wind, Divine Spark) - feature-carrier actions only",
    status: "gap"
  },
  {
    at: "actions[].grantScaling.**",
    types: FEATURE_CARRIERS,
    reason:
      "a granted damage bonus read off a printed class column at build (Rage Damage) - feature-carrier actions only",
    status: "gap"
  },
  {
    at: "effect.**",
    types: ["spell"],
    reason: "the cast model, read from the attack box, damage roll and description as the catalog is built",
    status: "permanent: system-synthesised"
  },
  {
    at: "area.**",
    types: ["spell"],
    reason: "read from the spell's description as the catalog is built; the editor writes the description",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].spellSlot.level",
    types: ACTION_CARRIERS,
    reason: "synthesised from an item's consumesSpellSlot during equipment derivation, zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].requiresEffectTag",
    types: ACTION_CARRIERS,
    reason: "zero SRD authors; action resolution reads it, and the effect editor authors the tag it checks",
    status: "permanent: zero SRD authors"
  },
  {
    at: "actions[].targetRules",
    types: ACTION_CARRIERS,
    reason: "one SRD author (a lone record)",
    status: "permanent: lone SRD record"
  },

  // ---- effect rider surface ----
  {
    at: "effects[].onEnd[].**",
    types: FEATURE_CARRIERS,
    reason: "what happens when an effect ends — no program unit authors it",
    status: "gap"
  },
  {
    at: "effects[].endsWithTag",
    types: FEATURE_CARRIERS,
    reason: "effect linkage vocabulary with no control — no program unit authors it",
    status: "gap"
  },
  {
    at: "effects[].target",
    types: FEATURE_CARRIERS,
    reason: "effect linkage vocabulary with no control — no program unit authors it",
    status: "gap"
  },
  {
    at: "effects[].voidWhileIncapacitated",
    types: FEATURE_CARRIERS,
    reason: "effect linkage vocabulary with no control — no program unit authors it",
    status: "gap"
  },
  {
    at: "effects[].damageUses",
    types: FEATURE_CARRIERS,
    reason:
      "how many hits an effect's damage riders last (a coat of poison); authored in the item overlay, no control yet",
    status: "gap"
  },
  {
    at: "modifiers[].**",
    types: FEATURE_CARRIERS,
    reason:
      "the modifier rows beyond the editor's offered subset — a type the form does not offer has no field for its keys",
    status: "gap"
  },

  // ---- feature-scope machinery shared by the feature carriers ----
  {
    at: "choice.options[].**",
    types: "*",
    reason:
      "an option's own payload (nested choice, grants, uses, extraPicks) — the choice panel authors one level and no deeper",
    status: "gap"
  },
  {
    at: "choices[].**",
    types: "*",
    reason: "the plural choices list — the panel writes the singular choice; the list shape has no control at all",
    status: "gap"
  },
  {
    at: "choice.**",
    types: "*",
    reason: "the parts of a feature's choice beyond the panel's fields",
    status: "gap"
  },
  // GrantsEditor territory, spelled per mount: a bare `grants.**` would also match under
  // `actions[].grants.` and absorb that group.
  {
    at: "grants.spells[].**",
    types: "*",
    reason:
      "GrantsEditor writes the spells array whole (grantsFromRows, U9); the per-row keys have no FieldDef the probe can see",
    status: "gap"
  },
  {
    at: "features[].grants.**",
    types: "*",
    reason:
      "bespoke GrantsEditor JSX with no FieldDef — authored today through grantsFromRows and driven in pick-fields.test.tsx, invisible to the probe",
    status: "gap"
  },
  {
    at: "traits[].grants.**",
    types: "*",
    reason:
      "bespoke GrantsEditor JSX with no FieldDef — authored today through grantsFromRows and driven in pick-fields.test.tsx, invisible to the probe",
    status: "gap"
  },
  {
    at: "^feature.grants.**",
    types: ["feat"],
    reason:
      "bespoke GrantsEditor JSX at the feat's singular-feature scope — open now that the bare-group credit is gone",
    status: "gap"
  },
  {
    at: "^grants.**",
    types: "*",
    reason: "bespoke GrantsEditor JSX at record scope — same probe-blind mount",
    status: "gap"
  },
  {
    at: "uses.scaling.table[].**",
    types: "*",
    reason:
      "the by-level table at the three mounts the canonicaliser cannot reach — lineage depth, the feat's dotted singular feature, a cast's row scope (instrumented: exactly those six). The plain feature mounts author the table and probe covered",
    status: "gap"
  },
  {
    at: "casts[].uses.scaling.**",
    types: ["equipment"],
    reason: "an item cast's scaling — zero SRD authors until the magic-item bundle lands",
    status: "gap"
  },
  {
    at: "extraPicks[].**",
    types: "*",
    reason: "extra-pick rows beyond what the resolver reads — no rows control at feature scope",
    status: "gap"
  },
  {
    at: "replaces[].**",
    types: "*",
    reason:
      "the replacement clause's rows — written whole by the replacement control, per-key fields invisible to the probe",
    status: "gap"
  },
  {
    at: "replacesFeatureId",
    types: ["species"],
    reason: "supersession at species-trait scope — the control exists on class features, not here",
    status: "gap"
  },
  {
    at: "extraSpellLists",
    types: "*",
    reason:
      "spell lists a feature adds to the class's own picks (Magical Secrets) — no list control at feature scope yet",
    status: "gap"
  },

  // ---- record-scope gaps, per type ----
  {
    at: "^lineages[].**",
    types: ["species"],
    reason: "a lineage's own traits — today a lineage row is name + description only",
    status: "gap"
  },
  {
    at: "languageChoices.**",
    types: ["species"],
    reason: "9 of 9 SRD species author languageChoices — the builder's language offer has no authoring end",
    status: "gap"
  },
  {
    at: "languageChoices.**",
    types: ["background"],
    reason: "zero SRD backgrounds author it",
    status: "permanent: zero SRD authors"
  },
  {
    at: "^languages",
    types: ["background"],
    reason: "zero SRD backgrounds author it",
    status: "permanent: zero SRD authors"
  },
  {
    at: "skillChoices.**",
    types: ["background"],
    reason: "zero SRD backgrounds author it",
    status: "permanent: zero SRD authors"
  },
  {
    at: "toolChoices.**",
    types: ["background"],
    reason: "one SRD background authors it (a lone record)",
    status: "permanent: lone SRD record"
  },
  {
    at: "abilityBonusChoice.**",
    types: ["species"],
    reason: "zero SRD species author it",
    status: "permanent: zero SRD authors"
  },
  {
    at: "skillChoices.fromCatalog",
    types: ["class"],
    reason:
      "zero of 12 SRD classes author it — every class uses the from list, which has a control (\u00a74); the group's rows never offered it",
    status: "permanent: zero SRD authors"
  },
  {
    at: "toolChoices.fromCatalog",
    types: ["class"],
    reason: "zero of 12 SRD classes author it (\u00a74); the group's rows never offered it",
    status: "permanent: zero SRD authors"
  },
  {
    at: "multiclassProficiencies.**",
    types: ["class"],
    reason:
      "the builder grants these to a class taken after the first, but its skill and instrument picks (a Bard's, Ranger's or Rogue's) have no control",
    status: "gap"
  },
  {
    at: "multiclassPrerequisites.**",
    types: ["class"],
    reason:
      "the builder checks these minimums when a class is taken, but no control authors the mode or the minimums list the rows sit in",
    status: "gap"
  },
  {
    at: "levelTable[].classResources[].**",
    types: ["class", "subclass"],
    reason:
      "the resource rows LevelTableEditor writes without FieldDefs; real fields would also add the missing id/display pair",
    status: "gap"
  },
  {
    at: "levelTable[].**",
    types: ["class", "subclass"],
    reason:
      "bespoke LevelTableEditor JSX with no FieldDef — authored today, invisible to the probe until it uses FieldDefs",
    status: "gap"
  },
  {
    at: "^uses.scaling.id",
    types: ["equipment"],
    reason:
      "the class-resource id at ITEM scope — the dedicated field exists on feature mounts only; the item's uses rows omit it",
    status: "gap"
  },
  {
    at: "prerequisite.**",
    types: ["feat"],
    reason:
      "feat prerequisites have no controls — the ability-score rows, the requires slug and the printed text alike",
    status: "gap"
  },
  {
    at: "castingOptions[].**",
    types: ["spell"],
    reason: "a spell's casting options — the spell form has no rows control for them",
    status: "gap"
  },
  {
    at: "^add",
    types: ["spell-list"],
    reason: "written whole by the bespoke SpellListContents editor — no FieldDef the probe can see",
    status: "permanent: bespoke editor, probe-blind"
  },
  {
    at: "^remove",
    types: ["spell-list"],
    reason: "written whole by the bespoke SpellListContents editor — no FieldDef the probe can see",
    status: "permanent: bespoke editor, probe-blind"
  },

  // ---- the monster stat block's shared-schema tail ----
  {
    at: "^extensions",
    types: ["monster"],
    reason: "the opaque bag itself — the census's structural blind spot, since the walk cannot see its keys",
    status: "gap"
  },
  {
    at: "proficiencies.**",
    types: ["monster"],
    reason: "0 of 330 SRD monsters author it, and a control would change which rung saves resolve on",
    status: "permanent: zero SRD authors"
  },
  {
    at: "spellcasting.**",
    types: ["monster"],
    reason: "a built-character field on the shared ActorDefinition — 0 of 330 SRD monster rows author it",
    status: "permanent: built-character field"
  },
  {
    at: "character.**",
    types: ["monster"],
    reason: "a built-character field on the shared ActorDefinition — 0 of 330 SRD monster rows author it",
    status: "permanent: built-character field"
  },
  {
    at: "startingInventory[].**",
    types: ["monster"],
    reason: "a built-character field on the shared ActorDefinition — 0 of 330 SRD monster rows author it",
    status: "permanent: built-character field"
  },
  {
    at: "startingCurrency.**",
    types: ["monster"],
    reason: "a built-character field on the shared ActorDefinition — 0 of 330 SRD monster rows author it",
    status: "permanent: built-character field"
  }
];

/* ============================================================ the round-trip compare ==== */

/** Strips the keys `normalizeBody` (`homebrew-store.ts`) forces after a POST from a body before the
    deep-equal: `type`, `id`, and a monster's `source.externalId`. */
export function comparableBody(type: HomebrewBodyType, body: Record<string, unknown>): Record<string, unknown> {
  const { type: _type, id: _id, ...rest } = body;
  if (type === "monster" && rest.source && typeof rest.source === "object") {
    const { externalId: _externalId, ...source } = rest.source as Record<string, unknown>;
    return { ...rest, source };
  }
  return rest;
}

/** The first path at which two bodies differ, or null when deep-equal. Arrays compare by index,
    objects by the sorted union of their keys. */
export function firstDifference(
  api: unknown,
  editor: unknown,
  path = ""
): { path: string; api: unknown; editor: unknown } | null {
  if (Object.is(api, editor)) return null;
  const bothArrays = Array.isArray(api) && Array.isArray(editor);
  const bothObjects =
    !bothArrays && typeof api === "object" && typeof editor === "object" && api !== null && editor !== null;
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

/** Keys the system stamps and no GM authors, subtracted structurally rather than as exemption rows. */
export const SYSTEM_FORCED = Object.freeze({
  /** Record identity and provenance, forced by `normalizeBody` or the row. */
  recordKeys: [
    "id",
    "type",
    "schemaId",
    "schemaVersion",
    // The feat's singular feature is a record-scope object, so its id is a row-id stamp.
    "feature.id"
  ] as readonly string[],
  /** The provenance bag (`source.externalId` is forced to the row id). */
  recordPrefixes: ["source."] as readonly string[],
  reason: "system-forced: stamped by the store, the row, or a rows editor's newRow — never authored by hand"
});

export const isSystemForced = (address: ParityAddress): boolean => {
  if (address.within.length === 0) {
    return (
      SYSTEM_FORCED.recordKeys.includes(address.key) ||
      SYSTEM_FORCED.recordPrefixes.some(
        (prefix) => address.key === prefix.slice(0, -1) || address.key.startsWith(prefix)
      )
    );
  }
  // A row's own `id` is minted by `newRow` (and backfilled by `bodyForPublish`).
  return address.key === "id";
};

/* ================================================================= the API fixture ==== */

/** The real homebrew router over the real store, publish gate included. Callers own `close()`; boot
    once per test file, since `ContentLibrary` loads the full SRD bundle. */
export type ApiFixture = Readonly<{ base: string; store: HomebrewStore; close: () => Promise<void> }>;

export async function bootHomebrewApi(): Promise<ApiFixture> {
  const directory = mkdtempSync(join(tmpdir(), "vtt-api-parity-"));
  const store = new HomebrewStore(join(directory, "vtt.sqlite"), () => Date.parse("2026-08-11T03:00:00.000Z"));
  await store.initialize();
  const contentLibrary = new ContentLibrary(store);
  const app = express();
  app.use(HOMEBREW_PACK_IMPORT_PATH, homebrewPackBodyParser());
  app.use(express.json({ limit: "512kb" }));
  app.use(
    createHomebrewRouter({
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
    })
  );
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
