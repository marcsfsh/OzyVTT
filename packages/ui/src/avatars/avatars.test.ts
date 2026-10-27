import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  avatarHash,
  avatarUrl,
  CLASS_AVATARS,
  classAvatarFor,
  defaultAvatarFor,
  GENERAL_AVATARS,
  generalAvatarFor
} from "./index";

// The pick is part of a creature's identity at the table: an actor keeps its picture, so the order and the hash are
// locked here. The expected values were computed outside this code, from the same FNV-1a definition.

describe("the default avatars", () => {
  it("keep the nineteen general avatars in their fixed order, with Static left out", () => {
    expect(GENERAL_AVATARS).toEqual(
      "horizon moonrise palm d20 blades claws orbit pyramid bolt cassette shades joystick gem flame waves pines horns paw vortex".split(
        " "
      )
    );
    expect(GENERAL_AVATARS).not.toContain("static");
  });

  it("have a file for every general, class and reserved avatar, and no file without an id", () => {
    const files = readdirSync(`${process.cwd()}/src/avatars`).filter((name) => name.endsWith(".svg"));
    const ids = [...GENERAL_AVATARS, ...CLASS_AVATARS.map((id) => `class-${id}`), "static"];
    expect(files.map((name) => name.replace(/\.svg$/, "")).sort()).toEqual([...ids].sort());
    // The bundler inlines a small SVG as a data URL and links a larger one by file; either way each id is its own.
    const urls = ids.map((id) => avatarUrl(id as never));
    for (const [index, url] of urls.entries())
      expect(url, ids[index]).toMatch(new RegExp(`^data:image/svg\\+xml|${ids[index]}(-[\\w]+)?\\.svg$`));
    expect(new Set(urls).size).toBe(ids.length);
  });

  it("hash an actor id's UTF-16 code units with unsigned FNV-1a, unnormalized", () => {
    expect(avatarHash("")).toBe(2166136261);
    expect(avatarHash("a")).toBe(3826002220);
    expect(avatarHash("actor-1")).toBe(4272952780);
    expect(avatarHash("é")).toBe(1812687940);
    expect(avatarHash("\u{1F600}x")).toBe(2673392192);
    // Precomposed and decomposed forms are different ids, so they keep different pictures.
    expect(avatarHash("é")).not.toBe(avatarHash("é"));
  });

  it("pick a general avatar by actor id", () => {
    expect(generalAvatarFor("actor-1")).toBe("joystick");
    expect(generalAvatarFor("8f14e45f-ceea-467a-9b2f-5a1c3d2b7e10")).toBe("waves");
    expect(generalAvatarFor("goblin")).toBe("horizon");
    expect(generalAvatarFor("Lyra")).toBe("pines");
  });

  it("give a character its main class's avatar: the most levels, the first taken on a tie", () => {
    expect(classAvatarFor([{ id: "fighter", level: 7 }])).toBe("class-fighter");
    expect(
      classAvatarFor([
        { id: "rogue", level: 2 },
        { id: "wizard", level: 5 }
      ])
    ).toBe("class-wizard");
    expect(
      classAvatarFor([
        { id: "cleric", level: 3 },
        { id: "paladin", level: 3 }
      ])
    ).toBe("class-cleric");
    expect(classAvatarFor([])).toBeNull();
  });

  it("fall back to the general pick for a homebrew main class or no classes", () => {
    expect(classAvatarFor([{ id: "gunslinger", level: 5 }])).toBeNull();
    expect(defaultAvatarFor("actor-1", [{ id: "gunslinger", level: 5 }])).toBe("joystick");
    expect(defaultAvatarFor("actor-1")).toBe("joystick");
    expect(defaultAvatarFor("actor-1", [{ id: "bard", level: 1 }])).toBe("class-bard");
  });
});
