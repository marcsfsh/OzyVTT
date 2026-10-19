import type { EncounterStartEntry, GameState } from "@vtt/domain";
import { requireActorAccess } from "../authorization.js";
import { planNextTurn, planPreviousTurn, turnLabel, type TimelineOutcome } from "../combat-history.js";
import { endEncounterEffects, type EffectNarration } from "../effects.js";
import { buildEncounterArchive } from "../encounter-archive.js";
import {
  addCombatant,
  endEncounter,
  nextInitiativeTurn,
  removeCombatant,
  rollRemainingInitiative,
  rollSelfInitiative,
  orderTiedCharacters,
  setInitiativeScore,
  startEncounter,
  swapInitiative
} from "../encounter.js";
import {
  AddCombatantSchema,
  CommandIdentitySchema,
  EncounterStartSchema,
  InitiativeNextSchema,
  InitiativePreviousSchema,
  InitiativeRollRemainingSchema,
  InitiativeRollSelfSchema,
  InitiativeScoreSchema,
  InitiativeSwapSchema,
  InitiativeOrderTieSchema,
  RemoveCombatantSchema,
  TurnLegendarySchema,
  TurnReactionSchema,
  TurnUseSchema
} from "@vtt/domain/commands";
import { CommandRejectedError, type JournalEntry } from "../game-store.js";
import { requireTypedDie } from "../held-rolls.js";
import { endTurn, setLegendaryUsed, setReactionUsed, setTurnSlot } from "../turn-economy.js";
import { initiatorOf, isGmGrade, principalTag, type Kit } from "./kit.js";
import { defineCommand } from "./pipeline.js";
import { refreshVisionMeasure } from "../vision/edit.js";
import { hiddenCombatants, keepUnseenHidden } from "../vision/audience.js";
import { recoverAmmunition } from "../ammunition.js";

// The encounter lifecycle, initiative and the turn economy.

/** Where creatures stand on the fight's map; a map that can't be read leaves every distance unknown, so a turn still
 *  moves on. */
async function mappedDistance(
  kit: Kit
): Promise<(state: GameState, actorIdA: string, actorIdB: string) => number | null> {
  return kit.creatureDistance().catch(() => () => null);
}

