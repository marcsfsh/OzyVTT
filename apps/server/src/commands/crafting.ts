import {
  CraftingCancelSchema,
  CraftingHelpSchema,
  CraftingStartSchema,
  CraftingWorkSchema
} from "@vtt/domain/commands";
import type { EquipmentReference } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import { cancelCraft, logCraftDays, setCraftHelper, startCraft, type CraftingDeps } from "../crafting.js";
import type { EffectNarration } from "../effects.js";
import { equipmentCatalogOf } from "../equipment-derivation.js";
import { initiatorOf, type GamePrincipal, type Kit } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Crafting as downtime (SRD 5.2.1 Crafting Nonmagical Items, Brewing Potions of Healing, Scribing Spell Scrolls,
// Crafting Magic Items): `crafting.ts` holds the rules.

/** What a project may be made from: the records the caller's catalog holds, so a player crafts only what they can
 *  read. */
export function craftingDeps(kit: Kit, principal: GamePrincipal, draft: GameState): CraftingDeps {
  const view = kit.catalogFor(principal);
  return {
    catalog: equipmentCatalogOf(view),
    items: () =>
      view
        .equipmentSummaries()
        .map((summary) => view.equipmentRecord(summary.id))
        .filter((record): record is EquipmentReference => record !== undefined),
    resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
    random: (sides) => kit.context.random(sides)
  };
}

export const craftingCommands = [
  defineCommand({
    type: "crafting.start",
    operationId: "startCrafting",
    description:
      "A character starts a crafting project as downtime (SRD 5.2.1 Crafting). A nonmagical item is one a tool's Craft line names (or a band it names: Smith's Tools' melee weapons and medium and heavy armor, Woodcarver's Tools' ranged weapons): the character needs proficiency with that tool and the tool in the pack, its raw materials cost half the item's price (round down) and it takes the price in GP divided by 10 days of 8 hours, a fraction rounded up. A Potion of Healing takes the Herbalism Kit, 25 GP and 1 day. A Spell Scroll (`itemId` spell-scroll with `spellId`) takes proficiency in Arcana or with Calligrapher's Supplies, the supplies in the pack, the spell prepared and its priced Material components at hand (or a Component Pouch or focus for the rest), and the Spell Scroll Costs table's days and gold; the finished scroll has the scribe's spell save DC and attack bonus, and a cantrip on it works at the scribe's level. A magic item takes proficiency in Arcana, the Magic Item Tools table's tool (a weapon's or armor's base's maker, `baseId` naming the base), every spell it casts prepared, and the Magic Item Crafting table's days and gold by rarity, halved for a consumable; a base the character carries is used, else its price is paid too. `toolId` picks the tool when more than one can. The raw materials are paid from the purse now. Refused in an encounter. GM-grade for any character; a player session only for their own claimed character.",
    summary: "Start crafting an item, a potion, a scroll or a magic item as downtime.",
    schema: CraftingStartSchema,
    malformed: "The crafting project is malformed.",
    async run({ principal, request, execute }, kit) {
      let line = "";
      const { duplicate } = await execute((draft) => {
        line = startCraft(
          draft,
          {
            actorId: request.actorId,
            itemId: request.itemId,
            ...(request.spellId !== undefined ? { spellId: request.spellId } : {}),
            ...(request.baseId !== undefined ? { baseId: request.baseId } : {}),
            ...(request.toolId !== undefined ? { toolId: request.toolId } : {})
          },
          initiatorOf(principal),
          { ...craftingDeps(kit, principal, draft), newId: kit.context.newId }
        );
      });
      if (duplicate) return;
      kit.context.appendLog({
        kind: "action",
        text: line,
        actorIds: [request.actorId],
        gmOnly: kit.actorHidden(request.actorId)
      });
    }
  }),

  defineCommand({
    type: "crafting.help",
    operationId: "helpCrafting",
    description:
      'A character joins a crafting project as a helper (`helping: true`) or leaves it. SRD 5.2.1 Crafting: "Characters can combine their efforts to shorten the crafting time ... Normally, only one other character can assist you, but the GM might allow more assistants", and "Anyone who helps you must also have proficiency with" the tool (and in Arcana for a magic item). Each helper\'s day of work counts beside the crafter\'s. A player session joins its own claimed character to a project with no helper yet; the GM adds up to six.',
    summary: "Help with a crafting project, or stop helping.",
    schema: CraftingHelpSchema,
    malformed: "The crafting help is malformed.",
    async run({ principal, request, execute }, kit) {
      let line = "";
      const { duplicate } = await execute((draft) => {
        line = setCraftHelper(
          draft,
          { projectId: request.projectId, actorId: request.actorId, helping: request.helping },
          initiatorOf(principal),
          craftingDeps(kit, principal, draft)
        );
      });
      if (duplicate) return;
      kit.context.appendLog({
        kind: "action",
        text: line,
        actorIds: [request.actorId],
        gmOnly: kit.actorHidden(request.actorId)
      });
    }
  }),

  defineCommand({
    type: "crafting.work",
    operationId: "logCraftingDays",
    description:
      "GM-only: logs days of downtime work on a crafting project with no time passing on the clock (time.pass with `downtime` passes the time and works it too): each day is 8 hours of the crafter's work and 8 of each helper's. A crafter that must have a spell prepared each day of the work and hasn't is refused. A finished project's item joins its crafter's pack.",
    summary: "Log days of downtime work on a crafting project (GM).",
    schema: CraftingWorkSchema,
    malformed: "The downtime log is malformed.",
    gmOnly: "Only the GM logs downtime.",
    async run({ principal, request, execute }, kit) {
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((draft) => {
        events = logCraftDays(
          draft,
          { projectId: request.projectId, days: request.days },
          initiatorOf(principal),
          craftingDeps(kit, principal, draft)
        );
      });
      if (duplicate) return;
      kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "crafting.cancel",
    operationId: "cancelCrafting",
    description:
      "Calls off a crafting project. The raw materials paid for it are spent. The crafter's player or the GM.",
    summary: "Call off a crafting project.",
    schema: CraftingCancelSchema,
    malformed: "The crafting command is malformed.",
    async run({ principal, request, execute }, kit) {
      let done: Readonly<{ line: string; crafterId: string }> | null = null;
      const { duplicate } = await execute((draft) => {
        done = cancelCraft(draft, request.projectId, initiatorOf(principal));
      });
      const cancelled = done as Readonly<{ line: string; crafterId: string }> | null;
      if (duplicate || !cancelled) return;
      kit.context.appendLog({
        kind: "action",
        text: cancelled.line,
        actorIds: [cancelled.crafterId],
        gmOnly: kit.actorHidden(cancelled.crafterId)
      });
    }
  })
];
