import { useEffect, useMemo, useState } from "react";
import type {
  CatalogChoiceCatalogs, ContentBackgroundSummary, ContentClassSummary, ContentFeatSummary,
  ContentLanguageSummary, ContentNameBundle, ContentSkillSummary, ContentSpeciesSummary, ContentSubclassSummary
} from "@vtt/domain";
import { useEquipmentReference } from "../encounter/equipment";
import { useSpellReference } from "../encounter/spells";
import { socket } from "../socket";
import { registerContentCache } from "./invalidate";

/**
 * The character-builder content catalogs, read once per session and shared by every surface that
 * needs them (the wizard's seven steps, the sheet's skill list). One cache per catalog, following
 * the shape `encounter/spells.tsx` established:
 *
 *   - a module-level cache, so two mounted consumers cause ONE fetch;
 *   - a `??=` in-flight promise, so two SIMULTANEOUS mounts also cause one fetch;
 *   - a listener set, so whoever mounted first still gets the answer;
 *   - **a failed or empty ack is never cached** - a transient miss retries on the next mount.
 *     (Caching an empty list would leave the wizard permanently unable to offer a species.)
 *
 * Each catalog response carries the bundle's CC BY 4.0 `attribution` line (ADR-0015); it rides along
 * so the wizard's persistent footer renders the server's text rather than a hand-written substitute.
 */

type CatalogRead<T> = Readonly<{ items: readonly T[]; attribution: string | null; loaded: boolean }>;

/** ONE empty list for every not-yet-loaded catalog. `cache ?? []` minted a fresh array per render, so
    a consumer keyed on `items` (see `useBuilderCatalogs`) could never be stable before the fetch lands.
    Sharing one frozen array makes `items` identity change exactly once - when the cache is filled. */
const EMPTY: readonly never[] = Object.freeze([]);

/** Builds one cached catalog + its hook. `fetcher` owns the (individually typed) socket emit. */
function makeCatalog<T>(fetcher: (done: (items: readonly T[] | undefined, attribution: string | undefined) => void) => void) {
  let cache: readonly T[] | null = null;
  let attribution: string | null = null;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  /** `force` is how a homebrew publish gets past the one-fetch-per-session guard. The
      previous list stays served until the new one lands, so nothing flashes empty. */
  const request = (force = false) => {
    if (cache && !force) return;
    inFlight ??= new Promise<void>((resolve) => {
      fetcher((items, line) => {
        inFlight = null;
        // Never cache a miss: `ok:false`, a dropped field, or an empty list all retry next mount.
        if (items && items.length > 0) {
          cache = items;
          attribution = line ?? null;
          for (const listener of listeners) listener();
        }
        resolve();
      });
    });
  };

  // Content is no longer immutable: a GM can publish a class mid-session. Nothing happens
  // for a cold cache — the next mount fetches anyway. See `content/invalidate.ts`.
  registerContentCache(() => { if (cache) request(true); });

  function useCatalog(): CatalogRead<T> {
    const [, bump] = useState(0);
    useEffect(() => {
      // ALWAYS subscribe, even when the cache is warm. The early return this replaces
      // meant a consumer that mounted after the fetch had landed held no listener, so a
      // later invalidation could refetch and re-render nobody: the builder would keep
      // offering the list it read at page load. `items` is read at render from the
      // module cache, so the bump is the only thing that makes a swap visible.
      const listener = () => bump((count) => count + 1);
      listeners.add(listener);
      request();
      return () => { listeners.delete(listener); };
    }, []);
    return { items: cache ?? EMPTY, attribution, loaded: cache !== null };
  }

  return { useCatalog, request };
}

const classes = makeCatalog<ContentClassSummary>((done) => socket.emit("content:classes", {}, (result) => done(result.classes, result.attribution)));
const subclasses = makeCatalog<ContentSubclassSummary>((done) => socket.emit("content:subclasses", {}, (result) => done(result.subclasses, result.attribution)));
const species = makeCatalog<ContentSpeciesSummary>((done) => socket.emit("content:species", {}, (result) => done(result.species, result.attribution)));
const backgrounds = makeCatalog<ContentBackgroundSummary>((done) => socket.emit("content:backgrounds", {}, (result) => done(result.backgrounds, result.attribution)));
const feats = makeCatalog<ContentFeatSummary>((done) => socket.emit("content:feats", {}, (result) => done(result.feats, result.attribution)));
const names = makeCatalog<ContentNameBundle>((done) => socket.emit("content:names", {}, (result) => done(result.names, result.attribution)));
const skills = makeCatalog<ContentSkillSummary>((done) => socket.emit("content:skills", {}, (result) => done(result.skills, result.attribution)));
const languages = makeCatalog<ContentLanguageSummary>((done) => socket.emit("content:languages", {}, (result) => done(result.languages, result.attribution)));

