import type { GameState } from "@vtt/domain";
import { ABILITY_ROLL_FORMULA, parseDiceFormula, resolveDice, validateAbilityFormula } from "@vtt/rules-5e";
import { ActorDefinitionSchema } from "@vtt/schemas";
import {
  importActorDefinition,
  rebuildActorDefinition,
  resolvePendingImport,
  storedDefinition,
  submitPendingImport,
  withDerivedSlots
} from "../actor-roster.js";
import { GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { ABILITY_ROLL_LABEL, recordHitPointRoll, settleBuilderDice } from "../builder-dice.js";
import { buildCharacterDefinition } from "../character-build.js";
import { draftOwnerOf } from "../character-drafts.js";
import { generateCharacterRequest } from "../character-generate.js";
import {
  BuilderRollAbilitiesSchema,
  BuilderSetPolicySchema,
  CharacterCreateSchema,
  CharacterDraftDiscardSchema,
  CharacterDraftSaveSchema,
  CharacterGenerateSchema,
  CharacterRebuildSchema,
  CharacterResolveImportSchema,
  CharacterSubmitImportSchema
} from "@vtt/domain/commands";
import { CommandRejectedError } from "../game-store.js";
import { recordRoll } from "../roll-history.js";
import type { HitDie } from "@vtt/rules-5e";
import { GameInputError } from "./failures.js";
import { initiatorOf, isGmGrade, sessionIdOf, type GamePrincipal, type Kit } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// The character builder and the sheet-import queue.

/** Mirrors `GameStateSchema`'s cap so the refusal is a sentence rather than a Zod failure mid-transaction. */
const MAX_STORED_DEFINITIONS = 100;

/** A player building their own character: the table's policy, one character each, and a daily cap. */
function requirePlayerMayCreate(
  kit: Kit,
  principal: GamePrincipal,
  policyOpen: (policy: GameState["builderPolicy"]) => boolean,
  denial: string,
  another: string
) {
  if (isGmGrade(principal)) return;
  const state = kit.read();
  if (!policyOpen(state.builderPolicy)) throw new GameAccessDeniedError(denial);
  if (state.actors.some((actor) => actor.ownerSessionId === principal.sessionId))
    throw new CommandRejectedError(`You already have a character - release it before ${another} another.`);
  if (!kit.withinCreateCap(principal.sessionId))
    throw new CommandRejectedError("That is a lot of characters for one evening - ask your GM to add the next one.");
}

/** Headroom and the level cap, in sentences the person can act on, inside the command against live state. */
function requireBuildRoom(state: GameState, level: number) {
  if (state.definitions.length >= MAX_STORED_DEFINITIONS)
    throw new CommandRejectedError("The table's sheet library is full - ask your GM to delete old characters.");
  if (level > state.builderPolicy.maxLevel)
    throw new CommandRejectedError(`This table builds characters up to level ${state.builderPolicy.maxLevel}.`);
}

/** Auto-claim a player's new character so no window exists in which someone else can take it. */
function claimForCreator(state: GameState, actorId: string, principal: GamePrincipal) {
  if (isGmGrade(principal)) return;
  const created = state.actors.find((actor) => actor.id === actorId);
  if (created) created.ownerSessionId = principal.sessionId;
}

/** A submitted sheet, size-capped and validated before it reaches the store. */
export function importedDefinition(definition: unknown, kind: "actor definition" | "character") {
  if (JSON.stringify(definition ?? null).length > 262_144)
    throw new GameInputError("That sheet is too large to import.");
  const parsed = ActorDefinitionSchema.safeParse(definition);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new GameInputError(`That file is not a valid ${kind} (${issue.path.join(".") || "root"}: ${issue.message}).`);
}

export const characterCommands = [
  defineCommand({
    type: "character.save-draft",
    operationId: "saveCharacterDraft",
    description:
      "Parks the caller's in-progress character build - the wizard's choices so far, not a sheet - replacing the one it parked before. Each player session keeps one, and the GM keeps one that follows the GM across sign-ins and devices. Kept beside the game state and never broadcast; only its owner reads it back (`GET /game/characters/draft`). A player may park one only while the table's builderPolicy.playerBuilder is open. The response carries `updatedAt`.",
    summary: "Park the caller's in-progress character build (one per player session, one for the GM).",
    schema: CharacterDraftSaveSchema,
    malformed: "The character draft is malformed.",
    issueMessage: true,
    async run({ principal, request }, kit) {
      if (!isGmGrade(principal) && kit.read().builderPolicy.playerBuilder !== "open")
        throw new GameAccessDeniedError("Your GM builds the characters at this table.");
      return { updatedAt: kit.context.characterDrafts.save(draftOwnerOf(principal), request.draft) };
    }
  }),

  defineCommand({
    type: "character.discard-draft",
    operationId: "discardCharacterDraft",
    description:
      "Drops the caller's parked character build, if there is one. Only ever the caller's own: a player session's, or the GM's.",
    summary: "Drop the caller's parked character build.",
    schema: CharacterDraftDiscardSchema,
    malformed: "The draft discard is malformed.",
    async run({ principal }, kit) {
      kit.context.characterDrafts.discard(draftOwnerOf(principal));
    }
  }),

  defineCommand({
    type: "character.create",
    operationId: "createCharacter",
    description:
      "Creates a character from CHOICES rather than a finished sheet - the GM always, and a player when the table's builderPolicy.playerBuilder is open, in which case the new character is auto-claimed by its creator and a per-session daily cap applies: identity ids (species/background/class/subclass), base ability scores plus the background's +2/+1 or +1/+1/+1 allocation, per-level hit-point entries, the fixed average, or `hp.mode` roll for the server to throw them (recorded in the table feed), and the choice-provenance ledger as the literal build input. While builderPolicy.typedRolls is gm-only, a player's rolled ability scores must be the six totals of their own `builder.roll-abilities` roll (`abilityRollId`) and a player may not type hit-point rolls. The server validates every id against the content catalogs, resolves every catalog-driven choice through the same resolver the wizard uses, interprets the content features' structured riders into sheet actions, assembles the canonical ActorDefinition, and lands it through the import path - the new claimable actor's id equals this call's commandId and its editable sheet is keyed import-<actorId>.",
    summary:
      "Create a character from choices (ids, scores, HP entries, the choices ledger); the server assembles and imports the sheet (GM). The actor's id equals the commandId.",
    schema: CharacterCreateSchema,
    malformed: "The character-create command is malformed.",
    // Players build their own when `builderPolicy.playerBuilder` is open; auto-claimed by its creator.
    async run({ principal, request, execute }, kit) {
      requirePlayerMayCreate(
        kit,
        principal,
        (policy) => policy.playerBuilder === "open",
        "Your GM builds the characters at this table.",
        "building"
      );
      const actorId = request.commandId;
      const { duplicate } = await execute(
        (state) => {
          requireBuildRoom(state, request.level);
          // Validated inside the command against the stored policy; the caller's catalog keeps GM-only
          // homebrew out of a player's build.
          const catalog = kit.catalogFor(principal);
          const hitDie = (catalog.classRecord(request.classId)?.hitDie as HitDie | undefined) ?? null;
          const { input, thrown } = settleBuilderDice(state, request, {
            gm: isGmGrade(principal),
            sessionId: sessionIdOf(principal),
            previous: undefined,
            hitDie,
            random: (sides) => kit.context.random(sides)
          });
          const definition = buildCharacterDefinition(input, catalog, state.builderPolicy);
          importActorDefinition(state, definition, actorId, "public", kit.equipmentCatalog());
          claimForCreator(state, actorId, principal);
          recordHitPointRoll(state, {
            id: kit.context.newId(),
            commandId: request.commandId,
            sessionId: sessionIdOf(principal),
            gm: isGmGrade(principal),
            actorId,
            label: `Hit points, ${state.actors.find((actor) => actor.id === actorId)?.name ?? request.name}`,
            faces: hitDie ? Number(hitDie.slice(1)) : 0,
            rolls: thrown
          });
        },
        { actorId }
      );
      if (!duplicate)
        kit.context.appendLog({
          kind: "encounter",
          text: `${kit.actorName(actorId)} joined the roster (character builder).`,
          actorIds: [actorId]
        });
      return { actorId };
    }
  }),

  defineCommand({
    type: "character.generate",
    operationId: "generateCharacter",
    description:
      "Rolls a complete, playable, single-class character at a level and lands it on the roster - the GM always, and a player when the table's builderPolicy.playerRandom is open, which unlike playerBuilder is CLOSED by default. The request carries only the level, an optional class (omitted means one is drawn) and an optional name; every other decision is made server-side from the same dice authority as every other roll: the standard array distributed by the class's own stat priority, the background's printed spread aimed the same way, and species, lineage, background, subclass, size, skills, tools, languages, feats, fighting styles, spells and starting equipment drawn at random from the offers the character builder itself computes. The result is assembled, validated and imported exactly as `POST /game/characters` is - same ActorDefinition, same choice ledger, so it levels up and respecs like a hand-built character - and the hit-point dice are recorded in the table feed. Auto-claimed by a player caller, with the same per-session daily cap.",
    summary:
      "Roll a complete, playable, single-class character at a level: the standard array by the class's stat priority and every other pick drawn server-side - the GM always, a player when builderPolicy.playerRandom is open (deny by default). The actor's id equals the commandId.",
    schema: CharacterGenerateSchema,
    malformed: "The character-generate command is malformed.",
    // Rolled with `context.random` inside the command, so a caller can't pre-roll; lands like `character.create`.
    async run({ principal, request, execute }, kit) {
      requirePlayerMayCreate(
        kit,
        principal,
        (policy) => policy.playerRandom === "open",
        "Your GM rolls the random characters at this table.",
        "rolling"
      );
      const actorId = request.commandId;
      let summary = "";
      const { duplicate } = await execute(
        (state) => {
          requireBuildRoom(state, request.level);
          // The caller's catalog, as in `character.create`.
          const generated = generateCharacterRequest(request, kit.catalogFor(principal), state.builderPolicy, (sides) =>
            kit.context.random(sides)
          );
          summary = generated.summary;
          const rolls = generated.hitPointRolls;
          const faces = generated.hitDieFaces;
          const definition = buildCharacterDefinition(
            generated.request,
            kit.catalogFor(principal),
            state.builderPolicy
          );
          importActorDefinition(state, definition, actorId, "public", kit.equipmentCatalog());
          claimForCreator(state, actorId, principal);
          // Hit-point dice land in the table feed like any roll. Level 1 throws none.
          recordHitPointRoll(state, {
            id: kit.context.newId(),
            commandId: request.commandId,
            sessionId: sessionIdOf(principal),
            gm: isGmGrade(principal),
            actorId,
            label: `Hit points, ${state.actors.find((actor) => actor.id === actorId)?.name ?? "a new character"}`,
            faces,
            rolls
          });
        },
        { actorId }
      );
      if (!duplicate)
        kit.context.appendLog({
          kind: "encounter",
          text: `${kit.actorName(actorId)} was rolled up — ${summary}.`,
          actorIds: [actorId]
        });
      return { actorId };
    }
  }),

  defineCommand({
    type: "character.rebuild",
    operationId: "rebuildCharacter",
    description:
      "Rebuilds one character at a new level - up OR down - or respecs it outright: the same build input `POST /game/characters` takes, minus the name (kept from the live actor), re-run through the identical validation. The GM may rebuild anyone; a player only their own claimed character, and only while the table's builder is open. Rolled hit points recorded in the choice ledger are reused, so a level-down/level-up round trip restores the same maximum; with `hp.mode` roll the server throws only the levels with no recorded roll. Spent uses, Hit Dice and spell slots stay spent against the new maxima, and a character at 0 hit points stays at 0. Refused while the character is in a live (or paused) fight.",
    summary:
      "Rebuild one character at a new level (up or down) or respec it, re-running the whole build from the choice ledger - the GM for anyone, a player for their own claimed character when the table's builder is open.",
    schema: CharacterRebuildSchema,
    malformed: "The character-rebuild command is malformed.",
    // Level up/down and respec re-run and re-validate the full build, then `rebuildActorDefinition`.
    async run({ principal, request, execute }, kit) {
      const { actorId } = request;
      if (!isGmGrade(principal) && kit.read().builderPolicy.playerBuilder !== "open")
        throw new GameAccessDeniedError("Your GM builds the characters at this table.");
      requireActorAccess(initiatorOf(principal), kit.read(), actorId, "edit");
      const { duplicate } = await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, actorId, "edit");
        if (request.level > state.builderPolicy.maxLevel)
          throw new CommandRejectedError(`This table builds characters up to level ${state.builderPolicy.maxLevel}.`);
        const actor = state.actors.find((entry) => entry.id === actorId);
        if (!actor) throw new CommandRejectedError("That character no longer exists.");
        const catalog = kit.catalogFor(principal);
        const hitDie = (catalog.classRecord(request.classId)?.hitDie as HitDie | undefined) ?? null;
        const { actorId: _actorId, ...build } = request;
        // The name stays the live actor's: a rebuild changes what a character can do, not who they are.
        const { input, thrown } = settleBuilderDice(
          state,
          { ...build, name: actor.name },
          {
            gm: isGmGrade(principal),
            sessionId: sessionIdOf(principal),
            previous: actor.definitionId ? storedDefinition(state, actor.definitionId) : undefined,
            hitDie,
            random: (sides) => kit.context.random(sides)
          }
        );
        const definition = buildCharacterDefinition(input, catalog, state.builderPolicy);
        rebuildActorDefinition(state, actorId, definition, kit.equipmentCatalog());
        recordHitPointRoll(state, {
          id: kit.context.newId(),
          commandId: request.commandId,
          sessionId: sessionIdOf(principal),
          gm: isGmGrade(principal),
          actorId,
          label: `Hit points, ${actor.name}`,
          faces: hitDie ? Number(hitDie.slice(1)) : 0,
          rolls: thrown
        });
      });
      if (!duplicate)
        kit.context.appendLog({
          kind: "encounter",
          text: `${kit.actorName(actorId)} was rebuilt at level ${request.level}.`,
          actorIds: [actorId]
        });
      return { actorId };
    }
  }),

  defineCommand({
    type: "builder.roll-abilities",
    operationId: "rollBuilderAbilities",
    description:
      "Rolls six ability scores SERVER-SIDE for the character builder, through the table's allowed method and the GM's formula. The set is recorded as one public roll in the table feed, and its `rollId` is what a player's create or rebuild names as `abilityRollId` while the table keeps players' dice on the server (builderPolicy.typedRolls gm-only). The GM, and players at a table that lets them type their dice (open, the default), may instead submit scores from physical dice, which are bound-checked against the formula.",
    summary: "Roll six ability scores server-side for the character builder, recorded in the table feed.",
    schema: BuilderRollAbilitiesSchema,
    malformed: "The ability-roll command is malformed.",
    // A player's create binds rolled scores to this roll unless the table opens typed rolls (`builder-dice.ts`).
    async run({ principal, request, execute }, kit) {
      const policy = kit.read().builderPolicy;
      if (!isGmGrade(principal) && policy.playerBuilder !== "open")
        throw new GameAccessDeniedError("Your GM builds the characters at this table.");
      if (!policy.allowedAbilityMethods.includes(request.method))
        throw new CommandRejectedError("That ability method is not allowed at this table.");
      if (request.method === "custom" && !policy.customFormula)
        throw new CommandRejectedError("The custom ability method needs the GM to configure a formula first.");
      const formula = request.method === "custom" ? policy.customFormula! : ABILITY_ROLL_FORMULA;
      const check = validateAbilityFormula(formula);
      if (!check.ok) throw new CommandRejectedError(`The configured ability formula is unusable: ${check.message}`);
      const scores: Array<{ total: number; faces: readonly number[] }> = [];
      let rollId: string | undefined;
      await execute((state) => {
        scores.length = 0;
        const dice: Array<{ group: number; sides: number; face: number; kept: boolean; sign: 1 | -1 }> = [];
        for (let group = 0; group < 6; group += 1) {
          const resolution = resolveDice(parseDiceFormula(formula), (sides) => kit.context.random(sides));
          const faces: number[] = [];
          for (const term of resolution.terms) {
            if (term.kind !== "dice") continue;
            for (const die of term.dice) {
              dice.push({ group, sides: term.sides, face: die.face, kept: die.kept, sign: term.sign });
              faces.push(die.face);
            }
          }
          scores.push({ total: resolution.total, faces });
        }
        rollId = kit.context.newId();
        recordRoll(state, {
          id: rollId,
          commandId: request.commandId,
          initiatorSessionId: sessionIdOf(principal),
          initiatorRole: isGmGrade(principal) ? "gm" : "player",
          initiatorLabel: isGmGrade(principal) ? "GM" : "A player",
          label: ABILITY_ROLL_LABEL,
          actorId: null,
          purpose: "manual",
          visibility: "public",
          formula: `6 x ${formula}`,
          normalizedFormula: `6 x ${formula}`,
          dice,
          modifiers: [],
          total: scores.reduce((sum, score) => sum + score.total, 0),
          createdAt: new Date().toISOString()
        });
      });
      return { scores: scores.map((score) => score.total), dice: scores.map((score) => score.faces), rollId };
    }
  }),

  defineCommand({
    type: "builder.set-policy",
    operationId: "setBuilderPolicy",
    description:
      "Sets the character-builder table policy (GM-grade only; task-packet decision 10): which ability-score generation methods the wizard offers players (standard-array, point-buy, roll, custom - all four by default) and the GM's custom roll formula. A supplied formula is validated through the server's own dice grammar and bounds (a formula that can roll outside 1-30 is rejected); allowing \"custom\" is only actionable while a formula is set. `typedRolls` decides whether players may type what their dice show, for every roll: checks, saves, attacks, damage, death saves, initiative, and rolled scores and hit points (open by default; gm-only has the server throw them), and `hitPointRollFloor` whether a rolled hit-point level is raised to the class average (none by default, the SRD rule). The stored policy is projected to every player verbatim.",
    summary: "Set the character-builder policy: allowed ability-score methods and the GM's custom roll formula (GM).",
    schema: BuilderSetPolicySchema,
    malformed: "The builder-policy command is malformed.",
    gmOnly: "Only the GM can set the character-builder policy.",
    async run({ request, execute }, kit) {
      // A supplied formula must pass the same validator the roll path uses.
      if (typeof request.customFormula === "string") {
        const check = validateAbilityFormula(request.customFormula);
        if (!check.ok) throw new GameInputError(check.message);
      }
      const { allowedAbilityMethods } = request;
      const { duplicate } = await execute((state) => {
        state.builderPolicy = {
          allowedAbilityMethods: [...allowedAbilityMethods],
          // Omitted = keep the stored formula; null = clear; a string = the validated new formula.
          customFormula:
            request.customFormula === undefined ? state.builderPolicy.customFormula : request.customFormula,
          // Omitted keeps what is stored.
          maxLevel: request.maxLevel ?? state.builderPolicy.maxLevel,
          playerBuilder: request.playerBuilder ?? state.builderPolicy.playerBuilder,
          playerRandom: request.playerRandom ?? state.builderPolicy.playerRandom,
          typedRolls: request.typedRolls ?? state.builderPolicy.typedRolls,
          hitPointRollFloor: request.hitPointRollFloor ?? state.builderPolicy.hitPointRollFloor
        };
      });
      if (!duplicate)
        kit.context.appendLog({
          kind: "encounter",
          text: `Character-builder ability methods set to ${allowedAbilityMethods.join(", ")}.`,
          gmOnly: true
        });
    }
  }),

  defineCommand({
    type: "character.submit-import",
    operationId: "submitCharacterImport",
    description:
      "Submits a character sheet into the GM's approval queue instead of importing it directly - the player path (a GM importing their own sheet uses the definitions import). Any joined session may submit; nothing reaches the roster until the GM resolves it. The queued entry's `importId` is this call's commandId, so keep it to resolve or re-send the submission idempotently.",
    summary:
      "Submit a character sheet into the GM's approval queue (anyone at the table); the queued importId equals the commandId.",
    schema: CharacterSubmitImportSchema,
    malformed: "The import submission is malformed.",
    // Any joined session may submit; the GM's approval is the gate.
    async run({ principal, request, execute }, kit) {
      const definition = withDerivedSlots(
        importedDefinition(request.definition, "character"),
        kit.contentLibrary.forAudience("gm").classProgressionTable()
      );
      await execute((state) => submitPendingImport(state, definition, request.commandId, sessionIdOf(principal)));
    }
  }),

  defineCommand({
    type: "character.resolve-import",
    operationId: "resolveCharacterImport",
    description:
      "Approves (`approve: true`) or rejects a queued character submission (GM-grade only). Either decision removes it from the queue; approving instantiates the claimable actor, whose id equals THIS call's commandId (returned as `actorId`).",
    summary:
      "Approve or reject a queued character submission (GM); approving instantiates the actor, whose id equals the commandId.",
    schema: CharacterResolveImportSchema,
    malformed: "The import decision is malformed.",
    gmOnly: "Only the GM can approve imported sheets.",
    async run({ request, execute }) {
      const actorId = request.commandId;
      await execute((state) => resolvePendingImport(state, request.importId, request.approve, actorId), { actorId });
      return { actorId };
    }
  })
];
