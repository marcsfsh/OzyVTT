import { describe, expect, it } from "vitest";
import { homebrewIdProblem, isMintedHomebrewId, mintHomebrewId } from "../src/homebrew-ids.js";

// A monster's id reaches players (`Actor.definitionId` is on every public token), so monster ids are
// opaque (`hb-m-<12hex>`) while builder ids are name-derived. The predicates must be per type: a
// monster id shaped like a builder id would skip re-minting and leak the creature's name.
describe("homebrew id shapes are per type, in both directions", () => {
  const NAME_DERIVED = "hb-acererak-the-devourer-9f9f9f";
  const OPAQUE = "hb-m-0123456789ab";

  it("refuses a name-derived id for a monster", () => {
    expect(isMintedHomebrewId(NAME_DERIVED, "monster")).toBe(false);
    expect(homebrewIdProblem(NAME_DERIVED, "monster")).toMatch(/opaque/);
  });

  it("accepts that same id for a builder type: the shape is legal, the TYPE is what differs", () => {
    expect(isMintedHomebrewId(NAME_DERIVED, "class")).toBe(true);
    expect(homebrewIdProblem(NAME_DERIVED, "class")).toBeNull();
  });

  it("refuses an opaque monster id for a builder type, so one shape never serves two purposes", () => {
    expect(isMintedHomebrewId(OPAQUE, "class")).toBe(false);
  });

  it('accepts a builder id that merely STARTS like a monster\'s - a class named "M" is not a monster', () => {
    // `hb-m-` alone is not proof of a monster: a class named "M copy" mints `hb-m-copy-<6hex>`. The
    // shapes cannot overlap because a builder suffix is 6 or 8 hex and a monster's is 12.
    const minted = mintHomebrewId("class", "M copy", () => false);
    expect(minted).toMatch(/^hb-m-copy-[0-9a-f]{6}$/);
    expect(isMintedHomebrewId(minted, "class")).toBe(true);
    expect(isMintedHomebrewId("hb-m-copy-60a055", "class")).toBe(true);
    expect(homebrewIdProblem("hb-m-copy-60a055", "class")).toBeNull();
    // A bare "M" mints `hb-m-<6hex>`, which still is not the 12-hex monster shape.
    const bare = mintHomebrewId("class", "M", () => false);
    expect(isMintedHomebrewId(bare, "class")).toBe(true);
    expect(isMintedHomebrewId(bare, "monster")).toBe(false);
  });

  it("accepts the opaque shape for a monster", () => {
    expect(isMintedHomebrewId(OPAQUE, "monster")).toBe(true);
    expect(homebrewIdProblem(OPAQUE, "monster")).toBeNull();
  });

  it("mints the right shape per type", () => {
    const monster = mintHomebrewId("monster", "Acererak the Devourer", () => false);
    expect(monster).toMatch(/^hb-m-[0-9a-f]{12}$/);
    // The name must not be recoverable from an opaque id.
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
