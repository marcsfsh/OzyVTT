import { describe, expect, it } from "vitest";
import { codexDefaultHiddenFields } from "@vtt/domain";
import { ENTITY_DEFS, entityDef } from "./entities";

/**
 * The fields a new page starts with Hidden come from one table in `@vtt/domain`. The client marks the same ones,
 * so the editor never presents a field as shown to everyone that the server keeps Hidden.
 */
describe("fields Hidden by default", () => {
  it("marks exactly the keys the server starts Hidden, on every kind", () => {
    for (const type of Object.keys(ENTITY_DEFS) as Array<keyof typeof ENTITY_DEFS>) {
      const marked = entityDef(type)
        .fields.filter((field) => field.secret)
        .map((field) => field.key);
      expect(marked, type).toEqual(codexDefaultHiddenFields(type));
    }
  });
});
