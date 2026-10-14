import { describe, expect, it } from "vitest";
import { BuilderPolicySchema } from "@vtt/domain";
import { ABILITIES } from "@vtt/rules-5e";
import { buildCharacterDefinition } from "../../../server/src/character-build.js";
import { ContentLibrary } from "../../../server/src/content-library.js";
import type { BuilderCatalogs } from "../content/catalogs";
import {
  buildCreatePayload,
  computeOffers,
  emptyDraft,
  offerFilled,
  prunePicks,
  stepBlockedReason,
  type BuilderDraft,
  type BuilderOffer
} from "./build-payload";

/**
 * Runs `computeOffers` against the real content bundles for every class at six levels and checks
 * it agrees with the server's offer machinery in `character-build.ts`:
 *   1. no offer asks for more picks than it has cards (the wizard can be completed);
 *   2. a greedily answered wizard produces a payload `buildCharacterDefinition` accepts.
 * Node environment, not jsdom: the server's store needs `node:sqlite`.
 */

// With no homebrew source both audiences resolve to the same SRD catalog a real create sees.
const view = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});

/** The wizard's own catalog bundle, filled from the server's view rather than from fixtures. */
const catalogs: BuilderCatalogs = {
  choice: view.catalogChoiceCatalogs(),
  backgrounds: view.backgroundSummaries(),
  names: view.nameBundles(),
  loaded: true,
  attributions: []
};

const CLASS_IDS = view
  .classSummaries()
  .map((entry) => entry.id)
  .sort();
const LEVELS = [1, 3, 5, 11, 16, 20] as const;

/** Human + Soldier: a species whose traits ask for a skill, an origin feat and a size, and a
    background whose two granted skills collide with several classes' own skill lists. */
const SPECIES_ID = "human";
const BACKGROUND_ID = "soldier";

type FillResult = Readonly<{
  draft: BuilderDraft;
  offers: readonly BuilderOffer[];
  /** Offers whose remaining cards could not fill their capacity; reported, never thrown, so the
      failure names the offer. */
  unfillable: readonly string[];
}>;

/**
 * Answers the first unfilled offer with the first cards it still allows, until nothing is missing.
 * Deliberately simple, to walk the path the UI opens. `ability-score` picks rotate through the six
 * abilities so the 20 cap is not the thing tested.
 */
function fillGreedily(classId: string, level: number): FillResult {
  let draft: BuilderDraft = {
    ...emptyDraft(),
    name: "Mirror",
    speciesId: SPECIES_ID,
    backgroundId: BACKGROUND_ID,
    classId,
    level,
    // Standard array, straight down the six abilities, plus Soldier's legal +2/+1 spread.
    poolAssignment: Object.fromEntries(ABILITIES.map((ability, index) => [ability, `sa-${index}`])),
    backgroundBonus: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ]
  };
  const unfillable: string[] = [];
  let rotation = 0;

  const answerFor = (offer: BuilderOffer): string[] | null => {
    const usable = offer.options.filter((option) => !offer.unavailable?.[option.id]);
    if (usable.length < offer.capacity) return null;
    if (offer.kind !== "ability-score") return usable.slice(0, offer.capacity).map((option) => option.id);
    const picked = Array.from({ length: offer.capacity }, (_, index) => usable[(rotation + index) % usable.length].id);
    rotation += offer.capacity;
    return picked;
  };

  // Bounded so an offer that keeps reappearing fails the suite instead of hanging it.
  for (let guard = 0; guard < 500; guard += 1) {
    // `prunePicks` mirrors the subclass answer onto `draft.subclassId`, as the wizard does.
    draft = prunePicks(draft, computeOffers(draft, catalogs));
    const offers = computeOffers(draft, catalogs);
    const next = offers.find((offer) => !offerFilled(offer, draft) && !unfillable.includes(offer.key));
    if (!next) return { draft, offers, unfillable };
    const answer = answerFor(next);
    if (answer === null) {
      unfillable.push(next.key);
      continue;
    }
    draft = { ...draft, picks: { ...draft.picks, [next.key]: answer } };
  }
  throw new Error(`greedy fill did not settle for ${classId} ${level}`);
}

/** One fill per case, shared by both assertions below. */
const fills = new Map<string, FillResult>();
const label = (classId: string, level: number) => `${classId} L${level}`;
const fillOnce = (classId: string, level: number): FillResult => {
  const key = label(classId, level);
  const cached = fills.get(key);
  if (cached) return cached;
  const result = fillGreedily(classId, level);
  fills.set(key, result);
  return result;
};

const cases = CLASS_IDS.flatMap((classId) => LEVELS.map((level) => [classId, level] as const));

describe("the wizard's offers mirror the server's, on the real bundles", () => {
  it("sweeps every SRD class at six levels", () => {
    expect(CLASS_IDS).toEqual([
      "barbarian",
      "bard",
      "cleric",
      "druid",
      "fighter",
      "monk",
      "paladin",
      "ranger",
      "rogue",
      "sorcerer",
      "warlock",
      "wizard"
    ]);
    expect(cases).toHaveLength(72);
  });

  /**
   * `ChoiceGrid` cannot select a card twice and `repeatable` does not cross the wire, so capacity
   * above the card count is a step whose Next never enables. Checked on the settled draft: a feat's
   * own picks exist only once chosen, and gated offers are momentarily empty by design.
   */
  it.each(cases)("%s L%i offers no more picks than it has cards", (classId, level) => {
    const { offers, unfillable } = fillOnce(classId, level);
    const overfilled = offers
      .filter((offer) => offer.unresolvable === null && offer.capacity > offer.options.length)
      .map((offer) => `${offer.key} (${offer.kind}): capacity ${offer.capacity} > ${offer.options.length} card(s)`);
    expect(overfilled, `${label(classId, level)} has an unanswerable offer`).toEqual([]);
    expect(unfillable, `${label(classId, level)} has offers the player cannot fill`).toEqual([]);
  });

  /**
   * A null review reason means the wizard enables Create; `buildCharacterDefinition` not throwing
   * means the server agrees.
   */
  it.each(cases)("%s L%i completes the wizard and is accepted by the server", (classId, level) => {
    const { draft, offers } = fillOnce(classId, level);
    expect(stepBlockedReason("review", draft, catalogs, offers, policy), `${label(classId, level)} wizard`).toBeNull();
    const definition = buildCharacterDefinition(buildCreatePayload(draft, offers), view, policy);
    expect(definition.character?.classes?.[0]).toMatchObject({ id: classId, level });
  });
});
