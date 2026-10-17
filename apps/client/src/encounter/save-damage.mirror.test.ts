import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { SaveAnswerSchema } from "@vtt/domain/commands";
import { answerSave, createPendingSaves, type SaveAnswerDependencies } from "../../../server/src/saving-throws";
import { startEncounter } from "../../../server/src/encounter";
import { saveAnswerPayload, saveDamageAmend } from "./save-answer";

/**
 * The number typed into the save prompt's damage field is what comes off hit points. Runs the
 * prompt's payload builder (`save-answer.ts`) through the server's `.strict()` schema and its
 * `answerSave`, and asserts hit points:
 *   1. the amended number is what lands;
 *   2. it lands as fire, so a fire-resistant target still halves it;
 *   3. it is halved once: `damageOverride` is the pre-halving proposal, so echoing the previewed
 *      (post-halving) number back would quarter the damage on a successful half-on-success save.
 * A `.mirror.test.ts` so the node project can import server modules (`node:sqlite`).
 */

const IDS = {
  dragon: "10000000-0000-4000-8000-000000000001",
  borin: "10000000-0000-4000-8000-000000000002",
  borinSession: "30000000-0000-4000-8000-000000000001",
  strangerSession: "30000000-0000-4000-8000-000000000002",
  gm: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001",
  save: "60000000-0000-4000-8000-000000000001",
  roll: "40000000-0000-4000-8000-000000000000"
} as const;
const command = "50000000-0000-4000-8000-000000000001";
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

/** Borin's sheet, fire-resistant when the case needs it. Only the fields the damage maths reads. */
const sheet = (damageResistances: readonly string[]) =>
  ({
    abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    damageResistances: [...damageResistances],
    extensions: {}
  }) as unknown as ActorDefinition;

/**
 * A live fight with a 17-damage breath owed by Borin, as `action.resolve` would park it. `parts`
 * defaults to one fire component; with two, per-part halving stops matching `floor(total / 2)`.
 */
function tableWith(
  options: Readonly<{
    resistant: boolean;
    halfOnSuccess: boolean;
    parts?: ReadonlyArray<{ amount: number; type: string }>;
  }>
) {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: IDS.dragon, name: "Dragon", kind: "monster", visibility: "public", hp: { current: 100, maximum: 100 } },
      {
        id: IDS.borin,
        name: "Borin",
        kind: "player-character",
        visibility: "public",
        hp: { current: 40, maximum: 40 },
        ownerSessionId: IDS.borinSession,
        definitionId: "borin-def"
      }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.dragon, score: 20 },
        { actorId: IDS.borin, score: 12 }
      ]
    },
    () => 1,
    GEOMETRY
  );
  createPendingSaves(state, {
    sourceActorId: IDS.dragon,
    sourceName: "Dragon",
    actionName: "Fire Breath",
    ability: "dex",
    dc: 15,
    targetIds: [IDS.borin],
    proposedDamage: 17,
    proposedDamageParts: [...(options.parts ?? [{ amount: 17, type: "fire" }])],
    halfOnSuccess: options.halfOnSuccess,
    conditionIds: [],
    newSaveId: () => IDS.save,
    createdAt: 0
  });
  const definition = sheet(options.resistant ? ["fire"] : []);
  const deps = (role: "gm" | "player", sessionId: string): SaveAnswerDependencies => ({
    random: () => 1,
    newRollId: () => IDS.roll,
    sessionId,
    role,
    now: () => "2026-08-10T00:00:00.000Z",
    resolveDefinition: (id) => (id === "borin-def" ? definition : undefined)
  });
  const hp = () => state.actors.find((actor) => actor.id === IDS.borin)!.hp.current;
  return { state, deps, hp };
}

/**
 * The prompt's gesture end to end: the typed damage, through `SavePrompt`'s builder and the server's
 * `.strict()` schema, into the engine. A number is the GM's ruled total (`method: "manual"`); `{ face }` is
 * the d20 a player's physical die shows, to which the server adds the bonus (Borin's Dex save is +2).
 */
