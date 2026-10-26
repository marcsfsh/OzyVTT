/**
 * Machinery for the API-to-editor parity guard (`api-parity.mirror.test.ts`): walks the
 * `HOMEBREW_BODY_SCHEMAS` into editor-addressable keys, asks the real form (`hasControl`) whether a
 * GM can author each, and checks the uncovered set against a reasoned exemption table in both
 * directions. Vitest-free, like `authoring-harness.ts`.
 *
 * The walk sees keys and no values (a missing enum option is invisible here; the round trip in the
 * test catches that). A `z.record(...)` is opaque, so nothing inside
 * `ActorDefinitionSchema.extensions` is addressed.
 *
 * Every canonicalising rewrite is validated: a rider restart whose container `fieldsWithin` cannot
 * resolve throws, so the uncovered set never widens silently.
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
  throw new Error("Schema wrapper nesting exceeded 32 levels: a cycle, and no schema.");
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
          // Scalars, enums, records (opaque bags: the structural blind spot), tuples.
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
    writer leaves the address open, and never falsely covered. */
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

/** The path half of an addressId: what `ExemptionRow.at` is matched against. */
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
  "endsOnSourceSideDamage",
  "speedZero",
  "rangeFeet",
  "failsAtHitPoints",
  "ongoingDamage.**",
  "failureHazard",
  "failurePush.**",
  "successPush.**",
  "successMovesOut.**",
  "advantageAtSize",
  "escapeAthletics",
  "repeatOnce",
  "repeatAtTurnStart",
  "repeatOnDamage.**",
  "repeatByAction",
  "repeatFailureDamage[].**",
  "repeatTally",
  "secondFailure.**",
  "failureExhaustion",
  "advantageIfFighting",
  "immuneOnSuccess",
  "endsWhenSourceDies",
  "endsWhenSourceIncapacitated",
  "onlyCreatureTypes",
  "sparesAffected",
  "failureKills.**",
  "failureMaxSize",
  "repeatDamageAgain",
  "repeatUnseenSource",
  "repeatBeyondFeet",
  "endsOutOfSight",
  "autoSuccess.**",
  "endedBy.**",
  "atRest.**",
  "successEndsSpell"
] as const;

/** The save-block keys that make a failure act by the target's Hit Points or send it home (`SaveOutcomeFields`). */
const DEATH_SAVE_KEYS = ["failureByHitPoints[].**", "failureBanishes"] as const;
/** The save-block keys for a failure by a margin and the creatures a failure spares (`SaveOutcomeFields`). */
const MARGIN_SAVE_KEYS = ["failureByMargin.**", "sparesCreatureTypes", "sparesSpecies"] as const;

