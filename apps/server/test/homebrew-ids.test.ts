import { describe, expect, it } from "vitest";
import { homebrewIdProblem, isMintedHomebrewId, mintHomebrewId } from "../src/homebrew-ids.js";

/**
 * A monster's id is the one that reaches PLAYERS. `Actor.definitionId` is not stripped by
 * `PlayerActor`'s `Omit`, so every public token carries its definition id to every client - which is
 * why a monster id is opaque (`hb-m-<12hex>`) while a builder id is name-derived.
 *
 * These two predicates were type-BLIND. A monster id shaped like a builder id
 * (`hb-acererak-the-devourer-9f9f9f`) was accepted as one of ours, so pack import skipped
 * re-minting, the publish gate never re-checked it, and `normalizeBody` then forced it onto
 * `source.externalId`. A QA pass reproduced the whole chain end to end: import, publish, rename the
 * record to "Robed Figure", drop a public token - and the player's own snapshot spelled out the
 * creature's real name before anyone had met it.
 */
describe("homebrew id shapes are per type, in both directions", () => {
  const NAME_DERIVED = "hb-acererak-the-devourer-9f9f9f";
  const OPAQUE = "hb-m-0123456789ab";

  it("refuses a name-derived id for a monster", () => {
    expect(isMintedHomebrewId(NAME_DERIVED, "monster")).toBe(false);
    expect(homebrewIdProblem(NAME_DERIVED, "monster")).toMatch(/opaque/);
  });

  it("accepts that same id for a builder type - the shape is legal, the TYPE is what differs", () => {
    expect(isMintedHomebrewId(NAME_DERIVED, "class")).toBe(true);
    expect(homebrewIdProblem(NAME_DERIVED, "class")).toBeNull();
  });

  it("refuses an opaque monster id for a builder type, so one shape never serves two purposes", () => {
    expect(isMintedHomebrewId(OPAQUE, "class")).toBe(false);
  });

  it("accepts the opaque shape for a monster", () => {
    expect(isMintedHomebrewId(OPAQUE, "monster")).toBe(true);
    expect(homebrewIdProblem(OPAQUE, "monster")).toBeNull();
  });

  it("mints the right shape per type", () => {
    const monster = mintHomebrewId("monster", "Acererak the Devourer", () => false);
    expect(monster).toMatch(/^hb-m-[0-9a-f]{12}$/);
    // The point of the opaque id: the name must not be recoverable from it.
    expect(monster).not.toContain("acererak");
    expect(isMintedHomebrewId(monster, "monster")).toBe(true);

    const klass = mintHomebrewId("class", "Blood Hunter", () => false);
    expect(klass).toMatch(/^hb-blood-hunter-[0-9a-f]{6}$/);
    expect(isMintedHomebrewId(klass, "class")).toBe(true);
  });

  it("keeps every id inside the persisted 60-character budget", () => {
    const long = mintHomebrewId("class", "A".repeat(200), () => false);
    expect(long.length).toBeLessThanOrEqual(60);
  });
});
