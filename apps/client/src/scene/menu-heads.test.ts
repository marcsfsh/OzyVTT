import { describe, expect, it } from "vitest";
import type { GmActor, PlayerActor } from "@vtt/domain";
import { tokenLine } from "./TokenContextMenu";
import { doorSummary } from "./DoorMenu";

// The token's and the door's menus open with the thing's name and its line (theme rule 15).

describe("a token menu's line", () => {
  it("names the kind and, where the viewer has exact hit points, how many", () => {
    const gmGoblin = { kind: "monster", hp: { current: 15, maximum: 21 } } as unknown as GmActor;
    expect(tokenLine(gmGoblin)).toBe("Monster · 15/21");
  });

  it("shows only the kind when the projection gives a band", () => {
    const seenByPlayer = { kind: "monster", hp: { kind: "band", band: "bloodied" } } as unknown as PlayerActor;
    expect(tokenLine(seenByPlayer)).toBe("Monster");
  });
});

describe("a door menu's line", () => {
  it("is the door's fastenings and object stats, for the GM", () => {
    expect(doorSummary({ door: { fastenings: [] }, object: undefined } as never)).toBe("AC 15 · 18 HP");
  });
});
