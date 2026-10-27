import {
  DoorSetStateSchema,
  DoorUseSchema,
  ObjectAttackSchema,
  ObjectDamageSchema,
  ObjectSetSchema
} from "@vtt/domain/commands";
import { GameAccessDeniedError } from "../authorization.js";
import { setDoorState, useDoor, type DoorUseResult } from "../doors.js";
import { layerSlice } from "../map-layers.js";
import { tokenCreatureDistance } from "../movement-narration.js";
import { strikeObject, type ObjectStrike } from "../object-strikes.js";
import { damageObject, findObject, setWallObject } from "../objects.js";
import { initiatorOf, isGmGrade, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Doors that stay shut and objects that break (SRD 5.2.1 Lock, Thieves' Tools, Breaking Objects): the GM sets what
// keeps a door shut and gives a wall or door statistics as an object; a creature beside a door picks, forces or jams it,
// and a creature attacks an object with one of its own attacks.

const GM_ONLY = "Only the GM sets up doors and objects.";

export const objectCommands = [
  defineCommand({
    type: "door.set-state",
    operationId: "setDoorState",
    description:
      "Sets what keeps a door shut (GM-grade only): its `fastenings` (a `lock` with the Thieves' Tools DC to pick it, a `forceDc` to break it and the creatures that hold its key; `stuck`, `barred` or `jammed` with the Strength (Athletics) DC that forces it, 15 when none is given; `sealed`, which no check opens), an `arcaneLock` with its caster and the creatures it lets through, and `hidden` for a secret door players see as wall. Null clears them. Players never receive any of it; they learn a door is locked by trying it. `sceneId` targets a prepared scene.",
    summary: "Lock, bar or hide a door (GM).",
    schema: DoorSetStateSchema,
    malformed: "The door's state is malformed.",
    gmOnly: GM_ONLY,
    async run({ request, execute }) {
      const { wallId, door, sceneId } = request;
      await execute((state) => {
        if (sceneId !== undefined) {
          const target = layerSlice(state, sceneId, "vision", "That scene is live. Edit its doors on the table.");
          const scratch = { ...state, combat: { ...state.combat, vision: target.layer } };
          setDoorState(scratch, wallId, door);
          target.write(scratch.combat.vision);
          return;
        }
        setDoorState(state, wallId, door);
      });
    }
  }),

  defineCommand({
    type: "door.use",
    operationId: "useDoor",
    description:
      "A creature within 5 feet of a closed door works on it (SRD 5.2.1 Thieves' Tools, Ram Portable, Spikes Iron): `pick` its lock with Thieves' Tools (a Dexterity (Sleight of Hand) check against the lock's DC, 15 for the SRD Lock; an Arcane Lock can't be picked), `force` it open (a Strength (Athletics) check against the highest DC holding it, +4 with a Portable Ram and Advantage when `helperId` names another character beside the door to help with it), `jam` it shut with an Iron Spike (DC 15 to force), `pry` it open with Carpenter's or Smith's Tools (a Strength check with the tool against DC 20; a sealed door and an Arcane Lock hold), or `seal` it with Carpenter's Tools (the same check; DC 20 to force). Each takes the Utilize action in a fight on the creature's turn, or with `bonusAction` a Thief's Bonus Action (Fast Hands). The server rolls the check. GM-grade for any creature; a player session for their own character.",
    summary: "Pick, force, pry, jam or seal a door beside your character.",
    schema: DoorUseSchema,
    malformed: "The door command is malformed.",
    issueMessage: true,
    async run({ principal, request, execute }, kit) {
      const { wallId, actorId, how, helperId, bonusAction, commandId } = request;
      let done: DoorUseResult | null = null;
      const { duplicate } = await execute((state) => {
        done = useDoor(
          state,
          {
            wallId,
            actorId,
            how,
            ...(helperId !== undefined ? { helperId } : {}),
            ...(bonusAction !== undefined ? { bonusAction } : {}),
            visibility: "public"
          },
          initiatorOf(principal),
          {
            random: (sides) => kit.context.random(sides),
            newId: kit.context.newId,
            commandId,
            sessionId: sessionIdOf(principal),
            now: () => new Date().toISOString(),
            resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
            catalog: kit.equipmentCatalog()
          }
        );
      });
      const result = done as DoorUseResult | null;
      if (duplicate || !result) return {};
      kit.publishRolls(kit.read(), commandId);
      kit.context.appendLog({
        kind: "action",
        text: result.text,
        actorIds: [actorId],
        gmOnly: kit.actorHidden(actorId)
      });
      return { text: result.text, opened: result.opened };
    }
  }),

  defineCommand({
    type: "object.set",
    operationId: "setWallObject",
    description:
      "Gives a wall or door statistics as an object (GM-grade only), SRD 5.2.1 Breaking Objects: its Armor Class, its Hit Points (current and maximum), an optional damage threshold, and the damage types it resists, ignores or takes double from. Every object also has Immunity to Poison and Psychic damage. Attacks and damage then break it, and at 0 Hit Points it is gone from the map, opening the way. Null clears them. `sceneId` targets a prepared scene.",
    summary: "Give a wall or door Armor Class and Hit Points (GM).",
    schema: ObjectSetSchema,
    malformed: "The object is malformed.",
    issueMessage: true,
    gmOnly: GM_ONLY,
    async run({ request, execute }) {
      const { wallId, object, sceneId } = request;
      await execute((state) => {
        if (sceneId !== undefined) {
          const target = layerSlice(state, sceneId, "vision", "That scene is live. Edit its walls on the table.");
          const scratch = { ...state, combat: { ...state.combat, vision: target.layer } };
          setWallObject(scratch, wallId, object);
          target.write(scratch.combat.vision);
          return;
        }
        setWallObject(state, wallId, object);
      });
    }
  }),

  defineCommand({
    type: "object.damage",
    operationId: "damageObject",
    description:
      "Deals typed damage to an object on the live map (GM-grade only): a wall or door with object statistics, or what holds a creature (`actorId` and `effectId`: a Net, a giant spider's web). It goes through the object's defences (Immunity to Poison and Psychic damage, its own resistances, immunities and vulnerabilities) and its damage threshold. At 0 Hit Points a wall or door is gone from the map and what held a creature lets it go.",
    summary: "Deal damage to a door, a wall or a net (GM).",
    schema: ObjectDamageSchema,
    malformed: "The damage is malformed.",
    issueMessage: true,
    gmOnly: GM_ONLY,
    async run({ request, execute }, kit) {
      let line: string | null = null;
      let events: ReturnType<typeof damageObject>["events"] = [];
      const { duplicate } = await execute((state) => {
        const hit = damageObject(state, request.target, request.parts);
        line = hit.destroyed
          ? `${hit.name} takes ${hit.damage.total} damage and is destroyed.`
          : `${hit.name} takes ${hit.damage.total} damage.`;
        events = hit.events;
      });
      if (duplicate || line === null) return;
      kit.context.appendLog({ kind: "damage", text: line, gmOnly: true });
      for (const event of events)
        kit.context.appendLog({ kind: "effect", text: event.text, actorIds: [event.actorId] });
    }
  }),

  defineCommand({
    type: "object.attack",
    operationId: "attackObject",
    description:
      "A creature attacks an object with one of its own attacks (SRD 5.2.1 Breaking Objects): a door or wall with object statistics, or what holds a creature (`actorId` and `effectId`: a Net, a giant spider's web). The server rolls the attack against the object's Armor Class (a natural 20 is a Critical Hit, a natural 1 a miss), checks the attack's reach or range, spends the attack as one against a creature would in a fight, and deals its damage through the object's defences and damage threshold. A Siege Monster deals double damage, and a Sword of Sharpness its dice's maximum. At 0 Hit Points the object is destroyed: a door or wall is gone from the map, and a creature held by it is free. A player is told whether it hit and whether the object broke, never its Armor Class or the Hit Points it has left. GM-grade for any creature; a player session for their own character.",
    summary: "Attack a door, a wall or a net with one of your attacks.",
    schema: ObjectAttackSchema,
    malformed: "The attack is malformed.",
    issueMessage: true,
    async run({ principal, request, execute }, kit) {
      const { actorId, actionId, target, commandId } = request;
      const player = !isGmGrade(principal);
      if (player && "actorId" in target && !kit.read().actors.some((actor) => actor.id === target.actorId))
        throw new GameAccessDeniedError("That object is no longer there.");
      const geometry = await kit.liveGeometry();
      let struck: ObjectStrike | null = null;
      const { duplicate } = await execute((state) => {
        const attacker = state.actors.find((actor) => actor.id === actorId);
        // A player may aim only at what is in their own view: a net on a creature hidden from them isn't.
        if (player && "actorId" in target && kit.unseenBy(initiatorOf(principal), state).has(target.actorId))
          throw new GameAccessDeniedError("That object is no longer there.");
        if (!findObject(state, target)) throw new GameAccessDeniedError("That object is no longer there.");
        struck = strikeObject(
          state,
          {
            actorId,
            actionId,
            target,
            commandId,
            ...(player ? {} : { rollMode: request.rollMode ?? null, override: request.override ?? null })
          },
          initiatorOf(principal),
          {
            definition: attacker?.definitionId ? kit.resolveDefinitionIn(state, attacker.definitionId) : undefined,
            resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
            catalog: kit.equipmentCatalog(),
            random: (sides) => kit.context.random(sides),
            newId: kit.context.newId,
            sessionId: sessionIdOf(principal),
            now: () => new Date().toISOString(),
            geometry,
            distanceFeet: (actorIdA, actorIdB) =>
              geometry ? (tokenCreatureDistance(state, geometry, actorIdA, actorIdB)?.value ?? null) : null
          }
        );
      });
      const result = struck as ObjectStrike | null;
      if (duplicate || !result) return {};
      kit.publishRolls(kit.read(), commandId);
      const name = kit.actorName(actorId);
      const told =
        result.outcome === "miss"
          ? `${name} attacks ${result.objectName} with ${result.attackName} and misses.`
          : result.hit?.destroyed
            ? `${name} ${result.outcome === "crit" ? "lands a Critical Hit on" : "hits"} ${result.objectName} with ${result.attackName}, and it breaks.`
            : `${name} ${result.outcome === "crit" ? "lands a Critical Hit on" : "hits"} ${result.objectName} with ${result.attackName}.`;
      kit.context.appendLog({ kind: "action", text: told, actorIds: [actorId], gmOnly: kit.actorHidden(actorId) });
      for (const event of result.events)
        kit.context.appendLog({ kind: "effect", text: event.text, actorIds: [event.actorId] });
      return {
        outcome: result.outcome,
        total: result.total,
        ...(result.hit ? { damage: result.hit.damage.total, destroyed: result.hit.destroyed } : {})
      };
    }
  })
];
