/**
 * What the "Duplicate an existing …" route can copy from.
 *
 * `POST /content/{id}/duplicate` accepts an **SRD** id as well as a homebrew one —
 * the server reads the bundled record and mints a namespaced homebrew copy. That is
 * the endpoint that makes a 20-row class table tractable to author, so the picker
 * has to offer the bundled catalogs, not just what the GM has already made.
 *
 * Every catalog here is already module-cached by its own hook (one fetch per session,
 * shared with the builder / the encounter picker / the sheet), so mounting them
 * together costs nothing a GM who has opened those surfaces has not already paid.
 * The hooks are called unconditionally and the result is selected by type, because
 * that is the only shape React's rules of hooks allow.
 *
 * `spell-list` has no bundled catalog endpoint — the eight SRD lists are data inside
 * `@vtt/content-srd-5.2.1`, not an HTTP catalog — so its picker offers homebrew only.
 * That is a real, explainable gap, not a silent empty grid: the create modal says so in
 * the grid's own empty state, and a GM builds a list from `basedOn` in the editor
 * rather than by duplicating one.
 */

import { useEffect, useMemo, useState } from "react";
import type { ContentMonsterSummary } from "@vtt/domain";
import { socket } from "../socket";
import {
  useBackgroundCatalog,
  useClassCatalog,
  useFeatCatalog,
  useSpeciesCatalog,
  useSubclassCatalog
} from "../content/catalogs";
import { useEquipmentReference } from "../encounter/equipment";
import { useSpellReference } from "../encounter/spells";
import type { HomebrewRecordSummary } from "./api";
import type { HomebrewType } from "./types";

export type DuplicateSource = Readonly<{
  id: string;
  name: string;
  origin: "srd" | "homebrew";
  /** A short mono line under the title — hit die, spell level, challenge rating. */
  meta?: string;
  /** Extra searchable text beyond the name. */
  keywords?: string;
}>;

/* ---- The SRD bestiary. Mirrors `encounter/spells.tsx`'s cache exactly: one fetch per
   session, a `??=` in-flight promise so two simultaneous mounts still cause one, and a
   failed or empty ack is NEVER cached (a transient miss must retry on the next mount,
   or the picker is permanently unable to offer a creature). ---- */
let monsterCache: readonly ContentMonsterSummary[] | null = null;
let monsterInFlight: Promise<void> | null = null;
const monsterListeners = new Set<(monsters: readonly ContentMonsterSummary[]) => void>();

function requestMonsterReference() {
  if (monsterCache) return;
  monsterInFlight ??= new Promise<void>((resolve) => {
    socket.emit("content:monsters", {}, (result) => {
      monsterInFlight = null;
      if (result.ok && result.monsters && result.monsters.length > 0) {
        monsterCache = result.monsters;
        for (const listener of monsterListeners) listener(monsterCache);
      }
      resolve();
    });
  });
}

function useMonsterReference(): readonly ContentMonsterSummary[] {
  const [monsters, setMonsters] = useState<readonly ContentMonsterSummary[]>(monsterCache ?? []);
  useEffect(() => {
    if (monsterCache) {
      setMonsters(monsterCache);
      return;
    }
    monsterListeners.add(setMonsters);
    requestMonsterReference();
    return () => {
      monsterListeners.delete(setMonsters);
    };
  }, []);
  return monsters;
}

const byName = (a: DuplicateSource, b: DuplicateSource) => a.name.localeCompare(b.name);

/**
 * Every record of `type` the GM could copy: the bundled SRD catalog plus their own
 * homebrew, one flat list, sorted by name within each origin so the two blocks read
 * as one list rather than two interleaved ones.
 *
 * Soft-deleted homebrew is excluded — copying a record the GM has removed from every
 * picker would resurrect it under a new id, which is not what "Removed" means.
 */
export function useDuplicateSources(
  type: HomebrewType | null,
  homebrew: readonly HomebrewRecordSummary[]
): readonly DuplicateSource[] {
  const classes = useClassCatalog();
  const subclasses = useSubclassCatalog();
  const species = useSpeciesCatalog();
  const backgrounds = useBackgroundCatalog();
  const feats = useFeatCatalog();
  const spells = useSpellReference();
  const equipment = useEquipmentReference();
  const monsters = useMonsterReference();

  return useMemo(() => {
    if (!type) return [];

    const srd: DuplicateSource[] = [];
    // `source` is the discriminator that lets one merged catalog serve bundled SRD and
    // GM homebrew. Homebrew rows already arrive through the homebrew list, so filtering
    // them out here is what stops a published homebrew class appearing twice.
    const bundled = <T extends { id: string; name: string; source?: string }>(items: readonly T[]) =>
      items.filter((item) => item.source !== "homebrew");

    switch (type) {
      case "class":
        for (const row of bundled(classes.items)) srd.push({ id: row.id, name: row.name, origin: "srd", meta: `Hit die ${row.hitDie}` });
        break;
      case "subclass":
        for (const row of bundled(subclasses.items)) srd.push({ id: row.id, name: row.name, origin: "srd", meta: row.classId, keywords: row.classId });
        break;
      case "species":
        for (const row of bundled(species.items)) srd.push({ id: row.id, name: row.name, origin: "srd", meta: `${row.speedFeet} ft` });
        break;
      case "background":
        for (const row of bundled(backgrounds.items)) srd.push({ id: row.id, name: row.name, origin: "srd" });
        break;
      case "feat":
        for (const row of bundled(feats.items)) srd.push({ id: row.id, name: row.name, origin: "srd", meta: row.category, keywords: row.category });
        break;
      case "spell":
        for (const row of spells) {
          srd.push({
            id: row.id,
            name: row.name,
            origin: "srd",
            meta: row.level === 0 ? `${row.school} cantrip` : `Level ${row.level} ${row.school}`,
            keywords: row.school
          });
        }
        break;
      case "equipment":
        for (const row of equipment.catalog) srd.push({ id: row.id, name: row.name, origin: "srd", meta: row.category, keywords: row.category });
        break;
      case "monster":
        for (const row of monsters) srd.push({ id: row.id, name: row.name, origin: "srd", meta: `CR ${row.challengeRating}`, keywords: `${row.type} ${row.size}` });
        break;
      case "spell-list":
        // The eight SRD lists are bundle data, not an HTTP catalog. A GM starts a list
        // from `basedOn` in the editor rather than by duplicating one.
        break;
    }

    const mine: DuplicateSource[] = homebrew
      .filter((row) => row.type === type && !row.deletedAt)
      .map((row) => ({ id: row.id, name: row.name, origin: "homebrew" as const, meta: row.state === "draft" ? "Draft" : "Published" }));

    return [...srd.sort(byName), ...mine.sort(byName)];
  }, [type, classes.items, subclasses.items, species.items, backgrounds.items, feats.items, spells, equipment.catalog, monsters, homebrew]);
}
