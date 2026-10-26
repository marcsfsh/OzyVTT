import {
  EnvironmentSetSchema,
  TrapDisarmSchema,
  TrapEditSchema,
  TrapPlaceSchema,
  TrapRemoveSchema,
  TrapSpringSchema
} from "@vtt/domain/commands";
import type { EffectNarration } from "../effects.js";
import { setEnvironment } from "../environment.js";
import { CommandRejectedError } from "../game-store.js";
import { disarmTrap, editTrap, placeTrap, removeTrap, springTrapByHand } from "../traps.js";
import { initiatorOf, sessionIdOf, type Kit } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Traps and the weather (SRD 5.2.1 Gameplay Toolbox): the GM sets traps on the map and the scene's climate; a creature
// beside a found trap makes it safe.

/** The geometry of the map a GM's edit targets: the live table's, or a prepared scene's. */
async function sceneGeometry(kit: Kit, sceneId: string | undefined, refusal: string) {
  const combat = kit.read().combat;
  const mapAssetId =
    sceneId === undefined
      ? combat.mapAssetId
      : (combat.scenes.find((scene) => scene.id === sceneId)?.mapAssetId ?? null);
  if (!mapAssetId) throw new CommandRejectedError(refusal);
  return kit.context.tokenGeometryFor(mapAssetId);
}

