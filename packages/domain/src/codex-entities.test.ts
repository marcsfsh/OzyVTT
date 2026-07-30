import { describe, expect, it } from "vitest";
import {
  CODEX_ENTITY_FIELD_KEYS, CODEX_ENTITY_TYPES, CODEX_SECRET_FIELD_KEYS,
  codexFieldKeys, isCodexEntityType, pruneCodexFields
} from "./codex-entities.js";

/**
 * This table is read by BOTH the GM editor and the server's write path, so a change here is a change to
 * what players receive. These tests exist to make that coupling loud: the secret-key set in particular
 * used to be hand-maintained on the server, and a key marked secret on one side but not the other is a
 * viewer-safety leak, not a cosmetic mismatch.
 */
describe("codex entity field table", () => {
  it("derives the secret-key set from the table rather than a hand-kept list", () => {
    // Preserves the server's previous hardcoded `new Set(["goals"])` exactly.
    expect([...CODEX_SECRET_FIELD_KEYS].sort()).toEqual(["goals"]);
    // ...and it is genuinely derived: every key marked secret anywhere is in the set.
    for (const fields of Object.values(CODEX_ENTITY_FIELD_KEYS))
      for (const field of fields) if (field.secret) expect(CODEX_SECRET_FIELD_KEYS.has(field.key)).toBe(true);
  });

  it("marks `goals` secret on exactly the two types that carry it", () => {
    const secretTypes = CODEX_ENTITY_TYPES.filter((type) => CODEX_ENTITY_FIELD_KEYS[type].some((f) => f.secret));
    expect(secretTypes).toEqual(["character", "faction"]);
  });

  it("keeps every field key a valid server slug", () => {
    // The server rejects any key failing this, so an invalid key here would be unstorable.
    for (const fields of Object.values(CODEX_ENTITY_FIELD_KEYS))
      for (const field of fields) expect(field.key).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it("prunes to the target type, dropping keys that type has no field for", () => {
    const character = { race: "Vampire", age: "400", goals: "rule Barovia" };
    expect(pruneCodexFields("character", character)).toEqual(character);   // all belong
    expect(pruneCodexFields("location", character)).toEqual({});           // none belong
    // A key shared between types survives the switch; the rest do not.
    expect(pruneCodexFields("item", { kind: "relic", race: "Vampire" })).toEqual({ kind: "relic" });
  });

  it("wipes fields when switching to `note`, which carries none — the most destructive case", () => {
    expect(CODEX_ENTITY_FIELD_KEYS.note).toEqual([]);
    expect(pruneCodexFields("note", { race: "Vampire" })).toEqual({});
  });

  it("treats an unknown or missing type as `note` rather than passing everything through", () => {
    // Falling back to "allow all" here would silently defeat pruning on a bad write.
    expect(pruneCodexFields(undefined, { race: "Vampire" })).toEqual({});
    expect(codexFieldKeys(undefined).size).toBe(0);
  });

  it("recognises exactly the declared types", () => {
    for (const type of CODEX_ENTITY_TYPES) expect(isCodexEntityType(type)).toBe(true);
    expect(isCodexEntityType("dragon")).toBe(false);
    expect(isCodexEntityType(undefined)).toBe(false);
  });
});