/** The exemption table. First match wins, so specific rows sit above general ones. */
export const EXEMPTIONS: readonly ExemptionRow[] = [
  // ---- action rider surface (every carrier that mounts actions) ----
  {
    at: "actions[].onHit[].**",
    types: ACTION_CARRIERS,
    reason: "a hit that lands a condition: no rows control on the action row",
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
    at: "actions[].castThrough",
    types: ACTION_CARRIERS,
    reason:
      "a cast made through a spell its user concentrates on (a Crystal Ball's Detect Thoughts through Scrying) - synthesised from an item cast's `through`; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].castCheck.**",
    types: ACTION_CARRIERS,
    reason:
      "a check made before a use (an Amulet of the Planes' DC 15 Intelligence (Arcana)) - synthesised from an item cast's `check`; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].alsoUses.**",
    types: ACTION_CARRIERS,
    reason:
      "a second limit each use counts against, restored by a Long Rest (a Luck Blade's Wish once a dawn) - synthesised from an item cast's `alsoUses`; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].timePool",
    types: ACTION_CARRIERS,
    reason:
      "uses that are time, a use spending all that is left (Boots of Speed's rounds, a Goat of Traveling's hours) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].conditionPicks.**",
    types: ACTION_CARRIERS,
    reason:
      "conditions a chosen-cost action also ends for points of its pool (Restoring Touch) - authored in the class overlays with `useCost`; no editor control yet",
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
    at: "actions[].endsOneCondition",
    types: ACTION_CARRIERS,
    reason:
      "a cure that ends the one condition its user picks (Lesser Restoration) - copied from the spell by the character build; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].onHitPush.**",
    types: ACTION_CARRIERS,
    reason:
      "how far a hit pushes (a fire giant's Hammer Throw) - read from the action's description as the catalog is built; the editor writes the description",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].burst.**",
    types: ACTION_CARRIERS,
    reason:
      "what bursts after an attack (Ice Knife) - copied from the spell's cast model by the character build, zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].move.**",
    types: ACTION_CARRIERS,
    reason:
      "the move an action makes its creature take (a dragon's Pounce, a troll's Charge) - read from the action's description as it is saved; the editor writes the description",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].teleport.**",
    types: ACTION_CARRIERS,
    reason:
      "the teleport an action makes its creature take (a blink dog's 40 feet) - read from the action's description as it is saved; the editor writes the description",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].leap.**",
    types: ACTION_CARRIERS,
    reason:
      "the jump an action allows (a bulette's Leap) - read from the action's description as it is saved; the editor writes the description",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].destination.**",
    types: ACTION_CARRIERS,
    reason:
      "the space an action sets its user or its target down in (a bulette's Deadly Leap, a kraken's Fling) - authored in the catalog; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].needsObject",
    types: ACTION_CARRIERS,
    reason:
      "the carried object an action needs whole (a night hag's soul bag, an erinyes's rope) - authored in the catalog; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].castRiders.**",
    types: ACTION_CARRIERS,
    reason:
      "what a monster's spell holds to beyond the spell (a night hag's Dream from the Border Ethereal, wasted on a warded target) - authored in the catalog; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].zone.**",
    types: ACTION_CARRIERS,
    reason:
      "the area an action leaves on the map to act later (spread Caltrops, a set Hunting Trap) - authored in the catalog; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].summons.**",
    types: ACTION_CARRIERS,
    reason:
      "the creatures an action brings onto the map and how they are commanded (a Horn of Valhalla's Berserkers, a treant's trees) - authored in the catalog; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].holds.**",
    types: ACTION_CARRIERS,
    reason:
      "the creatures an action traps off the map inside its item, and how many at once (an Iron Flask) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].releases.**",
    types: ACTION_CARRIERS,
    reason:
      "the trapped creature an action lets out beside its user, and the minutes it obeys (an Iron Flask) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].douses.**",
    types: ACTION_CARRIERS,
    reason:
      "the flames an action puts out around its user (Frost Brand) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].adjustsLight.**",
    types: ACTION_CARRIERS,
    reason:
      "the steps an action turns its own light up or down by (a Sun Blade) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].doorWork.**",
    types: ACTION_CARRIERS,
    reason:
      "what an action does to the door it is aimed at (an Immovable Rod, Sovereign Glue, Universal Solvent, a Ring of the Ram) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].pointsAtHidden.**",
    types: ACTION_CARRIERS,
    reason:
      "how far an action points its user at a secret door or hidden trap (a Wand of Secrets) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].lightsArea.**",
    types: ACTION_CARRIERS,
    reason:
      "the spilled oil an action lights round its user (a Tinderbox) - authored in the equipment table; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].raisesTower.**",
    types: ACTION_CARRIERS,
    reason:
      "the tower an action raises on its placed square, with its walls' print (an Instant Fortress) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].dismissesTower",
    types: ACTION_CARRIERS,
    reason:
      "an action that shrinks its user's tower again (an Instant Fortress) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].objectDamage[].**",
    types: ACTION_CARRIERS,
    reason:
      "the damage the objects under an action's area take (a Thunderous Greatclub's Clap of Thunder and Earthquake) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].concentrationSave.**",
    types: ACTION_CARRIERS,
    reason:
      "the save a concentrating creature in an action's area also makes (a Thunderous Greatclub's Earthquake) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].grounded",
    types: ACTION_CARRIERS,
    reason:
      "an area that spares the creatures off the ground (a Thunderous Greatclub's Earthquake) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].castsAtOnce",
    types: ACTION_CARRIERS,
    reason:
      "a cast a feature makes a Magic action whatever the spell's casting time (Pact of the Chain's Find Familiar) - set by the builder from the feature's grant",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].waives",
    types: ACTION_CARRIERS,
    reason:
      "the spell components a feature's cast goes without (Wild Companion's Find Familiar) - set by the builder from the feature's grant",
    status: "permanent: system-synthesised"
  },
  {
    at: "summonScaling.**",
    types: ["monster"],
    reason:
      "how a stat block a spell prints scales with the spell's level and its summoner (a Draconic Spirit) - authored with the spell-printed stat blocks; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].drain.**",
    types: ACTION_CARRIERS,
    reason:
      "what an action's damage drains (a Life Drain) - read from the action's description as the catalog is built, or copied from a spell's cast model; the editor writes the description",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].legendary.cost",
    types: ACTION_CARRIERS,
    reason: "the per-round pool cost: the record has actionsPerRound, the action has no cost",
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
      "damage that grows with level: feature-carrier actions only (a statblock ActionSchema has no such key, which is why monster is absent)",
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
      "attack keys the action rows do not enumerate: surfaced when the bare-group false credit was removed (this batch's adversarial review)",
    status: "gap"
  },
  {
    at: "actions[].attack.countWithItself",
    types: ACTION_CARRIERS,
    reason:
      "a weapon's extra attacks made with itself alone (Thirsting Blade's pact weapon) - set by the server on the bonded weapon's swing",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].attack.criticalBonusDice",
    types: ACTION_CARRIERS,
    reason:
      "attack keys the action rows do not enumerate: surfaced when the bare-group false credit was removed (this batch's adversarial review)",
    status: "gap"
  },
  {
    at: "actions[].attack.bonus",
    types: FEATURE_CARRIERS,
    reason:
      "a printed to-hit that stands in for the derived one (a Ring of the Ram's +7) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].attack.proficient",
    types: FEATURE_CARRIERS,
    reason: "the feature attack shape's proficiency flag: no row enumerates it (the statblock shape does not carry it)",
    status: "gap"
  },
  {
    at: "actions[].save.dc.**",
    types: FEATURE_CARRIERS,
    reason:
      "the feature save's DERIVED dc object (ability/base/proficiencyBonus): the rows author the statblock's flat number only",
    status: "gap"
  },
  ...SAVE_LIFETIME_KEYS.map((key): ExemptionRow => ({
    at: `actions[].save.${key}`,
    types: ACTION_CARRIERS,
    reason:
      "how a failed save's conditions end (duration, repeated save, grapple escape and range, ending on damage, Speed 0, an HP gate), where it pushes and who has Advantage on it - read from SRD prose or authored in the class and item overlays; no editor control yet",
    status: "gap"
  })),
  ...SAVE_LIFETIME_KEYS.map((key): ExemptionRow => ({
    at: `save.${key}`,
    types: ["spell"],
    reason:
      "how a failed save's conditions end, where it pushes and who has Advantage on it, read from the spell's description as the catalog is built",
    status: "gap"
  })),
  ...DEATH_SAVE_KEYS.map((key): ExemptionRow => ({
    at: `actions[].save.${key}`,
    types: ACTION_CARRIERS,
    reason:
      "what a failed save does by the target's Hit Points (a Slaying Bow's death, a Death Glare's drop to 0) and the creature types it sends home - authored in the content scripts; no editor control yet",
    status: "gap"
  })),
  ...DEATH_SAVE_KEYS.map((key): ExemptionRow => ({
    at: `save.${key}`,
    types: ["spell"],
    reason:
      "what a failed save does by the target's Hit Points and the creature types it sends home (Divine Word) - authored in the content scripts",
    status: "gap"
  })),
  ...MARGIN_SAVE_KEYS.map((key): ExemptionRow => ({
    at: `actions[].save.${key}`,
    types: ACTION_CARRIERS,
    reason:
      "what a failure by 5 or more does instead (a homunculus's Bite) and the creatures a failure spares by type or species (a ghoul's Claw: an Undead or an elf) - read from the stat block's text; no editor control yet",
    status: "gap"
  })),
  ...MARGIN_SAVE_KEYS.map((key): ExemptionRow => ({
    at: `save.${key}`,
    types: ["spell"],
    reason:
      "what a failure by a margin does and the creatures a failure spares, read from the spell's description as the catalog is built",
    status: "gap"
  })),
  {
    at: "actions[].underwaterOnly",
    types: ACTION_CARRIERS,
    reason:
      "an action usable only in an underwater fight (a seahorse's Bubble Dash), read from the action's description as the catalog is built",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].object.**",
    types: ACTION_CARRIERS,
    reason:
      "the target's armor or weapon a failed save corrodes (a rust monster's Antennae), authored in the stat-block enrichments; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].checkFirst.**",
    types: ACTION_CARRIERS,
    reason:
      "the check its user makes before the action lands (binding with a Chain or Manacles) - authored in the gear and item overlays; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].endsItemEffects",
    types: ACTION_CARRIERS,
    reason:
      "a command that releases what the item's other actions hold (Iron Bands, a Rope of Entanglement) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].rebindsRow.**",
    types: ACTION_CARRIERS,
    reason:
      "remaking a carried weapon or stack of ammunition as a magic one (Oil of Sharpness) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].damage[].pick",
    types: ACTION_CARRIERS,
    reason:
      "a damage part whose type is the one picked for the creature (a half-dragon's Claw and its Draconic Origin), read from the stat block's text; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].save.heldBy.**",
    types: ACTION_CARRIERS,
    reason:
      "the object that holds a creature a failure restrains (a Net, a giant spider's web) with its Armor Class and Hit Points - read from the stat block's text or authored in the gear and item overlays; no editor control yet",
    status: "gap"
  },
  {
    at: "save.heldBy.**",
    types: ["spell"],
    reason:
      "the object that holds a creature a spell's failure restrains, read from the spell's text as the catalog is built; no editor control yet",
    status: "gap"
  },
  {
    at: "walls.**",
    types: ["spell"],
    reason:
      "the walls a spell raises, cuts or destroys and what it does to a door (Wall of Force, Knock) - a reviewed table in the content build; the spell form has no control for them",
    status: "gap"
  },
  {
    at: "actions[].raisesCorpse.**",
    types: ACTION_CARRIERS,
    reason:
      "a corpse an action raises as a new creature (a wraith's Create Specter): the stat block, how long dead and how many at once - authored in the content scripts; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].save.breaksConcentration",
    types: ACTION_CARRIERS,
    reason:
      "a failed save that also breaks the creature's Concentration (Earthquake, Sleet Storm) - authored with the spell's save outcomes; no editor control yet",
    status: "gap"
  },
  {
    at: "save.breaksConcentration",
    types: ["spell"],
    reason:
      "a failed save that also breaks the creature's Concentration (Earthquake, Sleet Storm), authored with the save outcomes as the catalog is built",
    status: "gap"
  },
  {
    at: "actions[].save.bySelf",
    types: ACTION_CARRIERS,
    reason:
      "a save the user makes against its own action (Contact Other Plane's DC 15 Intelligence save) - copied from the spell's cast model; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].dispel.**",
    types: ACTION_CARRIERS,
    reason:
      "an action that ends spells on its target (Dispel Magic), copied from the spell's cast model; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].endsCurses",
    types: ACTION_CARRIERS,
    reason:
      "an action that ends curses on its target (Remove Curse), copied from the spell's cast model; no editor control yet",
    status: "gap"
  },
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
    at: "actions[].swallow.**",
    types: ACTION_CARRIERS,
    reason:
      "a stat block's Swallow (how many it holds, the size it swallows, its acid and its regurgitation), read from the printed action; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].pull.**",
    types: ACTION_CARRIERS,
    reason:
      "an action that pulls its targets toward its user (a roper's Reel), read from the printed action; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].inflicts.**",
    types: ACTION_CARRIERS,
    reason:
      "what an action does to its targets with no roll (a tarrasque's shock wave: Prone and lost Concentration), read from the printed action; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].afterHurtingBloodied",
    types: "*",
    reason:
      "an action offered only right after its user damages a Bloodied creature (a gnoll's Rampage), read from the printed action; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].largeFillsHold",
    types: "*",
    reason: "one SRD author (a water elemental's Whelm: one Large creature or up to two smaller ones)",
    status: "permanent: lone SRD record"
  },
  {
    at: "actions[].useNumber",
    types: "*",
    reason: "one SRD author (a sphinx of valor's three roars in their order)",
    status: "permanent: lone SRD record"
  },
  {
    at: "actions[].magical",
    types: ACTION_CARRIERS,
    reason:
      "that an action's saves are against magic (a sphinx's magical roar), read from the printed action; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].holdsAtOnce",
    types: "*",
    reason: "one SRD author (a shambling mound's Engulf, one creature at a time)",
    status: "permanent: lone SRD record"
  },
  {
    at: "actions[].multiattackAlternativesAfter",
    types: "*",
    reason: "one SRD author (a clay golem's three Slams after Hasten), read from its Multiattack's prose",
    status: "permanent: lone SRD record"
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
    at: "actions[].reactionByLevel[].**",
    types: FEATURE_CARRIERS,
    reason:
      "a reaction that changes with level (Deflect Energy) - feature-carrier actions only, beside reaction itself",
    status: "gap"
  },
  {
    at: "actions[].answer.**",
    types: ACTION_CARRIERS,
    reason:
      "what an action does to a roll after it is seen (Bardic Inspiration, Indomitable, a Luck Blade) - authored in the class overlays, item mechanics and stat-block enrichments; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].answerAmountByLevel[].**",
    types: FEATURE_CARRIERS,
    reason: "an answer's die that grows with level (the Bardic Inspiration die) - feature-carrier actions only",
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
    at: "actions[].save.successEffect.**",
    types: ACTION_CARRIERS,
    reason: "one SRD author (Stunning Strike's halved Speed), written in the class content; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].save.failureEffect.**",
    types: ACTION_CARRIERS,
    reason: "synthesised from a spell's cast model by the character build (Bane, Faerie Fire), zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].explodingDice.**",
    types: ACTION_CARRIERS,
    reason: "synthesised from a spell's cast model by the character build (Sorcerous Burst), zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].teleportOutcome",
    types: ACTION_CARRIERS,
    reason: "synthesised from a spell's cast model by the character build (Teleport), zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].identifiesItem",
    types: ACTION_CARRIERS,
    reason: "synthesised from a spell's cast model by the character build (Identify), zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].wishUses",
    types: ACTION_CARRIERS,
    reason: "synthesised from a spell's cast model by the character build (Wish), zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].castLastsMinutes",
    types: ACTION_CARRIERS,
    reason:
      "how long an item cast lasts in place of the spell's duration (Oil of Slipperiness' Grease) - synthesised from an item cast's `lastsMinutes`",
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
    at: "actions[].attack.advantageWhen",
    types: ["monster"],
    reason:
      "the Advantage a stat block's attack prints for itself (against a creature it grapples, one missing Hit Points, or in the first round), read from its text as the catalog is built; no control on the action row yet",
    status: "gap"
  },
  {
    at: "actions[].castsSpells.**",
    types: ACTION_CARRIERS,
    reason:
      "the spells a stat block's action casts (a Spellcasting list, a Misty Step), read from its text as the catalog is built and made cast actions on a stat block; no editor control yet",
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
    at: "upcastDurations[].**",
    types: ["spell"],
    reason:
      "a spell's duration and Concentration by slot level, authored from its higher-level text as the catalog is built; no editor control yet",
    status: "gap"
  },
  {
    at: "area.**",
    types: ["spell"],
    reason: "read from the spell's description as the catalog is built; the editor writes the description",
    status: "permanent: system-synthesised"
  },
  {
    at: "sight.**",
    types: ["spell"],
    reason:
      "the light, darkness or fog the spell places on the map (Daylight, Fog Cloud), authored per spell as the catalog is built",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].sight.**",
    types: ACTION_CARRIERS,
    reason:
      "the light, darkness or fog an action places (a darkmantle's Darkness Aura) - copied from the spell by the character build or authored in the catalog; no editor control yet",
    status: "gap"
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
  {
    at: "actions[].ridesHit.**",
    types: "*",
    reason:
      "what an action adds to a hit (Sneak Attack's Cunning Strikes, Brutal Strike, a staff's charges): the hits it rides, its cost, its save and the effects picked with it - authored in the class and item overlays; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].targets.**",
    types: "*",
    reason:
      "who an action that isn't a spell may target (how many, how far, which creatures) - authored in the overlays or read from a stat block's save text as the catalog is built; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].shapeShift.**",
    types: "*",
    reason:
      "how an action shape-shifts a creature (Wild Shape's known forms, Polymorph's Beast, a werewolf's printed forms) - authored in the class, spell and stat block content; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].endsForm",
    types: "*",
    reason: "the action that leaves a form early, added by the form itself as it is taken; zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].partOf",
    types: "*",
    reason:
      "the printed entry a cast belongs to (a Spellcasting list's spell), set as the catalog makes a stat block's casts; zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].endsUntilItActs",
    types: "*",
    reason: "one SRD author (a will-o'-wisp's Consume Life, which ends its Vanish)",
    status: "permanent: lone SRD record"
  },
  {
    at: "actions[].formOnly",
    types: "*",
    reason:
      "the printed forms an action works in (a werewolf's Bite), read from the stat block as the catalog is built; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].effectOptions[].**",
    types: "*",
    reason:
      "the effects a use picks one of (Enlarge or Reduce), copied from the spell's cast model by the character build; zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].save.failureEndsForm",
    types: "*",
    reason:
      "a failed save that returns a shape-shifted creature to its true form (Moonbeam), copied from the spell by the character build; no editor control yet",
    status: "gap"
  },
  {
    at: "save.failureEndsForm",
    types: ["spell"],
    reason: "one SRD author (Moonbeam), a reviewed override in the content build; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].save.disadvantageTypes",
    types: "*",
    reason:
      "the creature types that have Disadvantage on a save (Shatter's Constructs), copied from the spell by the character build; no editor control yet",
    status: "gap"
  },
  {
    at: "save.disadvantageTypes",
    types: ["spell"],
    reason: "one SRD author (Shatter), a reviewed override in the content build; no editor control yet",
    status: "gap"
  },
  {
    at: "actions[].save.unwillingOnly",
    types: "*",
    reason:
      "a save only an unwilling target makes (Enlarge/Reduce, True Polymorph), copied from the spell by the character build; zero hand authors",
    status: "permanent: system-synthesised"
  },
  {
    at: "actions[].spendsNoUses",
    types: "*",
    reason:
      "an action that spends none of its feature's uses (Quivering Palm's ending, paid when the hit set it) - authored in the class overlays; no editor control yet",
    status: "gap"
  },
  {
    at: "^onHit[].**",
    types: ["equipment"],
    reason:
      "what a magic weapon's hit does beside its damage (Giant Slayer's save, a Sword of Sharpness's rolled 20) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].targets.**",
    types: ["equipment"],
    reason:
      "who an item's cast may affect beside the spell's own targets (a ring's Fear on Beasts only) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].area.**",
    types: ["equipment"],
    reason:
      "the area an item's cast covers in place of the spell's own (Cloak of Arachnida's doubled Web) - authored in the item overlay; no editor control yet",
    status: "gap"
  },

  // ---- effect rider surface ----
  {
    at: "effects[].onEnd[].**",
    types: FEATURE_CARRIERS,
    reason: "what happens when an effect ends: no program unit authors it",
    status: "gap"
  },
  {
    at: "effects[].endsWithTag",
    types: FEATURE_CARRIERS,
    reason: "effect linkage vocabulary with no control: no program unit authors it",
    status: "gap"
  },
  {
    at: "effects[].target",
    types: FEATURE_CARRIERS,
    reason: "effect linkage vocabulary with no control: no program unit authors it",
    status: "gap"
  },
  {
    at: "effects[].voidWhileIncapacitated",
    types: FEATURE_CARRIERS,
    reason: "effect linkage vocabulary with no control: no program unit authors it",
    status: "gap"
  },
  {
    at: "effects[].endsOnIncapacitated",
    types: FEATURE_CARRIERS,
    reason:
      "an effect that ends when its keeper has the Incapacitated condition (Superior Defense, Divine Sense, Draconic Flight) - authored in the class, species and item overlays; no control yet",
    status: "gap"
  },
  {
    at: "modifiers[].oncePerCast",
    types: FEATURE_CARRIERS,
    reason:
      "an extra-damage rider added to one damage roll of a cast, the first (Empowered Evocation, Elemental Affinity) - authored in the class overlays; no control yet",
    status: "gap"
  },
  {
    at: "actions[].timing",
    types: ACTION_CARRIERS,
    reason:
      "when in its user's own turn an action is taken (Superior Defense at the turn's start, Sacred Weapon in the Attack action) - authored in the class overlays; no control yet",
    status: "gap"
  },
  {
    at: "actions[].vitality.**",
    types: ACTION_CARRIERS,
    reason:
      "Temporary Hit Points a cast gives once its damage lands (Improved Potent Spellcasting) - derived at read time from the Cleric's option, never authored",
    status: "gap"
  },
  {
    at: "actions[].damageDiceByAbility.**",
    types: FEATURE_CARRIERS,
    reason:
      "damage dice counted by an ability modifier from a level (Sear Undead) - feature-carrier actions only, beside damageByLevel",
    status: "gap"
  },
  {
    at: "actions[].areaHeal.**",
    types: ACTION_CARRIERS,
    reason:
      "one creature picked in the area regains its own roll (Land's Aid) - authored in the class overlays; no control yet",
    status: "gap"
  },
  {
    at: "actions[].areaHealByLevel[].**",
    types: FEATURE_CARRIERS,
    reason: "the area's healing growing with level (Land's Aid) - feature-carrier actions only, beside damageByLevel",
    status: "gap"
  },
  {
    at: "effects[].light.**",
    types: FEATURE_CARRIERS,
    reason:
      "the light an effect sheds around its bearer (Faerie Fire's outline); authored in the spell overlay, no control yet",
    status: "gap"
  },
  {
    at: "effects[].detects.**",
    types: FEATURE_CARRIERS,
    reason:
      "the creatures an effect lets its bearer sense (Divine Sense); authored in the class and spell overlays, no control yet",
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
    at: "modifiers[].when[].senses",
    types: FEATURE_CARRIERS,
    reason: "the senses of `other-lacks-sense` (Blur), a trigger the content authors and the editor doesn't offer",
    status: "gap"
  },

  // ---- feature-scope machinery shared by the feature carriers ----
  {
    at: "choice.options[].**",
    types: "*",
    reason:
      "an option's own payload (nested choice, grants, uses, extraPicks): the choice panel authors one level and no deeper",
    status: "gap"
  },
  {
    at: "choices[].**",
    types: "*",
    reason: "the plural choices list: the panel writes the singular choice; the list shape has no control at all",
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
      "bespoke GrantsEditor JSX with no FieldDef: authored today through grantsFromRows and driven in pick-fields.test.tsx, invisible to the probe",
    status: "gap"
  },
  {
    at: "traits[].grants.**",
    types: "*",
    reason:
      "bespoke GrantsEditor JSX with no FieldDef: authored today through grantsFromRows and driven in pick-fields.test.tsx, invisible to the probe",
    status: "gap"
  },
  {
    at: "^feature.grants.**",
    types: ["feat"],
    reason:
      "bespoke GrantsEditor JSX at the feat's singular-feature scope: open now that the bare-group credit is gone",
    status: "gap"
  },
  {
    at: "^grants.**",
    types: "*",
    reason: "bespoke GrantsEditor JSX at record scope: same probe-blind mount",
    status: "gap"
  },
  {
    at: "uses.scaling.table[].**",
    types: "*",
    reason:
      "the by-level table at the three mounts the canonicaliser cannot reach: lineage depth, the feat's dotted singular feature, a cast's row scope (instrumented: exactly those six). The plain feature mounts author the table and probe covered",
    status: "gap"
  },
  {
    at: "casts[].uses.scaling.**",
    types: ["equipment"],
    reason: "an item cast's scaling: zero SRD authors until the magic-item bundle lands",
    status: "gap"
  },
  {
    at: "casts[].endsWithItem",
    types: ["equipment"],
    reason:
      "an item cast that ends when the item is taken off (a Hat of Disguise) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].teleport.**",
    types: ["equipment"],
    reason:
      "an item cast's own teleport in place of the spell's (a Cape of the Mountebank's Dimension Door) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].requiresEffectTag",
    types: ["equipment"],
    reason:
      "the effect an item's cast needs on its user (a Dragon Orb's control) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].lastsMinutes",
    types: ["equipment"],
    reason:
      "how long an item cast lasts in place of the spell's duration (Oil of Slipperiness' Grease: 8 hours) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].useCost",
    types: ["equipment"],
    reason:
      "an item cast's charge cost above one (Staff of Fire's Fireball: 3) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].chargesRaiseLevel",
    types: ["equipment"],
    reason:
      "the most charges a cast may spend, each a level higher (Wand of Fireballs) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].alsoUses.**",
    types: ["equipment"],
    reason:
      "an item cast's once-a-dawn limit beside its charges (a Luck Blade's Wish) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "charges.startingByPool",
    types: ["equipment"],
    reason:
      "each pool's own count when a copy is added (a Helm of Brilliance's gems) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].through",
    types: ["equipment"],
    reason:
      "the spell an item's cast goes through (a Crystal Ball's Scrying) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].check.**",
    types: ["equipment"],
    reason:
      "the check an item's cast asks first (an Amulet of the Planes) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "servesAsFocus",
    types: ["equipment"],
    reason:
      "the Spellcasting Focus a magic item serves as (a talisman's Holy Symbol) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "savesNegateSpells.**",
    types: ["equipment"],
    reason:
      "a successful save that leaves a spell no effect (a Ring of Spell Turning) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "breaks.**",
    types: ["equipment"],
    reason:
      "the chance a use breaks the item (a Horn of Blasting, a Wind Fan) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].optionIds",
    types: ["equipment"],
    reason:
      "the spell's options an item's cast may pick (Wand of Fear's Command: flee or grovel only) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "charges.lastCharge.**",
    types: ["equipment"],
    reason:
      "what the last charge does to the item (destroyed, nonmagical, or an item it becomes) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "^utilize[].**",
    types: ["equipment"],
    reason:
      "a gear item's Utilize checks at their printed DCs (a Grappling Hook's DC 13 Acrobatics) - authored in the equipment source; no editor control yet",
    status: "gap"
  },
  {
    at: "charges.lastChargeTwenty",
    types: ["equipment"],
    reason:
      "the charges a 20 on the last charge's d20 gives back (Staff of Power) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "charges.starting",
    types: ["equipment"],
    reason:
      "the charges a copy holds when it is added (Necklace of Fireballs' beads) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "uses.afterHours",
    types: "*",
    reason:
      "the hours of game time before uses spent for a time come back (Wings of Flying's 1d12) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "extraPicks[].**",
    types: "*",
    reason: "extra-pick rows beyond what the resolver reads: no rows control at feature scope",
    status: "gap"
  },
  {
    at: "replaces[].**",
    types: "*",
    reason:
      "the replacement clause's rows: written whole by the replacement control, per-key fields invisible to the probe",
    status: "gap"
  },
  {
    at: "replacesFeatureId",
    types: ["species"],
    reason: "supersession at species-trait scope: the control exists on class features and is missing here",
    status: "gap"
  },
  {
    at: "freeCastOf.**",
    types: "*",
    reason:
      "a free casting a feature gives the spells other features grant (Natural Recovery's Circle Spell): no control at feature scope yet",
    status: "gap"
  },
  {
    at: "extraSpellLists",
    types: "*",
    reason:
      "spell lists a feature adds to the class's own picks (Magical Secrets): no list control at feature scope yet",
    status: "gap"
  },

  // ---- record-scope gaps, per type ----
  {
    at: "^lineages[].**",
    types: ["species"],
    reason: "a lineage's own traits: today a lineage row is name + description only",
    status: "gap"
  },
  {
    at: "languageChoices.**",
    types: ["species"],
    reason: "9 of 9 SRD species author languageChoices: the builder's language offer has no authoring end",
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
      "zero of 12 SRD classes author it: every class uses the from list, which has a control (\u00a74); the group's rows never offered it",
    status: "permanent: zero SRD authors"
  },
  {
    at: "toolChoices.fromCatalog",
    types: ["class"],
    reason: "zero of 12 SRD classes author it (\u00a74); the group's rows never offered it",
    status: "permanent: zero SRD authors"
  },
  {
    at: "startingEquipment[].items[].pickFrom",
    types: ["class", "background"],
    reason:
      "the items a kit entry lets its taker pick (the Bard's instrument of choice): the kit editor writes items without a pick list yet",
    status: "gap"
  },
  {
    at: "multiclassProficiencies.**",
    types: ["class"],
    reason:
      "the builder grants these to a class taken after the first, but its skill and instrument picks (a Bard's, Ranger's or Rogue's) have no control",
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
      "bespoke LevelTableEditor JSX with no FieldDef: authored today, invisible to the probe until it uses FieldDefs",
    status: "gap"
  },
  {
    at: "^light.**",
    types: ["equipment"],
    reason:
      "the light an item sheds (a Torch's 20 feet bright, 20 dim), which dynamic vision reads; no editor control yet",
    status: "gap"
  },
  {
    at: "^study.**",
    types: ["equipment"],
    reason: "a manual's or tome's study, the score it raises for good once the GM marks it done; no editor control yet",
    status: "gap"
  },
  {
    at: "^variants[].**",
    types: ["equipment"],
    reason:
      "the kinds one record covers (an Ioun Stone's stones) or the forms its holder picks (a Rod of Lordly Might's buttons), each with riders of its own - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "^variantChoice.**",
    types: ["equipment"],
    reason:
      "who picks a copy's kind, and what changing a form costs - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "^weaponChanges.**",
    types: ["equipment"],
    reason:
      "what a magic weapon changes about its bound base (a Dwarven Thrower's Thrown 20/60, an Energy Bow's Force) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "^container.**",
    types: ["equipment"],
    reason:
      "what the item holds as a container (a Backpack's 30 pounds, a Handy Haversack's pouches) - authored in the gear and item overlays; no editor control yet",
    status: "gap"
  },
  {
    at: "^attunementHeldBy",
    types: ["equipment"],
    reason:
      "the effect that keeps its bearer attuned (a Dragon Orb's charm) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "^bonusActionAttack",
    types: ["equipment"],
    reason:
      "an attack with the weapon as a Bonus Action (Scimitar of Speed) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "^contents[].**",
    types: ["equipment"],
    reason:
      "what an equipment pack holds, unpacked where a character comes by it (an Explorer's Pack's 10 Torches) - authored in the gear source; no editor control yet",
    status: "gap"
  },
  {
    at: "^magicSaveAura.**",
    types: ["equipment"],
    reason:
      "an aura of Advantage on saves against magic for the bearer and its allies (Holy Avenger) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].attackBonus",
    types: ["equipment"],
    reason:
      "a cast's printed bonus to hit (Circlet of Blasting's +5) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "casts[].activation",
    types: ["equipment"],
    reason:
      "what casting from the item takes in place of the spell's casting time (a prayer bead's Bonus Action) - authored in the item overlay; no editor control yet",
    status: "gap"
  },
  {
    at: "^uses.scaling.id",
    types: ["equipment"],
    reason:
      "the class-resource id at ITEM scope: the dedicated field exists on feature mounts only; the item's uses rows omit it",
    status: "gap"
  },
  {
    at: "prerequisite.requires",
    types: ["feat"],
    reason:
      'the proficiency or feature slugs a feat requires ("martial", "spellcasting") have no control. The printed text carries them.',
    status: "gap"
  },
  {
    at: "castingOptions[].**",
    types: ["spell"],
    reason: "a spell's casting options: the spell form has no rows control for them",
    status: "gap"
  },
  {
    at: "components.costly[].**",
    types: ["spell"],
    reason:
      "a spell's priced or consumed materials, read from the material text as the catalog is built; the spell form has no rows control for them",
    status: "gap"
  },
  {
    at: "^add",
    types: ["spell-list"],
    reason: "written whole by the bespoke SpellListContents editor: no FieldDef the probe can see",
    status: "permanent: bespoke editor, probe-blind"
  },
  {
    at: "^remove",
    types: ["spell-list"],
    reason: "written whole by the bespoke SpellListContents editor: no FieldDef the probe can see",
    status: "permanent: bespoke editor, probe-blind"
  },

  // ---- the monster stat block's shared-schema tail ----
  {
    at: "^extensions",
    types: ["monster"],
    reason: "the opaque bag itself: the census's structural blind spot, since the walk cannot see its keys",
    status: "gap"
  },
  {
    at: "traitMechanics[].**",
    types: ["monster"],
    reason:
      "what a stat block's traits do (Regeneration, auras, Death Burst), read from the trait text as the catalog is built; no editor control yet",
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
    reason: "a built-character field on the shared ActorDefinition: 0 of 330 SRD monster rows author it",
    status: "permanent: built-character field"
  },
  {
    at: "character.**",
    types: ["monster"],
    reason: "a built-character field on the shared ActorDefinition: 0 of 330 SRD monster rows author it",
    status: "permanent: built-character field"
  },
  {
    at: "startingInventory[].**",
    types: ["monster"],
    reason: "a built-character field on the shared ActorDefinition: 0 of 330 SRD monster rows author it",
    status: "permanent: built-character field"
  },
  {
    at: "startingCurrency.**",
    types: ["monster"],
    reason: "a built-character field on the shared ActorDefinition: 0 of 330 SRD monster rows author it",
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

/** Keys the system stamps and no GM authors, subtracted structurally with no exemption rows. */
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
  reason: "system-forced: stamped by the store, the row, or a rows editor's newRow: never authored by hand"
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
      verifiers: {
        gm: (token) => (token === "gm-token" ? { sessionId: "gm" } : null),
        player: (token) => (token === "player-token" ? { sessionId: "player" } : null)
      },
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
