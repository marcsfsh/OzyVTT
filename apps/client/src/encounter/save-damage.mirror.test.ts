import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { SaveAnswerSchema } from "../../../server/src/game-commands";
import { answerSave, createPendingSaves, type SaveAnswerDependencies } from "../../../server/src/saving-throws";
import { startEncounter } from "../../../server/src/encounter";
import { saveAnswerPayload, saveDamageAmend } from "./save-answer";

/**
 * ISSUE `4b`'s CLIENT HALF, PROVED AT THE FAR END: the number the answerer types into the save
 * prompt comes off somebody's hit points.
 *
 * The server half shipped in `a4abd8f` and is tested over HTTP in
 * `apps/server/test/typed-damage-feed.test.ts`. What NOTHING tested was the other side of the wire:
 * `SavePrompt` never sent a damage field of any kind, so the whole mechanism was reachable only by
 * an HTTP caller. This file runs the prompt's OWN payload builder (`save-answer.ts`, the module the
 * component emits from) through the server's OWN `.strict()` schema and its OWN `answerSave`, and
 * asserts hit points. A `.mirror.test.ts` for exactly that reason - the node project may import the
 * server's modules, which reach `node:sqlite` through `game-store.js`.
 *
 * The three engine outcomes, in the order they would break:
 *   1. the amended number is what lands at all;
 *   2. it lands as FIRE, so a fire-resistant target still halves it (the regression that would
 *      return the moment someone "simplifies" this to sending a bare total);
 *   3. it is halved ONCE. `damageOverride` is the PRE-halving proposal and the preview reports the
 *      POST-halving number, so a client that echoed the previewed number back as the override would
 *      quarter the damage on every successful half-on-success save. That is the whole reason the
 *      field is bound to `proposedDamage` and not to what the preview showed.
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

/** Borin's sheet, with fire resistance when the case needs it. Only the fields the damage math reads. */
const sheet = (damageResistances: readonly string[]) => ({
  abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  damageResistances: [...damageResistances],
  extensions: {}
}) as unknown as ActorDefinition;

/** A live fight with a 17-fire breath owed by Borin, exactly as `action.resolve` would have parked it. */
function tableWith(options: Readonly<{ resistant: boolean; halfOnSuccess: boolean }>) {
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.dragon, name: "Dragon", kind: "monster", visibility: "public", hp: { current: 100, maximum: 100 } },
    { id: IDS.borin, name: "Borin", kind: "player-character", visibility: "public", hp: { current: 40, maximum: 40 }, ownerSessionId: IDS.borinSession, definitionId: "borin-def" }
  ] });
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.dragon, score: 20 }, { actorId: IDS.borin, score: 12 }] }, () => 1, GEOMETRY);
  createPendingSaves(state, {
    sourceActorId: IDS.dragon, sourceName: "Dragon", actionName: "Fire Breath", ability: "dex", dc: 15,
    targetIds: [IDS.borin], proposedDamage: 17, proposedDamageParts: [{ amount: 17, type: "fire" }],
    halfOnSuccess: options.halfOnSuccess, conditionId: null, newSaveId: () => IDS.save, createdAt: 0
  });
  const definition = sheet(options.resistant ? ["fire"] : []);
  const deps = (role: "gm" | "player", sessionId: string): SaveAnswerDependencies => ({
    random: () => 1, newRollId: () => IDS.roll, sessionId, role, now: () => "2026-08-10T00:00:00.000Z",
    resolveDefinition: (id) => (id === "borin-def" ? definition : undefined)
  });
  const hp = () => state.actors.find((actor) => actor.id === IDS.borin)!.hp.current;
  return { state, deps, hp };
}

/**
 * The prompt's own gesture, end to end: what the answerer typed into the damage field, through the
 * builder `SavePrompt` emits from, through the server's `.strict()` schema (a mistyped key fails
 * here, loudly), into the engine.
 *
 * `method: "manual"` with the rolled total is what Confirm sends - the auto-rolled preview is a
 * separate, uncommitted round trip whose only job is to reveal the die.
 */
function answerFromThePrompt(
  table: ReturnType<typeof tableWith>,
  typedDamage: string | null,
  rolledTotal: number,
  who: Readonly<{ role: "gm" | "player"; sessionId: string }> = { role: "gm", sessionId: IDS.gm }
) {
  const payload = saveAnswerPayload({
    commandId: command, saveId: IDS.save, method: "manual", commit: true, total: rolledTotal,
    ...(saveDamageAmend(17, typedDamage) !== undefined ? { damageOverride: saveDamageAmend(17, typedDamage) } : {})
  });
  const request = SaveAnswerSchema.parse(payload);
  const scope = who.role === "gm" ? { role: "gm" as const } : { role: "player" as const, sessionId: who.sessionId };
  return {
    payload,
    ...answerSave(table.state, request.commandId, request.saveId, request.method, request.total, request.commit, scope,
      table.deps(who.role, who.sessionId), request.legendaryResistance, request.rollMode, request.damageOverride)
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
    expect(outcome.parts).toEqual([{ amount: 12, type: "fire", adjusted: 6, adjustment: "resistance", adjustmentSource: null }]);
  });

  it("halves the amend ONCE on a successful half-on-success save - 12 typed lands as 6, not 3", () => {
    const table = tableWith({ resistant: false, halfOnSuccess: true });
    const before = table.hp();
    // 18 vs DC 15 succeeds, so "half on a success" applies to the amended proposal.
    const { outcome } = answerFromThePrompt(table, "12", 18);
    expect(outcome.success).toBe(true);
    expect(before - table.hp()).toBe(6);
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
    answerFromThePrompt(mine, "3", 5, { role: "player", sessionId: IDS.borinSession });
    expect(before - mine.hp()).toBe(3);

    const theirs = tableWith({ resistant: false, halfOnSuccess: false });
    expect(() => answerFromThePrompt(theirs, "3", 5, { role: "player", sessionId: IDS.strangerSession }))
      // NOTE: this is `adjustableActor`'s refusal, not `saving-throws.ts:304`'s
      // "You can only amend your own character's save damage." A player who does not own the target
      // is turned away before the amend is looked at, so that later line cannot fire - see the
      // finding reported with this change. The boundary holds; the second guard is belt-and-braces.
      .toThrow(/only track your own character/);
    expect(theirs.hp(), "a refused amend still moved hit points").toBe(40);
  });

  it("is refused by the server's own bound rather than silently applying the rolled number", () => {
    // The client does NOT range-check: a fat-fingered 9999 must come back as a refusal the prompt
    // can show, never as a quiet fallback to the 17 nobody asked for. The refusal lands one step
    // earlier than `answerSave`'s own message - `SaveAnswerSchema`'s 0..1000 bound turns it away
    // before the command runs, which is the same door the HTTP and socket paths post through.
    const table = tableWith({ resistant: false, halfOnSuccess: false });
    expect(saveDamageAmend(17, "9999")).toBe(9999);
    expect(() => answerFromThePrompt(table, "9999", 5)).toThrow(/damageOverride/);
    expect(table.hp()).toBe(40);
  });
});