export const hazardCommands = [
  defineCommand({
    type: "trap.place",
    operationId: "placeTrap",
    description:
      "Sets one of the SRD 5.2.1 Gameplay Toolbox's traps on the map over a dragged area (GM-grade only), hidden from the players: Collapsing Roof, Falling Net, Fire-Casting Statue, Hidden Pit, Poisoned Darts, Poisoned Needle, Rolling Stone or Spiked Pit, at the band of levels `tier` names (1: levels 1-4, 2: 5-10, 3: 11-16, 4: 17-20), with that band's save DC and damage. The area snaps to whole grid cells. A creature that moves onto it sets it off (and, for a statue's plate, one that starts its turn there); it acts on that creature or on each creature in its blast, and the party learns of it then. A Search with Wisdom (Perception) or a Study with Intelligence (Investigation) within 10 feet whose total meets its DC finds it. `sceneId` targets a prepared scene.",
    summary: "Set a hidden trap on the map (GM).",
    schema: TrapPlaceSchema,
    malformed: "The trap is malformed.",
    issueMessage: true,
    gmOnly: "Only the GM sets traps.",
    async run({ principal, request, execute }, kit) {
      const { trapId, tier, rect, sceneId, commandId } = request;
      const geometry = await sceneGeometry(kit, sceneId, "Pick a map before setting a trap.");
      await execute((state) =>
        placeTrap(state, sceneId, geometry, { id: commandId, trapId, tier, rect }, initiatorOf(principal))
      );
    }
  }),

  defineCommand({
    type: "trap.edit",
    operationId: "editTrap",
    description:
      "Changes a trap on the map (GM-grade only): its band of levels (`tier`), the area its blast falls on when that isn't its own (a statue's Cone, the darts' path: `blast`, null for its own area), whether the party has found it (`found`: drawn for the players and the table with its name, never its DC), or arms it again or makes it safe (`state`). `sceneId` targets a prepared scene.",
    summary: "Change a trap: its band, its blast, found or not, armed or safe (GM).",
    schema: TrapEditSchema,
    malformed: "The trap change is malformed.",
    issueMessage: true,
    gmOnly: "Only the GM changes traps.",
    async run({ principal, request, execute }, kit) {
      const { trapId, tier, blast, found, state: trapState, sceneId } = request;
      const geometry = await sceneGeometry(kit, sceneId, "Pick a map before changing a trap.");
      await execute((state) =>
        editTrap(
          state,
          sceneId,
          geometry,
          {
            id: trapId,
            ...(tier !== undefined ? { tier } : {}),
            ...(blast !== undefined ? { blast } : {}),
            ...(found !== undefined ? { found } : {}),
            ...(trapState !== undefined ? { state: trapState } : {})
          },
          initiatorOf(principal)
        )
      );
    }
  }),

  defineCommand({
    type: "trap.remove",
    operationId: "removeTrap",
    description: "Takes a trap off the map (GM-grade only). `sceneId` targets a prepared scene.",
    summary: "Remove a trap (GM).",
    schema: TrapRemoveSchema,
    malformed: "The trap command is malformed.",
    gmOnly: "Only the GM removes traps.",
    async run({ principal, request, execute }) {
      await execute((state) => removeTrap(state, request.sceneId, request.trapId, initiatorOf(principal)));
    }
  }),

  defineCommand({
    type: "trap.spring",
    operationId: "springTrap",
    description:
      "Sets off a trap on the live map whose trigger the map can't see (GM-grade only): a needle in a lock opened without its key, a doorknob turned. It acts on the creature `actorId` names, or with null on each creature in its blast, with the server's dice.",
    summary: "Set off a trap by hand (GM).",
    schema: TrapSpringSchema,
    malformed: "The trap command is malformed.",
    gmOnly: "Only the GM sets off a trap by hand.",
    async run({ principal, request, execute }, kit) {
      let events: EffectNarration[] = [];
      const geometry = await kit.liveGeometry();
      const { duplicate } = await execute((state) => {
        events = springTrapByHand(state, request.trapId, request.actorId, initiatorOf(principal), {
          ...kit.zoneDeps(state, geometry),
          rollDie: (sides) => kit.context.random(sides)
        });
      });
      if (duplicate) return;
      kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "trap.disarm",
    operationId: "disarmTrap",
    description:
      "A creature within 5 feet of a trap the party has found makes it safe one of the trap's ways (`disarmId`, SRD 5.2.1 Gameplay Toolbox, Detect and Disarm): cut a trip wire or plug the dart holes, wedge an Iron Spike it carries under a plate or a pit's lid, deface a statue's glyph, or disarm a needle with a DC 15 Dexterity (Sleight of Hand) check, with Thieves' Tools where it carries them (the tools' \"disarm a trap\"), a failure setting the trap off on it. Each takes the Utilize action in a fight on the creature's turn, or with `bonusAction` a Thief's Bonus Action (Fast Hands). The server rolls the check. GM-grade for any creature; a player session for their own character, and only for a trap the party has found.",
    summary: "Make a found trap beside your character safe.",
    schema: TrapDisarmSchema,
    malformed: "The disarm is malformed.",
    issueMessage: true,
    async run({ principal, request, execute }, kit) {
      const { trapId, actorId, disarmId, bonusAction, commandId } = request;
      let events: EffectNarration[] = [];
      const geometry = await kit.liveGeometry();
      const { duplicate } = await execute((state) => {
        events = disarmTrap(
          state,
          initiatorOf(principal),
          { commandId, actorId, trapId, disarmId, ...(bonusAction !== undefined ? { bonusAction } : {}) },
          {
            ...kit.zoneDeps(state, geometry),
            random: (sides) => kit.context.random(sides),
            rollDie: (sides) => kit.context.random(sides),
            newId: kit.context.newId,
            commandId,
            sessionId: sessionIdOf(principal),
            now: () => new Date().toISOString(),
            resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
            catalog: kit.equipmentCatalog()
          }
        ).events;
      });
      if (duplicate) return {};
      kit.publishRolls(kit.read(), commandId);
      kit.publishNarrations(events);
      return { text: events.map((event) => event.text).join(" ") };
    }
  }),

  defineCommand({
    type: "environment.set",
    operationId: "setEnvironment",
    description:
      "Sets the scene's climate and weather (GM-grade only), SRD 5.2.1 Gameplay Toolbox, Environmental Effects; what is left out stays as it was. `cold` (0 degrees Fahrenheit or lower) and `heat` (100 or higher) ask each creature placed on the map a Constitution save at the end of each hour of game time or a level of Exhaustion: DC 10 against the cold, which Cold Resistance or a Bedroll it is in passes and a Blanket gives Advantage on; against the heat, for one carrying no water, DC 5 the first hour and 1 more each hour after, with Disadvantage in Medium or Heavy armor. `highAltitude` counts each hour travelled as 2 toward Extended Travel's 8. `precipitation` (rain or snow) makes everything Lightly Obscured and gives Disadvantage on Wisdom (Perception) checks; rain puts out open flames. `wind` (strong, or a sandstorm) gives Disadvantage on ranged weapon attack rolls, puts out open flames, disperses fog and brings down a flier that hasn't landed by the end of its turn; a sandstorm also gives Disadvantage on Wisdom (Perception) checks. `frigidWater` makes the painted water frigid (a DC 10 Constitution save each minute past a creature's Constitution score), and `deepWater` deep (a DC 10 Constitution save after each hour swum without a Swim Speed). `sceneId` targets a prepared scene.",
    summary: "Set the scene's climate and weather (GM).",
    schema: EnvironmentSetSchema,
    malformed: "The weather is malformed.",
    issueMessage: true,
    gmOnly: "Only the GM sets the weather.",
    async run({ principal, request, execute }) {
      await execute((state) => setEnvironment(state, request.sceneId, request.environment, initiatorOf(principal)));
    }
  })
];
