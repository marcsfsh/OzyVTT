import type { BuilderPolicy, GameState } from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import { rebuildActorDefinition } from "./actor-roster.js";
import { buildCharacterDefinition } from "./character-build.js";
import { computeServerOffers, type ChoiceOffer } from "./character-offers.js";
import type { ContentView } from "./content-library.js";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { buildRequestOf } from "./ledger-rechoice.js";

/**
 * SRD 5.2.1 Reincarnate: "The target's soul inhabits the new body ... It loses the traits of its previous species and
 * gains the traits of its new one." The cast tags the returned creature with the rolled species
 * (`resolution/revival.ts`); after the cast lands, a character built here is rebuilt from its ledger with that species.
 * The old species' picks leave the ledger, and the new species' picks are filled with their first legal options, which
 * the GM can change in the Level flow.
 */

/** The tag prefix naming the species a reincarnated creature's new body is (`reincarnated-as:dwarf`). */
export const REINCARNATED_AS = "reincarnated-as:";

type RebuildDeps = Readonly<{ library: ContentView; policy: BuilderPolicy; catalog?: EquipmentCatalog }>;

/** The picks a species makes in the builder's species step: its traits' own picks, its lineage and its size. The
 *  languages chosen there belong to every species and stay. */
const isSpeciesPick = (offer: ChoiceOffer) =>
  offer.step === "species" && (offer.featureId !== null || offer.kind === "lineage" || offer.kind === "size");

/** The ledger rows that answer the species' own picks (its lineage, size, skills, a Versatile feat and that feat's own
 *  picks). */
function speciesRows(choices: readonly CharacterChoice[], offers: readonly ChoiceOffer[]): Set<number> {
  const species = offers.filter(isSpeciesPick);
  const featureIds = new Set(species.flatMap((offer) => [offer.featureId, ...offer.featureAliases]).filter(Boolean));
  const bareKinds = new Set(species.filter((offer) => offer.featureId === null).map((offer) => offer.kind));
  const dropped = new Set<number>();
  choices.forEach((row, at) => {
    const featureId = row.payload?.featureId;
    if (typeof featureId === "string" ? featureIds.has(featureId) : bareKinds.has(row.kind)) dropped.add(at);
  });
  return dropped;
}

/** The new species' picks the ledger leaves open, each filled with the first options the character doesn't already
 *  hold (`held`: what it has of each kind). */
function firstPicks(
  offers: readonly ChoiceOffer[],
  held: (kind: string) => ReadonlySet<string>
): Array<{ row: CharacterChoice; label: string; name: string }> {
  const picks: Array<{ row: CharacterChoice; label: string; name: string }> = [];
  for (const offer of offers) {
    if (!isSpeciesPick(offer) || offer.unresolvable !== null) continue;
    const open = [...offer.options].filter(
      (id) => !offer.taken.includes(id) && !offer.unmet.has(id) && !held(offer.kind).has(id)
    );
    for (const id of open.slice(0, Math.max(0, offer.capacity - offer.taken.length)))
      picks.push({
        row: {
          level: offer.levels[0] ?? 1,
          kind: offer.kind,
          id,
          ...(offer.featureId !== null ? { payload: { featureId: offer.featureId } } : {})
        },
        label: offer.label,
        name: offer.names.get(id) ?? id
      });
  }
  return picks;
}

/** The ledger rebuilt with `speciesId`: the old species' rows out, the new species' picks in, a picked feat's own
 *  picks filled on the next pass. Null when the sheet doesn't record how it was built. */
function rebuiltAs(state: GameState, actorId: string, speciesId: string, deps: RebuildDeps) {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const definition = state.definitions.find((entry) => entry.id === actor?.definitionId)?.definition;
  const request = definition ? buildRequestOf(definition, deps.library) : null;
  if (!request) return null;
  const before = computeServerOffers(request, deps.library, deps.policy).offers;
  const dropped = speciesRows(request.choices, before);
  let next = { ...request, speciesId, choices: request.choices.filter((_row, at) => !dropped.has(at)) };
  const picked: string[] = [];
  // A pick can open another (Versatile's feat names its own spells): a few passes fill them all.
  const background = deps.library.backgroundRecord(request.backgroundId);
  const held = (kind: string) =>
    new Set([
      ...next.choices.filter((row) => row.kind === kind).map((row) => row.id),
      ...(kind === "skill" ? (background?.skillProficiencies ?? []) : []),
      ...(kind === "tool" ? (background?.toolProficiencies ?? []) : [])
    ]);
  for (let pass = 0; pass < 3; pass += 1) {
    const picks = firstPicks(computeServerOffers(next, deps.library, deps.policy).offers, held);
    if (picks.length === 0) break;
    next = { ...next, choices: [...next.choices, ...picks.map((pick) => pick.row)] };
    picked.push(...picks.map((pick) => `${pick.label}: ${pick.name}`));
  }
  return { definition: buildCharacterDefinition(next, deps.library, deps.policy), picked };
}

/** After a cast lands: each creature reincarnated into a species its sheet doesn't have yet is rebuilt as it, with all
 *  its Hit Points. A sheet that can't be rebuilt here (an import, or one in a fight) keeps the note for the GM. */
export function settleReincarnations(state: GameState, deps: RebuildDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    const marker = actor.effects.find((effect) => effect.tags.some((tag) => tag.startsWith(REINCARNATED_AS)));
    const speciesId = marker?.tags.find((tag) => tag.startsWith(REINCARNATED_AS))?.slice(REINCARNATED_AS.length);
    if (!marker || !speciesId || actor.kind !== "player-character") continue;
    // The species is applied once: the marker keeps its name as the note of what happened.
    marker.tags = marker.tags.filter((tag) => !tag.startsWith(REINCARNATED_AS));
    const species = deps.library.speciesRecord(speciesId);
    if (!species) continue;
    try {
      const rebuilt = rebuiltAs(state, actor.id, speciesId, deps);
      if (!rebuilt) continue;
      rebuildActorDefinition(state, actor.id, rebuilt.definition, deps.catalog);
      actor.hp = { ...actor.hp, current: actor.hp.maximum };
      events.push({
        kind: "effect",
        text: `${actor.name}'s sheet now has the ${species.name} traits in place of the old species'${
          rebuilt.picked.length > 0 ? ` (${rebuilt.picked.join("; ")}; the GM can change these in the Level flow)` : ""
        }.`,
        actorId: actor.id
      });
    } catch (error) {
      if (!(error instanceof CommandRejectedError)) throw error;
      events.push({
        kind: "effect",
        text: `${actor.name}'s sheet keeps its old species for now (${error.message}). The GM rebuilds it as a ${species.name}.`,
        actorId: actor.id
      });
    }
  }
  return events;
}
