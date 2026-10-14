import { describe, expect, it } from "vitest";
import { splitEntityFields, entityDef, ENTITY_DEFS } from "./entities";

/**
 * The client half of field secrecy: `splitEntityFields` routes secret fields into `gmFields` before every
 * save. The server re-seals only the keys it knows, so the two must agree.
 */
describe("two-layer secrecy — client field split", () => {
  it("routes a secret-schema field into gmFields and leaves public ones in fields", () => {
    const { fields, gmFields } = splitEntityFields("character", {
      race: "Human", location: "Barovia", goals: "Betray the party at the gate"
    });
    expect(fields).toEqual({ race: "Human", location: "Barovia" });
    expect(gmFields).toEqual({ goals: "Betray the party at the gate" });
    // The player-facing half must not contain the secret value.
    expect(JSON.stringify(fields)).not.toContain("Betray");
  });

  it("keeps every field public for a type that declares no secrets", () => {
    const { fields, gmFields } = splitEntityFields("note", { anything: "value" });
    expect(gmFields).toEqual({});
    expect(fields).toEqual({ anything: "value" });
  });

  it("splits by the CURRENT type's schema, so a shared key can be secret for one type and not another", () => {
    // `goals` is secret on both character and faction.
    for (const type of ["character", "faction"] as const) {
      const { fields, gmFields } = splitEntityFields(type, { goals: "x" });
      expect(gmFields, `${type} must treat goals as secret`).toEqual({ goals: "x" });
      expect(fields).toEqual({});
    }
  });

  it("every entity type that declares a secret field can round-trip it out of the player-facing map", () => {
    // Covers every type's secret fields at once.
    const typesWithSecrets = (Object.keys(ENTITY_DEFS) as Array<keyof typeof ENTITY_DEFS>)
      .filter((type) => entityDef(type).fields.some((field) => field.secret));
    expect(typesWithSecrets.length).toBeGreaterThan(0);
    for (const type of typesWithSecrets) {
      const secretKeys = entityDef(type).fields.filter((field) => field.secret).map((field) => field.key);
      const values = Object.fromEntries(secretKeys.map((key) => [key, "SECRETVALUE"]));
      const { fields, gmFields } = splitEntityFields(type, values);
      expect(fields, `${type} leaked a secret field into the player map`).toEqual({});
      expect(Object.keys(gmFields).sort()).toEqual([...secretKeys].sort());
    }
  });
});