function answerFromThePrompt(
  table: ReturnType<typeof tableWith>,
  typedDamage: string | null,
  rolled: number | Readonly<{ face: number }>,
  who: Readonly<{ role: "gm" | "player"; sessionId: string }> = { role: "gm", sessionId: IDS.gm },
  commit = true
) {
  const payload = {
    commandId: command,
    ...saveAnswerPayload({
      saveId: IDS.save,
      ...(typeof rolled === "number" ? { method: "manual", total: rolled } : { method: "roll", face: rolled.face }),
      commit,
      ...(saveDamageAmend(17, typedDamage) !== undefined ? { damageOverride: saveDamageAmend(17, typedDamage) } : {})
    })
  };
  const request = SaveAnswerSchema.parse(payload);
  const scope = who.role === "gm" ? { role: "gm" as const } : { role: "player" as const, sessionId: who.sessionId };
  return {
    payload,
    ...answerSave(
      table.state,
      request.commandId,
      request.saveId,
      request.method,
      request.total,
      request.commit,
      scope,
      table.deps(who.role, who.sessionId),
      request.legendaryResistance,
      request.rollMode,
      request.damageOverride,
      request.face !== undefined ? { face: request.face } : {}
    )
  };
}

describe("the save prompt's damage field", () => {
  it("takes 3 off the target when the answerer types 3 over a proposal of 17", () => {
    const table = tableWith({ resistant: false, halfOnSuccess: false });
    const before = table.hp();
    // 5 vs DC 15 is a clean failure: the full amended proposal applies.
    const { outcome, payload } = answerFromThePrompt(table, "3", 5);
    expect(payload.damageOverride, "the prompt sent no amend").toBe(3);
    expect(before - table.hp()).toBe(3);
    expect(outcome.appliedDamage).toBe(3);
    expect(table.state.combat.pendingSaves).toHaveLength(0);
  });

  it("amends the number without untyping it - 12 typed against fire resistance lands as 6", () => {
    const table = tableWith({ resistant: true, halfOnSuccess: false });
    const before = table.hp();
    const { outcome } = answerFromThePrompt(table, "12", 5);
    expect(before - table.hp()).toBe(6);
    expect(outcome.parts).toEqual([
      { amount: 12, type: "fire", adjusted: 6, adjustment: "resistance", adjustmentSource: null }
    ]);
  });

  it("halves the amend ONCE on a successful half-on-success save - 12 typed lands as 6, not 3", () => {
    const table = tableWith({ resistant: false, halfOnSuccess: true });
    const before = table.hp();
    // 18 vs DC 15 succeeds, so "half on a success" applies to the amended proposal.
    const { outcome } = answerFromThePrompt(table, "12", 18);
    expect(outcome.success).toBe(true);
    expect(before - table.hp()).toBe(6);
  });

  /**
   * What `SavePrompt` prints after an amend: it re-asks the server with Confirm's payload and
   * `commit: false`. These are the server's own answers, the numbers `save-damage.test.tsx` shows.
   */
  it("answers an uncommitted recheck with the number the commit will apply, and applies nothing", () => {
    const table = tableWith({ resistant: false, halfOnSuccess: true });
    const { outcome } = answerFromThePrompt(table, "12", 18, { role: "gm", sessionId: IDS.gm }, false);
    expect(outcome.committed).toBe(false);
    expect(outcome.appliedDamage).toBe(6);
    // A recheck moves no hit points and the save is still owed.
    expect(table.hp()).toBe(40);
    expect(table.state.combat.pendingSaves).toHaveLength(1);
    // The commit lands exactly the number the recheck projected.
    expect(40 - answerFromThePrompt(table, "12", 18).outcome.appliedDamage).toBe(34);
    expect(table.hp()).toBe(34);
  });

  /** The preview weighs the damage through the target's defences, so a resistant target sees what it will lose. */
  it("projects the post-defence number on a recheck, which is what the commit applies", () => {
    const table = tableWith({ resistant: true, halfOnSuccess: true });
    // 18 vs DC 15 succeeds, so 12 halves to 6; the target is fire-resistant, so 6 lands as 3.
    const preview = answerFromThePrompt(table, "12", 18, { role: "gm", sessionId: IDS.gm }, false);
    expect(preview.outcome.committed).toBe(false);
    expect(preview.outcome.appliedDamage).toBe(3);
    expect(preview.outcome.parts).toEqual([
      { amount: 6, type: "fire", adjusted: 3, adjustment: "resistance", adjustmentSource: null }
    ]);
    expect(table.hp()).toBe(40);

    const committed = answerFromThePrompt(table, "12", 18);
    expect(committed.outcome.appliedDamage).toBe(3);
    expect(40 - table.hp()).toBe(3);
  });

  it("answers a TWO-TYPE save with 4 for an amended 12 against fire resistance: halved once, then resisted", () => {
    // 9 fire + 8 cold: `rescaleDamageParts` re-weights 12 as 7 + 5, the success halves the total once to 6
    // (4 fire + 2 cold, SRD Half Damage), and the fire is resisted: 2 + 2 = 4. `save-damage.test.tsx` renders
    // this fixture.
    const table = tableWith({
      resistant: true,
      halfOnSuccess: true,
      parts: [
        { amount: 9, type: "fire" },
        { amount: 8, type: "cold" }
      ]
    });
    const { outcome } = answerFromThePrompt(table, "12", 18, { role: "gm", sessionId: IDS.gm }, false);
    expect(outcome.appliedDamage).toBe(4);
    expect(Math.floor(12 / 2), "the fixture stopped distinguishing the server's number").not.toBe(4);
    // And the commit lands the same 4, per type.
    const committed = answerFromThePrompt(table, "12", 18);
    expect(committed.outcome.parts).toEqual([
      { amount: 4, type: "fire", adjusted: 2, adjustment: "resistance", adjustmentSource: null },
      { amount: 2, type: "cold", adjusted: 2, adjustment: null, adjustmentSource: null }
    ]);
    expect(40 - table.hp()).toBe(4);
  });

  it("answers the recheck with ZERO on a success that does not halve: the case the old line got most wrong", () => {
    const table = tableWith({ resistant: false, halfOnSuccess: false });
    const { outcome } = answerFromThePrompt(table, "12", 18, { role: "gm", sessionId: IDS.gm }, false);
    expect(outcome.success).toBe(true);
    expect(outcome.appliedDamage).toBe(0);
    expect(table.hp()).toBe(40);
  });

  it("sends nothing at all when the field is untouched, cleared, or retyped to the same number", () => {
    for (const typed of [null, "", "   ", "17"]) {
      const table = tableWith({ resistant: false, halfOnSuccess: false });
      const before = table.hp();
      const { payload } = answerFromThePrompt(table, typed, 5);
      expect("damageOverride" in payload, `an untouched field sent an amend for ${JSON.stringify(typed)}`).toBe(false);
      expect(before - table.hp(), `the rolled proposal did not land for ${JSON.stringify(typed)}`).toBe(17);
    }
  });

  it("takes a typed 0 as an amend to none, which is not the same as leaving the field empty", () => {
    const table = tableWith({ resistant: false, halfOnSuccess: false });
    const before = table.hp();
    const { payload } = answerFromThePrompt(table, "0", 5);
    expect(payload.damageOverride).toBe(0);
    expect(before - table.hp()).toBe(0);
  });

  it("lets the owner amend their own save and refuses the stranger who tries", () => {
    const mine = tableWith({ resistant: false, halfOnSuccess: false });
    const before = mine.hp();
    // A d20 of 3 makes 5 against DC 15: a failure, so the amended 3 lands whole.
    answerFromThePrompt(mine, "3", { face: 3 }, { role: "player", sessionId: IDS.borinSession });
    expect(before - mine.hp()).toBe(3);

    const theirs = tableWith({ resistant: false, halfOnSuccess: false });
    expect(() => answerFromThePrompt(theirs, "3", { face: 3 }, { role: "player", sessionId: IDS.strangerSession }))
      // The ownership boundary: `adjustableActor` turns a player away from someone else's target before
      // the amend is considered.
      .toThrow(/only track your own character/);
    expect(theirs.hp(), "a refused amend still moved hit points").toBe(40);
  });

  it("is refused IN WORDS by the server's own bound rather than silently applying the rolled number", () => {
    // The client does not range-check: 9999 must come back as a refusal the prompt can show, never a
    // silent fallback to 17. `SaveAnswerSchema`'s 0..1000 bound refuses it before the command runs.
    const table = tableWith({ resistant: false, halfOnSuccess: false });
    expect(saveDamageAmend(17, "9999")).toBe(9999);

    // Assert the message and leave the path alone: `save.answer` surfaces `issues[0].message` verbatim
    // (`issueMessage`, apps/server/src/commands/saves.ts).
    for (const typed of ["9999", "1001"]) {
      const refusal = SaveAnswerSchema.safeParse({
        commandId: command,
        ...saveAnswerPayload({
          saveId: IDS.save,
          method: "manual",
          commit: true,
          total: 5,
          damageOverride: saveDamageAmend(17, typed)
        })
      });
      expect(refusal.success, `${typed} was accepted`).toBe(false);
      expect(refusal.error!.issues[0].message).toBe("Enter the damage as a whole number from 0 to 1000.");
    }
    // 1000 is inside the bound, so the sentence is a refusal and not a wall.
    expect(
      SaveAnswerSchema.safeParse({
        commandId: command,
        ...saveAnswerPayload({
          saveId: IDS.save,
          method: "manual",
          commit: true,
          total: 5,
          damageOverride: 1000
        })
      }).success
    ).toBe(true);

    expect(() => answerFromThePrompt(table, "9999", 5)).toThrow();
    expect(table.hp()).toBe(40);
  });
});
