import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CatalogChoiceCatalogs, ContentBackgroundSummary, ContentNameBundle } from "@vtt/domain";
import { useEquipmentReference } from "../encounter/equipment";
import { useSpellReference } from "../encounter/spells";
import { read } from "../lib/command";
import { registerContentCache } from "./invalidate";

/**
 * The character-builder content catalogs, read once per session and shared by every consumer.
 * Each catalog is a small external store: a snapshot, a shared in-flight read and a listener set. A
 * failed or empty reply is never cached, so a transient miss retries on the next mount. Each
 * response's CC BY 4.0 `attribution` line (ADR-0015) is kept for the wizard's footer.
 */

type CatalogRead<T> = Readonly<{ items: readonly T[]; attribution: string | null; loaded: boolean }>;
type CatalogReply<T> = Readonly<{ items?: readonly T[]; attribution?: string }>;

/** Builds one cached catalog and its hook. `load` reads the catalog from the server. */
function makeCatalog<T>(load: () => Promise<CatalogReply<T>>) {
  // Replaced, never mutated, so a consumer can memoize on its identity.
  let snapshot: CatalogRead<T> = { items: [], attribution: null, loaded: false };
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  /** `force` bypasses the one-fetch guard after a homebrew publish. The previous list stays
      served until the new one lands, so nothing flashes empty. */
  const request = (force = false) => {
    if (snapshot.loaded && !force) return;
    inFlight ??= load().then(({ items, attribution }) => {
      inFlight = null;
      // Never cache a miss: a refusal, a dropped field, or an empty list all retry next mount.
      if (!items || items.length === 0) return;
      snapshot = { items, attribution: attribution ?? null, loaded: true };
      for (const listener of listeners) listener();
    });
  };

  // A GM can publish content mid-session; a cold cache does nothing (see `content/invalidate.ts`).
  registerContentCache(() => {
    if (snapshot.loaded) request(true);
  });

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const getSnapshot = () => snapshot;

  function useCatalog(): CatalogRead<T> {
    const current = useSyncExternalStore(subscribe, getSnapshot);
    useEffect(() => {
      request();
    }, []);
    return current;
  }

  return { useCatalog, request };
}

const classes = makeCatalog(() =>
  read("content:classes", {}).then((reply) => ({ items: reply.classes, attribution: reply.attribution }))
);
const subclasses = makeCatalog(() =>
  read("content:subclasses", {}).then((reply) => ({ items: reply.subclasses, attribution: reply.attribution }))
);
const species = makeCatalog(() =>
  read("content:species", {}).then((reply) => ({ items: reply.species, attribution: reply.attribution }))
);
const backgrounds = makeCatalog(() =>
  read("content:backgrounds", {}).then((reply) => ({ items: reply.backgrounds, attribution: reply.attribution }))
);
const feats = makeCatalog(() =>
  read("content:feats", {}).then((reply) => ({ items: reply.feats, attribution: reply.attribution }))
);
const names = makeCatalog(() =>
  read("content:names", {}).then((reply) => ({ items: reply.names, attribution: reply.attribution }))
);
const skills = makeCatalog(() =>
  read("content:skills", {}).then((reply) => ({ items: reply.skills, attribution: reply.attribution }))
);
const languages = makeCatalog(() =>
  read("content:languages", {}).then((reply) => ({ items: reply.languages, attribution: reply.attribution }))
);

export const useClassCatalog = classes.useCatalog;
export const useSubclassCatalog = subclasses.useCatalog;
export const useSpeciesCatalog = species.useCatalog;
export const useBackgroundCatalog = backgrounds.useCatalog;
export const useFeatCatalog = feats.useCatalog;
export const useNameCatalog = names.useCatalog;

/** The skills catalog, with the ability each check uses; ordering and abilities come from data. */
export const useSkillCatalog = skills.useCatalog;

/**
 * The language catalog, each row tagged with its SRD table. The species step's "Common plus two
 * languages" budget resolves through it.
 */
export const useLanguageCatalog = languages.useCatalog;

export type BuilderCatalogs = Readonly<{
  /** Exactly the shape `resolveCatalogChoice` reads (the homebrew editor resolves slugs with it). */
  choice: CatalogChoiceCatalogs;
  backgrounds: readonly ContentBackgroundSummary[];
  names: readonly ContentNameBundle[];
  /** True once every catalog the wizard needs has answered. */
  loaded: boolean;
  /** Distinct CC BY lines across the loaded catalogs, for the persistent attribution footer. */
  attributions: readonly string[];
}>;

/**
 * Every catalog the wizard and the homebrew editor need, in one read: the wizard names and describes
 * what the server offers from them, and the editor resolves `fromCatalog` slugs with
 * `resolveCatalogChoice`, the function the server validates with.
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
   * One object identity per content load: `catalogs` is a dependency of the wizard's step-reason memo,
   * so a new object per render would recheck every step on each keystroke. Each catalog read is a
   * store snapshot, replaced only when that catalog changes.
   */
  return useMemo(() => {
    const reads = [classRead, subclassRead, speciesRead, backgroundRead, featRead, skillRead, languageRead, nameRead];
    const attributions = [
      ...new Set(
        [...reads.map((read) => read.attribution), equipment.attribution].filter(
          (line): line is string => typeof line === "string" && line.length > 0
        )
      )
    ];
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
  }, [
    classRead,
    subclassRead,
    speciesRead,
    backgroundRead,
    featRead,
    skillRead,
    languageRead,
    nameRead,
    spells,
    equipment.catalog,
    equipment.attribution
  ]);
}
