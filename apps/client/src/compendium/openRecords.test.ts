import { describe, expect, it } from "vitest";
import { MOST_OPEN, withClosed, withOpened, type OpenRecords } from "./openRecords";

const none: OpenRecords = { keys: [], last: null, folds: { filters: null, results: false } };

describe("the open records", () => {
  it("add a record once, in the order they opened, and remember the last shown", () => {
    const one = withOpened(withOpened(none, "monster:goblin"), "spell:fireball");
    expect(one.keys).toEqual(["monster:goblin", "spell:fireball"]);
    const again = withOpened(one, "monster:goblin");
    expect(again.keys).toEqual(["monster:goblin", "spell:fireball"]);
    expect(again.last).toBe("monster:goblin");
  });

  it("keep at most eight, dropping the oldest one not shown", () => {
    let state = none;
    for (let index = 0; index < MOST_OPEN; index++) state = withOpened(state, `monster:m${index}`);
    state = withOpened(state, "spell:new");
    expect(state.keys).toHaveLength(MOST_OPEN);
    expect(state.keys).not.toContain("monster:m0");
    expect(state.keys).toContain("spell:new");
  });

  it("close to the tab beside it, or to none when it was the last", () => {
    const three = ["a:1", "a:2", "a:3"].reduce(withOpened, none);
    expect(withClosed(three, "a:2").next).toBe("a:3");
    expect(withClosed(three, "a:3").next).toBe("a:2");
    expect(withClosed(withClosed(three, "a:1").state, "a:2").state.keys).toEqual(["a:3"]);
    expect(withClosed({ ...none, keys: ["a:1"] }, "a:1").next).toBeNull();
  });
});
