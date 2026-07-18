import type { ContentActionSummary, ContentConditionSummary, ContentMonsterSummary } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadAttribution, loadConditions, loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { parseAreaProse } from "./area-targeting.js";

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
  conditionSummaries(): readonly ContentConditionSummary[] { return conditionSummaries; }
  hasCondition(conditionId: string): boolean { return conditionIds.has(conditionId); }
  monsterAction(definitionId: string, actionId: string): ActorDefinition["actions"][number] | undefined {
    return this.byId.get(definitionId)?.actions.find((action) => action.id === actionId);
  }
  monsterActionSummaries(definitionId: string): readonly ContentActionSummary[] | undefined {
    return this.byId.get(definitionId)?.actions.map(actionSummaryOf);
  }
}

/** One flattening for both content sources (bundled + imported), so the runner's wire shape can't fork. */
export function actionSummaryOf(action: ActorDefinition["actions"][number]): ContentActionSummary {
  return {
    id: action.id,
    name: action.name,
    activation: action.activation,
    description: action.description,
    attackBonus: action.attack?.bonus ?? null,
    reachFeet: action.attack?.reachFeet ?? null,
    rangeFeet: action.attack?.rangeFeet ?? null,
    saveAbility: action.save?.ability ?? null,
    saveDc: action.save?.dc ?? null,
    damage: action.damage.map((part) => ({ formula: part.formula, type: part.type })),
    area: parseAreaProse(action.description),
    attackCount: action.attack?.count ?? null,
    usesLimit: action.uses?.limit ?? null,
    usesPer: action.uses?.per ?? null,
    usesPool: action.uses?.pool ?? null,
    requiresEffectTag: action.requiresEffectTag ?? null,
    multiattack: action.multiattack ?? null,
    grants: action.grants !== undefined,
    reaction: action.reaction ?? null
  };
}

const conditionSummaries: readonly ContentConditionSummary[] = loadConditions().map(({ id, name, description }) => ({ id, name, description }));
const conditionIds = new Set(conditionSummaries.map((condition) => condition.id));
