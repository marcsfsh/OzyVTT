import type { ContentMonsterSummary } from "@vtt/domain";
import { read } from "../lib/command";

export type MonsterCatalog = Readonly<{ monsters: readonly ContentMonsterSummary[]; attribution: string }>;

let catalog: Promise<MonsterCatalog> | null = null;

/** The bestiary's browse rows, fetched once per page load and shared by every reader. A failed read is
 *  forgotten so the next caller retries. */
export function loadMonsterCatalog(): Promise<MonsterCatalog> {
  catalog ??= read("content:monsters", {}).then((result) => {
    if (!result.ok || !result.monsters) {
      catalog = null;
      throw new Error(result.message ?? "The bundled bestiary could not be loaded.");
    }
    return { monsters: result.monsters, attribution: result.attribution ?? "" };
  });
  return catalog;
}
