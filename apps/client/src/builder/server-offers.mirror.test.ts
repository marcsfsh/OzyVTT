import { describe, expect, it } from "vitest";
import { BuilderPolicySchema } from "@vtt/domain";
import { ABILITIES } from "@vtt/rules-5e";
import { buildCharacterDefinition } from "../../../server/src/character-build.js";
import { ContentLibrary } from "../../../server/src/content-library.js";
import type { BuilderCatalogs } from "../content/catalogs";
import {
  buildCreatePayload, computeOffers, emptyDraft, offerFilled, prunePicks, stepBlockedReason,
  type BuilderDraft, type BuilderOffer
} from "./build-payload";

/**
 * THE WIZARD AND THE SERVER, ON THE REAL BUNDLES - the mirror check.
 *
 * `computeOffers` is a re-implementation of `character-build.ts`'s offer machinery, and the whole
 * design rests on the two agreeing: this side decides what the player may pick, the server
 * re-validates it, and a divergence is always a bug the player pays for - either a wizard that
 * cannot be finished, or a finished wizard the server refuses at the last button.
 *
 * Every other offer test in this repo drives `computeOffers` with HAND-WRITTEN
 * `ContentClassSummary` fixtures and never touches a bundle. That is exactly why two divergences
 * shipped, in opposite directions, from one shared root cause - the repeat-grant rule:
 *
 *   1. N grants of one chosen feat collapsed into ONE client offer of capacity `choose x N` while
 *      the server minted N offers of capacity `choose`. `ChoiceGrid` is a checkbox group and
 *      `repeatable` does not cross the wire, so four Ability Score Improvement feats asked for 8
 *      picks against 6 ability cards and Next could never enable;
 *   2. a class feature granted at two levels became TWO client offers sharing one option list while
 *      the server minted ONE of capacity 4 that refuses a repeated id - so Bard 9+, Rogue 6+ and
 *      Sorcerer 10+ produced payloads the server rejected at Create.
 *
 * So this file drives the REAL catalogs (`ContentLibrary().forAudience("gm")` - the same view the
 * command handler passes to `buildCharacterDefinition`) across every class at six levels, and
 * asserts the two things a fixture can never see:
 *
 *   1. **no offer asks for more picks than it has cards** - the shape `ChoiceGrid` can actually
 *      answer, which is what "the wizard can be completed" reduces to;
 *   2. **a greedily-answered wizard produces a payload the SERVER accepts** - the far end, run
 *      through `buildCharacterDefinition` itself rather than a stand-in.
 *
 * Node environment, not jsdom: this imports the server's own modules, and the server's store reaches
 * for `node:sqlite` (see `vitest.config.ts`, the "node" project).
 */

// `buildCharacterDefinition` takes an audience-scoped view; with no homebrew source both audiences
// resolve to the same SRD-only catalog, so this is the exact catalog a real create sees.
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

const CLASS_IDS = view.classSummaries().map((entry) => entry.id).sort();
const LEVELS = [1, 3, 5, 11, 16, 20] as const;

/** Human + Soldier: a species whose traits ask for a skill, an origin feat and a size, and a
    background whose two granted skills collide with several classes' own skill lists. */
const SPECIES_ID = "human";
const BACKGROUND_ID = "soldier";

type FillResult = Readonly<{
  draft: BuilderDraft;
  offers: readonly BuilderOffer[];
  /** Offers whose remaining cards could not fill their capacity - reported, never thrown, so the
      failure names the offer instead of timing out. */
  unfillable: readonly string[];
}>;

/**
 * THE PLAYER, PLAYED GREEDILY - answer the first unfilled offer with the first cards it still
 * allows, and repeat until the wizard says nothing is missing.
 *
 * Deliberately dumb: a smarter chooser would be a second rules engine, and the point is to walk
 * exactly the path the UI opens. The one concession is ability rotation - `ability-score` picks step
 * through the six abilities rather than stacking twelve points on Strength - because that is the
 * build a player actually makes, and the 20 ceiling is the sheet's rule rather than the offer's.
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
    backgroundBonus: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }]
  };
  const unfillable: string[] = [];
  let rotation = 0;

  const answerFor = (offer: BuilderOffer): string[] | null => {
    const usable = offer.options.filter((option) => !(offer.unavailable?.[option.id]));
    if (usable.length < offer.capacity) return null;
    if (offer.kind !== "ability-score") return usable.slice(0, offer.capacity).map((option) => option.id);
    const picked = Array.from({ length: offer.capacity }, (_, index) => usable[(rotation + index) % usable.length].id);
    rotation += offer.capacity;
    return picked;
  };

  // Bounded rather than `while (true)`: an offer that keeps re-appearing unanswered should fail the
  // suite, not hang it. Every level-20 build settles in well under this.
  for (let guard = 0; guard < 500; guard += 1) {
    // `prunePicks` is what mirrors the subclass answer onto `draft.subclassId`, exactly as the wizard
    // does on every offer change, so the payload carries the top-level id the server expects.
    draft = prunePicks(draft, computeOffers(draft, catalogs));
    const offers = computeOffers(draft, catalogs);
    const next = offers.find((offer) => !offerFilled(offer, draft) && !unfillable.includes(offer.key));
    if (!next) return { draft, offers, unfillable };
    const answer = answerFor(next);
    if (answer === null) { unfillable.push(next.key); continue; }
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
      "barbarian", "bard", "cleric", "druid", "fighter", "monk",
      "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"
    ]);
    expect(cases).toHaveLength(72);
  });

  /**
   * NO OFFER MAY ASK FOR MORE PICKS THAN IT HAS CARDS.
   *
   * `ChoiceGrid` is a checkbox group - a card cannot be selected twice - and `repeatable` lives on
   * `ContentFeatSummary` but NOT on `ContentFeatureChoiceSummary`, so it never crosses the wire. A
   * client offer is therefore always effectively non-repeatable, and `offerFilled` is an equality
   * check: capacity above the card count is a step whose Next can never enable, saying "6 of 8
   * chosen" with every card already selected and no way forward.
   *
   * Read off the SETTLED draft, not an empty one, for two reasons: a feat's own picks only exist
   * once the feat is chosen (which is precisely where divergence 1 lives), and an offer whose
   * options are still gated on an unanswered earlier pick is momentarily empty by design - the
   * wizard resolves it as the player works down the step, and asserting on the pristine draft would
   * flag that transient state as a defect.
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
   * THE FAR END: a greedily-answered wizard is a build the SERVER accepts.
   *
   * `stepBlockedReason("review", ...)` returning null is the wizard saying Create is live;
   * `buildCharacterDefinition` not throwing is the server agreeing. The two divergences this file
   * exists for fail one line each, in opposite directions, so both are asserted rather than only
   * the payload.
   */
  it.each(cases)("%s L%i completes the wizard and is accepted by the server", (classId, level) => {
    const { draft, offers } = fillOnce(classId, level);
    expect(stepBlockedReason("review", draft, catalogs, offers, policy), `${label(classId, level)} wizard`).toBeNull();
    const definition = buildCharacterDefinition(buildCreatePayload(draft, offers), view, policy);
    expect(definition.character?.classes?.[0]).toMatchObject({ id: classId, level });
  });
});
