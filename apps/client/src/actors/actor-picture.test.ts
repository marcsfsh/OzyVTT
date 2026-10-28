import { describe, expect, it } from "vitest";
import type { ActorDefinition, GmView } from "@vtt/domain";
import { generalAvatarFor } from "@vtt/ui";
import { badgeInitials, pictureKeyOf, pictureOf, sharedPictureBadges, visibleClasses } from "./actor-picture";

// A picture tells a viewer nothing their projection doesn't already send: classes come only from a definition the
// viewer holds, and the general pick reads the actor id, never the monster definition.

const wizard = { character: { classes: [{ id: "wizard", name: "Wizard", level: 5 }] } } as unknown as ActorDefinition;
const definitions = [{ id: "def-lyra", definition: wizard }] as unknown as GmView["definitions"];

describe("an actor's picture", () => {
  it("uses the class avatar only where the viewer holds the character's classes", () => {
    // The GM reads its own definition list; a player reads the projection's definition, when it has one.
    expect(pictureOf({ id: "lyra", definitionId: "def-lyra" }, null, definitions).fallback).toBe("class-wizard");
    expect(pictureOf({ id: "lyra", definition: wizard }, null).fallback).toBe("class-wizard");
    // Another player's character without its sheet: the general pick, as the party setting decides.
    expect(pictureOf({ id: "lyra", definitionId: "def-lyra" }, null).fallback).toBe(generalAvatarFor("lyra"));
  });

  it("puts loaded art over the default, and keeps the default while it loads", () => {
    expect(pictureOf({ id: "borin", tokenAssetId: "asset-1" }, "blob:art")).toEqual({
      src: "blob:art",
      fallback: generalAvatarFor("borin")
    });
    expect(pictureOf({ id: "borin", tokenAssetId: "asset-1" }, null).src).toBeNull();
  });

  it("never picks by monster definition: two goblins of one kind keep their own pictures", () => {
    const goblins = ["goblin-a", "goblin-b", "goblin-c", "goblin-d"].map((id) => ({ id, definitionId: "def-goblin" }));
    const fallbacks = goblins.map((goblin) => pictureOf(goblin, null, definitions).fallback);
    expect(fallbacks).toEqual(goblins.map((goblin) => generalAvatarFor(goblin.id)));
    expect(new Set(fallbacks).size).toBeGreaterThan(1);
  });

  it("reads no classes from an empty class list", () => {
    const none = { character: { classes: [] } } as unknown as ActorDefinition;
    expect(visibleClasses({ id: "x", definition: none })).toBeUndefined();
  });
});

describe("the shared-picture badge", () => {
  it("prints initials with the kind's number", () => {
    expect(badgeInitials("Goblin Warrior 2")).toBe("GW2");
    expect(badgeInitials("Lyra Emberwise")).toBe("LE");
    expect(badgeInitials("Ogre")).toBe("O");
  });

  it("marks only visible creatures that share a picture with another visible one", () => {
    const creatures = [
      { id: "a", name: "Goblin Warrior 1", tokenAssetId: "goblin-art" },
      { id: "b", name: "Goblin Warrior 2", tokenAssetId: "goblin-art" },
      { id: "c", name: "Goblin Boss", tokenAssetId: "boss-art" }
    ];
    const badges = sharedPictureBadges(creatures, (creature) => pictureKeyOf(creature));
    expect([...badges]).toEqual([
      ["a", "GW1"],
      ["b", "GW2"]
    ]);
    // With the second warrior hidden from this viewer, the first shares nothing it can see.
    expect(sharedPictureBadges(creatures.slice(0, 1), (creature) => pictureKeyOf(creature)).size).toBe(0);
  });
});
