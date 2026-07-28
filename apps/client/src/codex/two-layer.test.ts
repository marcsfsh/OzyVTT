import { describe, expect, it } from "vitest";
import { splitEntityFields, entityDef, ENTITY_DEFS } from "./entities";

/**
 * CF-5 coverage area 1 of 3: **two-layer secrecy**, client half.
 *
 * The decision log records three layers of enforcement for secret entity fields: the client routes
 * `secret: true` fields into `gmFields` on save, the SERVER re-seals `SECRET_FIELD_KEYS` on every write,
 * and a migration backfilled existing rows. The server half is covered by `codex-store.test.ts` /
 * `codex-http.test.ts`. This file guards the *client* half — `splitEntityFields`, which is what
 * `PageEditor` calls before every autosave.
 *
 * Why it matters: if this split regresses, a villain's secret motives are sent in the player-facing
 * `fields` map. The server's re-seal is the backstop, but that backstop only covers keys it knows about
 * (`SECRET_FIELD_KEYS`), so client and server must agree.
 */
describe("two-layer secrecy — client field split", () => {
  it("routes a secret-schema field into gmFields and leaves public ones in fields", () => {
    const { fields, gmFields } = splitEntityFields("character", {
      race: "Human", location: "Barovia", goals: "Betray the party at the gate"
    });
    expect(fields).toEqual({ race: "Human", location: "Barovia" });
    expect(gmFields).toEqual({ goals: "Betray the party at the gate" });
    // The player-facing half must not contain the secret value anywhere.
    expect(JSON.stringify(fields)).not.toContain("Betray");
  });

  it("keeps every field public for a type that declares no secrets", () => {
    const { fields, gmFields } = splitEntityFields("note", { anything: "value" });
    expect(gmFields).toEqual({});
    expect(fields).toEqual({ anything: "value" });
  });

  it("splits by the CURRENT type's schema, so a shared key can be secret for one type and not another", () => {
    // `goals` is secret on both character and faction; this pins the behaviour rather than assuming it.
    for (const type of ["character", "faction"] as const) {
      const { fields, gmFields } = splitEntityFields(type, { goals: "x" });
      expect(gmFields, `${type} must treat goals as secret`).toEqual({ goals: "x" });
      expect(fields).toEqual({});
    }
  });

  it("every entity type that declares a secret field can round-trip it out of the player-facing map", () => {
    // Guards the whole vocabulary at once: adding a new secret field to any type keeps this honest.
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
