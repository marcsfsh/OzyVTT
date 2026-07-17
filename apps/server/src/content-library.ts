import type { ContentMonsterSummary } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadAttribution, loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";

/**
 * Read-only access to the bundled SRD content for command handlers. Loaded once per process;
 * the bundle is validated by the content package's own loaders. Clients never import the
 * content package — they receive these wire shapes from the server (ADR-0001/0015).
 */
export class ContentLibrary {
  private readonly byId = new Map<string, ActorDefinition>();
  private readonly summaries: ContentMonsterSummary[];
  readonly attribution: string;

  constructor() {
    for (const definition of loadMonsterDefinitions()) {
      if (definition.source.externalId) this.byId.set(definition.source.externalId, definition);
    }
    this.summaries = [...this.byId.entries()]
      .map(([id, definition]) => {
        const extension = definition.extensions["open5e.srd-2024"] as { challengeRating?: number; type?: string } | undefined;
        return {
          id,
          name: definition.name,
          challengeRating: extension?.challengeRating ?? 0,
          type: extension?.type ?? "unknown",
          size: definition.size,
          armorClass: definition.armorClass,
          hitPoints: definition.hitPoints.maximum
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    this.attribution = loadAttribution().attribution;
  }

  monsterSummaries(): readonly ContentMonsterSummary[] { return this.summaries; }
  monster(definitionId: string): ActorDefinition | undefined { return this.byId.get(definitionId); }
}