export const encounterCommands = [
  defineCommand({
    type: "encounter.start",
    operationId: "startEncounter",
    description:
      "Starts an encounter on a calibrated battlemap with initial combatants (GM-grade only). Missing initiative scores are rolled server-side.",
    summary: "Start an encounter on a battlemap; omit the combatants to start on the live scene's staged list (GM).",
    schema: EncounterStartSchema,
    malformed: "The encounter setup is malformed.",
    gmOnly: "Only the GM can start an encounter.",
    async run({ principal, request, executeTimeline }, kit) {
      const encounterMap = kit.context.mapCatalog.get(request.mapAssetId);
      if (!encounterMap || encounterMap.kind !== "battlemap")
        throw new CommandRejectedError("Select an uploaded battlemap before starting the encounter.");
      const { commandId, mapAssetId, rulesMode, ruleExceptions, playersRollInitiative, groupMonsters } = request;
      const tokenGeometry = await kit.context.tokenGeometryFor(mapAssetId);
      // Omitted `entries` means "start the fight staged here", derived from live state and never from the client.
      // No refusal here, so `startEncounter`'s own guards keep their order and wording.
      const stagedEntries = (state: GameState): readonly EncounterStartEntry[] => {
        // The active scene's own slot is empty by invariant (its live copy is the top-level combat), so the
        // staged list is the top-level initiative.
        const live =
          state.combat.activeSceneId !== null &&
          state.combat.scenes.some((candidate) => candidate.id === state.combat.activeSceneId);
        return live ? state.combat.initiative.map((entry) => ({ actorId: entry.actorId })) : [];
      };
      const { state, duplicate } = await executeTimeline((draft, timeline) => {
        const entries = request.entries ?? stagedEntries(draft);
        // Hidden from the table before the new fight: one this start leaves off the map stays unknown.
        const unseenBefore = hiddenCombatants(draft, kit.sightContent());
        // A fresh fight starts from the table's standing rules policy unless this command names its own.
        startEncounter(
          draft,
          {
            mapAssetId,
            entries,
            rulesMode: rulesMode ?? draft.rulesPolicy.dial,
            ruleExceptions: ruleExceptions ?? { ...draft.rulesPolicy.exceptions },
            playersRollInitiative,
            groupMonsters
          },
          () => kit.context.random(20),
          tokenGeometry,
          (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
          Date.now(),
          kit.equipmentCatalog(),
          kit.initiativeRollSink(draft, commandId, principal)
        );
        // The fight may be on another map than the one the walls were drawn on: keep feet and pixels in step.
        refreshVisionMeasure(draft, tokenGeometry);
        const fighting = new Set(draft.combat.initiative.map((entry) => entry.actorId));
        keepUnseenHidden(
          draft,
          [...unseenBefore].filter((actorId) => !fighting.has(actorId))
        );
        // Fresh fight: clear prior snapshots and record this start as the rewind baseline.
        timeline.truncateAll();
        // The previous fight's journal goes with it; this very command stays as the new fight's first entry.
        timeline.clearJournal(commandId);
        timeline.capture("turn", `Combat begins · ${turnLabel(draft)}`, draft);
      });
      if (duplicate) return;
      kit.context.appendLog({ kind: "encounter", text: "The encounter began.", gmOnly: false });
      kit.publishRolls(state, commandId);
      for (const entry of request.entries ?? []) {
        if (entry.surprised === true)
          kit.context.appendLog({
            kind: "encounter",
            text: `${kit.actorName(entry.actorId)} is surprised.`,
            actorIds: [entry.actorId],
            gmOnly: kit.actorHidden(entry.actorId)
          });
      }
      kit.context.logTurnBegin(state);
    }
  }),

  defineCommand({
    type: "encounter.end",
    operationId: "endEncounter",
    description:
      "Ends the encounter (GM-grade only). The whole fight auto-archives permanently (see /encounters) in the same transaction.",
    summary: "End the encounter and archive it permanently (GM).",
    schema: CommandIdentitySchema,
    malformed: "The encounter command is malformed.",
    gmOnly: "Only the GM can end an encounter.",
    async run({ principal, request, executeTimeline }, kit) {
      const { commandId } = request;
      const tag = principalTag(principal);
      let effectEvents: EffectNarration[] = [];
      let endedSceneId: string | null = null;
      let endedMapAssetId: string | null = null;
      let endedTurnCount = 0;
      let recovered: ReturnType<typeof recoverAmmunition> = [];
      const { duplicate } = await executeTimeline((state, timeline) => {
        // The last live picture of the fight, captured before endEncounter clears the combat.
        const finalState = structuredClone(state);
        endedSceneId = finalState.combat.activeSceneId;
        endedMapAssetId = finalState.combat.mapAssetId;
        // The fight's effects end with it (onEnd fires), scoped to its combatants so parked scenes' effects survive.
        const combatantIds = state.combat.initiative.map((entry) => entry.actorId);
        effectEvents = endEncounterEffects(state, combatantIds);
        endEncounter(state); // rejects while rewound
        // SRD Ammunition: after a fight, half the pieces each combatant fired are picked up again.
        recovered = recoverAmmunition(state, combatantIds, kit.equipmentCatalog());
        // Archive the fight in the same transaction, before wiping live buffers, so it can never be lost.
        // A fight that captured no boundaries is skipped.
        const entries = timeline.entries();
        if (entries.length > 0) {
          const endedAt = new Date().toISOString();
          const journal = timeline.journalEntries();
          // The end command's own journal row is written after the clear, so append it here explicitly.
          const endEntry: JournalEntry = {
            seq: (journal[journal.length - 1]?.seq ?? 0) + 1,
            commandId,
            type: "encounter.end",
            actorId: null,
            principal: tag,
            payload: request,
            revision: state.revision + 1,
            at: endedAt
          };
          const document = buildEncounterArchive({
            entries,
            readState: timeline.read,
            // The combat log persists independently; the fight's slice starts at its first boundary's revision.
            log: kit.context.combatLog.exportSince(entries[0].revision),
            journal: [...journal, endEntry],
            finalState,
            // State after the end command's own work (effect sweeps and their on-end grants), which finalState predates.
            postEncounterState: structuredClone(state),
            endedAt,
            // Play-time read: the archive snapshots the definition each combatant actually fought with.
            resolveBundledDefinition: (definitionId) => kit.contentLibrary.monsterForInstance(definitionId),
            attribution: kit.contentLibrary.attribution
          });
          timeline.archive({
            commandId,
            startedAt: document.startedAt,
            endedAt: document.endedAt,
            turnCount: document.turnCount,
            documentJson: JSON.stringify(document),
            sceneName: finalState.combat.scenes.find((scene) => scene.id === endedSceneId)?.name ?? null
          });
          endedTurnCount = document.turnCount;
        }
        timeline.truncateAll(); // the fight is over: its live turn snapshots go with it
        timeline.clearJournal();
      });
      if (duplicate) return;
      kit.context.appendLog({ kind: "encounter", text: "The encounter ended.", gmOnly: false });
      for (const line of recovered)
        kit.context.appendLog({
          kind: "encounter",
          text: line.text,
          actorIds: [line.actorId],
          gmOnly: kit.actorHidden(line.actorId)
        });
      kit.publishNarrations(effectEvents);
      kit.context.onEncounterArchived?.({
        mapAssetId: endedMapAssetId,
        sceneId: endedSceneId,
        turnCount: endedTurnCount
      });
    }
  }),

  defineCommand({
    type: "encounter.add-combatant",
    operationId: "addEncounterCombatant",
    description:
      "Adds a rostered actor to the running encounter (GM-grade only); rolls initiative when no score is given.",
    summary: "Add a rostered actor to the running encounter (GM).",
    schema: AddCombatantSchema,
    malformed: "The add-combatant command is malformed.",
    gmOnly: "Only the GM can add a combatant.",
    async run({ principal, request, execute }, kit) {
      const mapAssetId = kit.read().combat.mapAssetId;
      if (!mapAssetId) throw new CommandRejectedError("Start an encounter before adding a combatant.");
      const { commandId, actorId, score } = request;
      const geometry = await kit.context.tokenGeometryFor(mapAssetId);
      const { state, duplicate } = await execute((draft) =>
        addCombatant(
          draft,
          actorId,
          score,
          () => kit.context.random(20),
          geometry,
          Date.now(),
          kit.initiativeRollSink(draft, commandId, principal),
          kit.initiativeRollDeps(draft)
        )
      );
      if (!duplicate) kit.publishRolls(state, commandId);
    }
  }),

  defineCommand({
    type: "encounter.remove-combatant",
    operationId: "removeEncounterCombatant",
    description:
      "Takes a combatant out of the running fight (GM-grade only): its initiative entry, token and prompts go, the turn moves on first when it was its turn, and what it sustains ends: its grapples and Concentration, what lasts until its next turn, and a creature it swallowed, which climbs out of the corpse with the movement the stat block names and lands Prone. It stays on the roster.",
    summary: "Take a combatant out of the running fight and end what it holds (GM).",
    schema: RemoveCombatantSchema,
    malformed: "The remove-combatant command is malformed.",
    gmOnly: "Only the GM can take a combatant out of the fight.",
    async run({ request, executeTimeline }, kit) {
      const { actorId } = request;
      let outcome: TimelineOutcome | undefined;
      const effectEvents: EffectNarration[] = [];
      let unseen = false;
      const geometry = await kit.liveGeometry();
      const distance = await mappedDistance(kit);
      const { state, duplicate } = await executeTimeline((draft, timeline) => {
        if (draft.combat.historyCursor !== null)
          throw new CommandRejectedError(
            "Finish reviewing the combat history before taking a combatant out of the fight."
          );
        // Hidden from the table as it leaves: it stays unknown to players, and so does its leaving.
        unseen = kit.hiddenFromTable(draft)(actorId);
        const gathering = draft.combat.playerInitiativeMode === "wait" && draft.combat.pendingInitiative.length > 0;
        // Its turn ends first, recorded like any other, so Previous can bring it back.
        if (draft.combat.turnActorId === actorId && draft.combat.initiative.length > 1 && !gathering)
          outcome = planNextTurn(draft, timeline, false, (advancing) =>
            nextInitiativeTurn(advancing, effectEvents, kit.turnAdvanceDeps(advancing, geometry, distance))
          );
        else if (draft.combat.turnActorId === actorId && gathering) {
          const order = draft.combat.initiative.filter((entry) => entry.actorId !== actorId);
          if (order[0]) draft.combat = { ...draft.combat, turnActorId: order[0].actorId };
        }
        effectEvents.push(
          ...removeCombatant(draft, actorId, (definitionId) => kit.resolveDefinitionIn(draft, definitionId))
        );
        if (unseen) keepUnseenHidden(draft, [actorId]);
      });
      if (duplicate) return;
      if (outcome) kit.context.logTimelineOutcome(outcome, state);
      kit.publishNarrations(effectEvents);
      kit.context.appendLog({
        kind: "encounter",
        text: `${kit.actorName(actorId)} left the fight.`,
        actorIds: [actorId],
        gmOnly: unseen || kit.actorHidden(actorId)
      });
    }
  }),

  defineCommand({
    type: "initiative.set",
    operationId: "setInitiativeScore",
    description:
      "Sets a combatant's initiative score (GM-grade only); `tieBreaker` orders combatants tied on the same score, higher first.",
    summary: "Set a combatant's initiative score (GM).",
    schema: InitiativeScoreSchema,
    malformed: "The Initiative update is malformed.",
    gmOnly: "Only the GM can change Initiative.",
    async run({ request, execute }) {
      await execute((state) => setInitiativeScore(state, request.actorId, request.score, request.tieBreaker));
    }
  }),

  defineCommand({
    type: "initiative.swap",
    operationId: "swapInitiative",
    description:
      "Swaps two combatants' initiative (GM-grade only): the Alert feat's Initiative Swap, made right after initiative is rolled and before either has acted. Refused while either is Incapacitated.",
    summary: "Swap two combatants' initiative, as Alert's Initiative Swap (GM).",
    schema: InitiativeSwapSchema,
    malformed: "The Initiative swap is malformed.",
    gmOnly: "Only the GM can swap Initiative.",
    async run({ request, execute }, kit) {
      const { duplicate } = await execute((state) => swapInitiative(state, request.actorId, request.withActorId));
      if (duplicate) return;
      kit.context.appendLog({
        kind: "encounter",
        text: `${kit.actorName(request.actorId)} and ${kit.actorName(request.withActorId)} swapped initiative.`,
        actorIds: [request.actorId, request.withActorId],
        gmOnly: kit.actorHidden(request.actorId) || kit.actorHidden(request.withActorId)
      });
    }
  }),

  defineCommand({
    type: "initiative.order-tie",
    operationId: "orderTiedCharacters",
    description:
      "Puts a character directly ahead of another character tied with it on the same initiative score (SRD Initiative: the players decide the order among tied characters), before either has taken a turn in this fight. GM-grade for any character; a player session only for their own claimed character.",
    summary: "Order your character before another character tied on initiative.",
    schema: InitiativeOrderTieSchema,
    malformed: "The tie order is malformed.",
    async run({ principal, request, execute }, kit) {
      const { duplicate } = await execute((state) =>
        orderTiedCharacters(state, initiatorOf(principal), request.actorId, request.beforeActorId)
      );
      if (duplicate) return;
      kit.context.appendLog({
        kind: "encounter",
        text: `${kit.actorName(request.actorId)} goes before ${kit.actorName(request.beforeActorId)} on their tied initiative.`,
        actorIds: [request.actorId, request.beforeActorId],
        gmOnly: kit.actorHidden(request.actorId) || kit.actorHidden(request.beforeActorId)
      });
    }
  }),

  defineCommand({
    type: "initiative.roll-self",
    operationId: "rollOwnInitiative",
    description:
      "Rolls initiative for a character (server rolls the d20 unless a manual `natural` is supplied; a player may type one only while the table's typedRolls is open), adds its initiative modifier, sets its score, and clears its pending flag. The rules set the roll mode (Surprise, conditions such as Poisoned, features, Dexterity check riders) and Exhaustion's penalty; `rollMode` is honoured only from a GM-grade session. GM-grade for anyone; a player session only for their own claimed character. When the encounter runs in `wait` mode, the last pending roll begins turns.",
    summary: "Roll your own claimed character's initiative (GM anyone); the server rolls unless a manual d20 is given.",
    schema: InitiativeRollSelfSchema,
    malformed: "The initiative roll is malformed.",
    async run({ principal, request, execute }, kit) {
      const { commandId, actorId, natural, rollMode } = request;
      let score: number | undefined;
      const { state, duplicate } = await execute((draft) => {
        // A player rolls only their own claimed character's initiative; the GM (integration) anyone's.
        requireActorAccess(initiatorOf(principal), draft, actorId, "check");
        // A typed d20 only while the table lets players type their dice.
        if (natural !== undefined) requireTypedDie(draft, initiatorOf(principal), undefined, natural);
        score = rollSelfInitiative(
          draft,
          actorId,
          { natural, rollMode: isGmGrade(principal) ? rollMode : undefined },
          () => kit.context.random(20),
          kit.initiativeRollSink(draft, commandId, principal),
          kit.initiativeRollDeps(draft)
        );
      });
      if (duplicate) return;
      kit.publishRolls(state, commandId);
      // The durable line is the roll row itself; the toast is only the transient announcement.
      if (score !== undefined)
        kit.context.broadcastTableEvent({
          kind: "action",
          text: `${kit.actorName(actorId)} rolled ${score} for initiative.`,
          actorIds: [actorId],
          logged: false
        });
    }
  }),

  defineCommand({
    type: "initiative.roll-remaining",
    operationId: "rollRemainingInitiative",
    description:
      "Settles initiative for every combatant still pending a player roll with the provisional roll made at the start (GM-grade only). This begins a `wait`-mode fight.",
    summary: "Use the start's rolls for every player still pending, and begin a wait-mode fight (GM).",
    schema: InitiativeRollRemainingSchema,
    malformed: "The initiative command is malformed.",
    gmOnly: "Only the GM can roll initiative for the rest of the table.",
    async run({ execute }, kit) {
      const { duplicate } = await execute((draft) => rollRemainingInitiative(draft));
      if (duplicate) return;
      kit.context.appendLog({
        kind: "action",
        text: "The GM rolled initiative for the remaining players.",
        gmOnly: false
      });
    }
  }),

  defineCommand({
    type: "initiative.next",
    operationId: "nextTurn",
    description:
      'Advances the turn (GM-grade only). While the table is rewound this steps forward through recorded history; a 409 with `needsConfirm: "rewrite-history"` asks for `confirmRewrite: true` to truncate the undone future.',
    summary: "Advance the turn; steps forward through recorded history while rewound (GM).",
    schema: InitiativeNextSchema,
    malformed: "The Initiative command is malformed.",
    gmOnly: "Only the GM can advance Initiative.",
    async run({ request, executeTimeline }, kit) {
      // Live: record the boundary and advance. Rewound and unchanged: step forward through history.
      // Rewound and changed: rewrite history only after GM confirmation (TimelineConfirmationRequired).
      let outcome: TimelineOutcome | undefined;
      const effectEvents: EffectNarration[] = [];
      const geometry = await kit.liveGeometry();
      const distance = await mappedDistance(kit);
      const { state, duplicate } = await executeTimeline((draft, timeline) => {
        outcome = planNextTurn(draft, timeline, request.confirmRewrite === true, (advancing) =>
          nextInitiativeTurn(advancing, effectEvents, kit.turnAdvanceDeps(advancing, geometry, distance))
        );
      });
      if (duplicate) return;
      if (outcome) kit.context.logTimelineOutcome(outcome, state);
      kit.publishNarrations(effectEvents);
    }
  }),

  defineCommand({
    type: "initiative.previous",
    operationId: "previousTurn",
    description:
      'Rewinds the whole table to the previous turn boundary (GM-grade only). A 409 with `needsConfirm: "discard-changes"` asks for `confirmDiscard: true` to drop changes made while rewound.',
    summary: "Rewind the whole table to the previous turn boundary (GM).",
    schema: InitiativePreviousSchema,
    malformed: "The Initiative command is malformed.",
    gmOnly: "Only the GM can move Initiative backward.",
    async run({ request, executeTimeline }, kit) {
      // From live, park a return-point and restore the last boundary; while rewound, step further back,
      // unless the GM changed things here, in which case confirming discards those changes.
      let outcome: TimelineOutcome | undefined;
      const { state, duplicate } = await executeTimeline((draft, timeline) => {
        outcome = planPreviousTurn(draft, timeline, request.confirmDiscard === true);
      });
      if (!duplicate && outcome) kit.context.logTimelineOutcome(outcome, state);
    }
  }),

  defineCommand({
    type: "turn.end",
    operationId: "endTurn",
    description:
      "Ends the current turn and advances. The GM (or an integration) may end anyone's turn; a player session only their own claimed character's.",
    summary: "End the current turn (GM anyone; a player only their own turn).",
    schema: CommandIdentitySchema,
    malformed: "The end-turn command is malformed.",
    async run({ principal, executeTimeline }, kit) {
      // End Turn is a live forward step like the GM's Next. Players cannot advance while the table is rewound.
      const effectEvents: EffectNarration[] = [];
      const geometry = await kit.liveGeometry();
      const distance = await mappedDistance(kit);
      const { state, duplicate } = await executeTimeline((draft, timeline) => {
        if (draft.combat.historyCursor !== null)
          throw new CommandRejectedError(
            "The GM is reviewing an earlier turn. Try again once play resumes.",
            "history_review"
          );
        planNextTurn(draft, timeline, false, (advancing) =>
          endTurn(advancing, initiatorOf(principal), effectEvents, kit.turnAdvanceDeps(advancing, geometry, distance))
        );
      });
      if (duplicate) return;
      kit.context.logTurnBegin(state);
      kit.publishNarrations(effectEvents);
    }
  }),

  defineCommand({
    type: "turn.use",
    operationId: "useTurnSlot",
    description:
      "Marks the current turn's action or Bonus Action used/unused. A manual toggle: structured action resolution validates against this state per the encounter's rules mode, and un-marking the action slot also clears any open compound-action instance. Only the GM gives back a spent slot: a player's un-marking is the `economy.spent-slot` rules block (a GM note under advise).",
    summary: "Mark the current turn's action or Bonus Action used/unused.",
    schema: TurnUseSchema,
    malformed: "The turn command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { slot, used } = request;
      const notes: string[] = [];
      const { state, duplicate } = await execute((draft) =>
        setTurnSlot(draft, slot, used, initiatorOf(principal), notes)
      );
      if (duplicate) return;
      kit.logRulesNotes(notes, state.combat.turnActorId);
      // Marking a slot spent is narrated like reactions; un-marking (a correction) stays silent.
      const turnActorId = state.combat.turnActorId;
      if (used && turnActorId)
        kit.context.broadcastTableEvent({
          kind: "action",
          text: `${kit.actorName(turnActorId)} used ${slot === "bonus-action" ? "a Bonus Action" : "an action"}.`,
          actorIds: [turnActorId],
          gmOnly: kit.actorHidden(turnActorId)
        });
    }
  }),

  defineCommand({
    type: "turn.use-reaction",
    operationId: "useReaction",
    description:
      "Marks a combatant's reaction used/unused; reactions refresh at the start of their own turn. Only the GM gives back a spent reaction: a player's un-marking is the `economy.spent-slot` rules block (a GM note under advise).",
    summary: "Mark a combatant's reaction used/unused.",
    schema: TurnReactionSchema,
    malformed: "The reaction command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, used } = request;
      const notes: string[] = [];
      const { duplicate } = await execute((state) =>
        setReactionUsed(state, actorId, used, initiatorOf(principal), notes)
      );
      if (!duplicate) kit.logRulesNotes(notes, actorId);
      if (!duplicate && used)
        kit.context.broadcastTableEvent({
          kind: "reaction",
          text: `${kit.actorName(actorId)} used its reaction.`,
          actorIds: [actorId],
          gmOnly: kit.actorHidden(actorId)
        });
    }
  }),

  defineCommand({
    type: "turn.use-legendary",
    operationId: "useLegendaryActions",
    description:
      "Sets a legendary creature's spent legendary actions this round (GM-grade only; 0 clears). Structured legendary action resolves spend the pool automatically; it refills at the creature's own turn start.",
    summary: "Set a legendary creature's spent legendary actions this round.",
    schema: TurnLegendarySchema,
    malformed: "The legendary-action command is malformed.",
    gmOnly: "Only the GM tracks legendary actions.",
    // Silent: the legendary pool is GM knowledge; structured legendary resolves narrate the action itself.
    async run({ principal, request, execute }) {
      await execute((state) => setLegendaryUsed(state, request.actorId, request.spent, initiatorOf(principal)));
    }
  })
];