export const useClassCatalog = classes.useCatalog;
export const useSubclassCatalog = subclasses.useCatalog;
export const useSpeciesCatalog = species.useCatalog;
export const useBackgroundCatalog = backgrounds.useCatalog;
export const useFeatCatalog = feats.useCatalog;
export const useNameCatalog = names.useCatalog;

/**
 * The skills catalog, with the ability each check uses. THIS is what retires the sheet's hardcoded
 * `SKILL_ABILITY` table (known-bugs: a homebrew skill needed three code edits) - ordering and the
 * governing ability now come from data, per architecture principle 3.
 */
export const useSkillCatalog = skills.useCatalog;

/**
 * The language catalog, each row carrying the SRD table it is printed in. Without it the species
 * step's "Common plus two languages" budget resolves to nothing and the wizard cannot be finished -
 * which is exactly the state every character was built in before the catalog existed.
 */
export const useLanguageCatalog = languages.useCatalog;

export type BuilderCatalogs = Readonly<{
  /** Exactly the shape `resolveCatalogChoice` reads - the SAME resolver the server validates with. */
  choice: CatalogChoiceCatalogs;
  backgrounds: readonly ContentBackgroundSummary[];
  names: readonly ContentNameBundle[];
  /** True once every catalog the wizard needs has answered. */
  loaded: boolean;
  /** Distinct CC BY lines across the loaded catalogs, for the persistent attribution footer. */
  attributions: readonly string[];
}>;

/**
 * Every catalog the wizard needs, in one read. The `choice` half is passed verbatim to
 * `resolveCatalogChoice`, so a feature's `fromCatalog` slug resolves client-side through the exact
 * function the server re-validates the submitted choice with - the two cannot disagree about what
 * was offerable (CLAUDE.md rule 2: the client never becomes a second rules engine).
 */
export function useBuilderCatalogs(): BuilderCatalogs {
  const classRead = useClassCatalog();
  const subclassRead = useSubclassCatalog();
  const speciesRead = useSpeciesCatalog();
  const backgroundRead = useBackgroundCatalog();
  const featRead = useFeatCatalog();
  const skillRead = useSkillCatalog();
  const languageRead = useLanguageCatalog();
  const nameRead = useNameCatalog();
  const spells = useSpellReference();
  const equipment = useEquipmentReference();

  /**
   * ONE object identity per content load. Every field here is a cached list or a cached string, so the
   * value only ever CHANGES when a catalog answers - but rebuilding the literal per render handed the
   * wizard a new `catalogs` every time, and `catalogs` is a dependency of its `computeOffers` memos and
   * of the pick-pruning effect. Typing a name therefore re-walked every offer in the build. Keyed on
   * the cached identities (stable once loaded, see `EMPTY` above), so the walk happens when the BUILD
   * changes and not when the render does. This is a correctness fix, not a measurable speed-up.
   */
  return useMemo(() => {
    const reads = [classRead, subclassRead, speciesRead, backgroundRead, featRead, skillRead, languageRead, nameRead];
    const attributions = [...new Set([...reads.map((read) => read.attribution), equipment.attribution].filter((line): line is string => typeof line === "string" && line.length > 0))];
    return {
      choice: {
        classes: classRead.items,
        subclasses: subclassRead.items,
        species: speciesRead.items,
        feats: featRead.items,
        spells,
        equipment: equipment.catalog,
        skills: skillRead.items,
        languages: languageRead.items
      },
      backgrounds: backgroundRead.items,
      names: nameRead.items,
      loaded: reads.every((read) => read.loaded) && spells.length > 0 && equipment.catalog.length > 0,
      attributions
    };
    // The lists and the attribution lines ARE the value: `loaded` flips exactly when a list identity
    // does (a miss is never cached, line 40), so it needs no key of its own.
  }, [
    classRead.items, subclassRead.items, speciesRead.items, backgroundRead.items, featRead.items, skillRead.items, languageRead.items, nameRead.items,
    spells, equipment.catalog,
    classRead.attribution, subclassRead.attribution, speciesRead.attribution, backgroundRead.attribution,
    featRead.attribution, skillRead.attribution, languageRead.attribution, nameRead.attribution, equipment.attribution
  ]);
}
