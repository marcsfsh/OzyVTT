import { z } from "zod";
import { CONTENT_PATHS, GAME_PATHS } from "@vtt/api-contract";
import type { GmView, PlayerView } from "@vtt/domain";
import { actionAvailability } from "../action-resolution.js";
import { deriveActorSheet } from "../actor-derived.js";
import { storedDefinition } from "../actor-roster.js";
import { GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { builderOffers } from "../builder-offers.js";
import { draftOwnerOf } from "../character-drafts.js";
import { BUILTIN_TARGETING, builtinActionsFor } from "../builtin-actions.js";
import { builtinCheckSkills } from "../resolution/builtins.js";
import { actionSummariesOf, actionSummaryOf, type ContentView } from "../content-library.js";
import { effectiveActions } from "../effective-actions.js";
import { deriveEquipment } from "../equipment-derivation.js";
import { rechoicesOf } from "../ledger-rechoice.js";
import { spellChoicesOf } from "../spell-choices.js";
import {
  ActorAvailableActionsSchema,
  ActorMovementSchema,
  BuilderOffersSchema,
  ContentActionsSchema,
  VisionPreviewSchema
} from "@vtt/domain/commands";
import { partyViewerIds } from "../vision/audience.js";
import { flatPolygon } from "../vision/geometry.js";
import { sceneSight } from "../vision/sight.js";
import { movementStatus } from "../movement-rules.js";
import { GameNotFoundError } from "./failures.js";
import { initiatorOf, isGmGrade, type GamePrincipal, type Kit } from "./kit.js";
import type { ReadSpec } from "./pipeline.js";

// The reads both transports serve. Every catalog is scoped to the caller through `catalogFor`, so a homebrew
// GM-only record never reaches a player; which reads a player may call at all is the `gmOnly` gate.

/** The rules catalogs any joined session may read, each with the CC-BY attribution its display must carry
 *  (ADR-0015): reference text, and the character builder's choices. */
const PUBLIC_CATALOGS = [
  ["content:conditions", CONTENT_PATHS.conditions, "conditions", (catalog) => catalog.conditionSummaries()],
  ["content:glossary", CONTENT_PATHS.glossary, "glossary", (catalog) => catalog.glossaryEntries()],
  ["content:skills", CONTENT_PATHS.skills, "skills", (catalog) => catalog.skillSummaries()],
  ["content:languages", CONTENT_PATHS.languages, "languages", (catalog) => catalog.languageSummaries()],
  ["content:spells", CONTENT_PATHS.spells, "spells", (catalog) => catalog.spellSummaries()],
  ["content:equipment", CONTENT_PATHS.equipment, "equipment", (catalog) => catalog.equipmentSummaries()],
  ["content:classes", CONTENT_PATHS.classes, "classes", (catalog) => catalog.classSummaries()],
  ["content:subclasses", CONTENT_PATHS.subclasses, "subclasses", (catalog) => catalog.subclassSummaries()],
  ["content:species", CONTENT_PATHS.species, "species", (catalog) => catalog.speciesSummaries()],
  ["content:backgrounds", CONTENT_PATHS.backgrounds, "backgrounds", (catalog) => catalog.backgroundSummaries()],
  ["content:feats", CONTENT_PATHS.feats, "feats", (catalog) => catalog.featSummaries()],
  ["content:names", CONTENT_PATHS.names, "names", (catalog) => catalog.nameBundles()]
] as const satisfies ReadonlyArray<
  readonly [ReadSpec["event"], string, string, (catalog: ContentView) => readonly unknown[]]
>;

const LogReadSchema = z.object({ limit: z.number().int().min(1).max(1000).optional() }).strict();

export const gameReads = [
  ...PUBLIC_CATALOGS.map(([event, path, key, rows]) => ({
    event,
    path,
    scope: "game:read" as const,
    run: (principal: GamePrincipal, _input: unknown, kit: Kit) => {
      const catalog = kit.catalogFor(principal);
      return { [key]: rows(catalog), attribution: catalog.attribution };
    }
  })),

  {
    event: "content:monsters",
    path: CONTENT_PATHS.monsters,
    scope: "game:read",
    gmOnly: "Only the GM can browse bundled content.",
    run: (principal, _input, kit) => {
      const catalog = kit.catalogFor(principal);
      return { monsters: catalog.monsterSummaries(), attribution: catalog.attribution };
    }
  },

  {
    event: "content:monster-actions",
    path: CONTENT_PATHS.monsterActions,
    scope: "game:read",
    gmOnly: "Only the GM can browse stat blocks.",
    schema: ContentActionsSchema,
    malformed: "The action lookup is malformed.",
    run: (principal, input, kit) => {
      const { definitionId } = input as z.output<typeof ContentActionsSchema>;
      const catalog = kit.catalogFor(principal);
      const imported = storedDefinition(kit.read(), definitionId);
      // Browse uses the catalog's own lookup (honours draft/published/deleted), not the play-time resolver.
      const definition = imported ?? catalog.monster(definitionId);
      const actions = imported ? actionSummariesOf(imported.actions) : catalog.monsterActionSummaries(definitionId);
      if (!actions) throw new GameNotFoundError("That stat block is not in the bundled content.");
      // SRD generic actions (Dodge, Dash, Help, ...) follow the stat block's own; a declared id shadows its builtin.
      const builtins = builtinActionsFor(definition)
        .filter((candidate) => !definition?.actions.some((declared) => declared.id === candidate.id))
        .map((candidate) => {
          // Search, Study, Influence and Escape a Grapple are made with a skill the roller picks.
          const checkSkills = builtinCheckSkills(candidate.id);
          return {
            ...actionSummaryOf(candidate),
            builtin: true,
            targeting: BUILTIN_TARGETING[candidate.id] ?? ("none" as const),
            ...(checkSkills.length > 0 ? { checkSkills } : {})
          };
        });
      return {
        actions: [...actions, ...builtins],
        ...(definition?.legendary ? { legendary: definition.legendary } : {})
      };
    }
  },

  {
    event: "content:monster-sheet",
    path: CONTENT_PATHS.monsterById,
    scope: "game:read",
    gmOnly: "Only the GM can read stat blocks.",
    schema: ContentActionsSchema,
    malformed: "The stat-block lookup is malformed.",
    run: (_principal, input, kit) => {
      // Often reached from a live token, so it uses the play-time resolver: a soft-deleted creature still on
      // the table must stay readable.
      const definition = kit.resolveDefinition((input as z.output<typeof ContentActionsSchema>).definitionId);
      if (!definition) throw new GameNotFoundError("That stat block is not in the bundled content.");
      return { definition };
    }
  },

  {
    event: "actor:available-actions",
    path: GAME_PATHS.actorAvailableActions,
    scope: "combat:read",
    schema: ActorAvailableActionsSchema,
    malformed: "The availability lookup is malformed.",
    // The same evaluation as resolution, read-only. GM-grade any combatant; a player their own.
    run: (principal, input, kit) => {
      const state = kit.read();
      const actorId = (input as z.output<typeof ActorAvailableActionsSchema>).actorId;
      // Access first: a missing creature and someone else's get one answer, so a player can't probe which ids exist.
      requireActorAccess(
        initiatorOf(principal),
        state,
        actorId,
        "check",
        "You can only check your own character's actions."
      );
      const actor = state.actors.find((candidate) => candidate.id === actorId);
      if (!actor) throw new GameNotFoundError("That combatant no longer exists.");
      const definition = actor.definitionId ? kit.resolveDefinition(actor.definitionId) : undefined;
      if (actor.definitionId && !definition) throw new GameNotFoundError("That combatant's stat block is unavailable.");
      // Stat-block rows, then builtins. The effective list, so item-derived actions and raised pool limits show.
      const catalog = kit.equipmentCatalog();
      const available = effectiveActions(definition, actor, catalog);
      const builtins = builtinActionsFor(definition).filter(
        (candidate) => !available.some((declared) => declared.id === candidate.id)
      );
      return {
        rulesMode: state.combat.rulesMode,
        actions: [
          ...actionAvailability(state, actor, available, definition, false, available, catalog),
          ...actionAvailability(state, actor, builtins, definition, true, available, catalog)
        ],
        // Derived numbers are computed only after the authorization gate above, which is why they ride a
        // request rather than the broadcast projection (see `actor-derived.ts`).
        derived: deriveActorSheet(
          actor,
          definition,
          deriveEquipment(actor, definition, catalog),
          kit.catalogFor(principal).skillSummaries(),
          catalog
        ),
        // Read against the GM's content, as `actor.rechoose` checks them.
        rechoices: rechoicesOf(actor, definition, kit.contentLibrary.forAudience("gm")),
        // Read against the GM's content and the table's builder policy, as the swap and the spellbook check them.
        spellChoices: spellChoicesOf(actor, definition, kit.contentLibrary.forAudience("gm"), state.builderPolicy)
      };
    }
  },

  {
    event: "character:draft",
    path: GAME_PATHS.characterDraft,
    scope: "game:read",
    // Only ever the caller's own: the owner comes from the signed principal, never from the request.
    run: (principal, _input, kit) => ({ draft: kit.context.characterDrafts.get(draftOwnerOf(principal)) })
  },

  {
    event: "actor:movement",
    path: GAME_PATHS.actorMovement,
    scope: "combat:read",
    schema: ActorMovementSchema,
    malformed: "The movement lookup is malformed.",
    // The budget a move is charged against, for the map's drag preview. GM-grade any combatant; a player their own.
    run: (principal, input, kit) => {
      const state = kit.read();
      const actorId = (input as z.output<typeof ActorMovementSchema>).actorId;
      // Access first, as for the actions read: one answer for a missing creature and someone else's.
      requireActorAccess(
        initiatorOf(principal),
        state,
        actorId,
        "check",
        "You can only check your own character's movement."
      );
      if (!state.actors.some((candidate) => candidate.id === actorId))
        throw new GameNotFoundError("That combatant no longer exists.");
      return movementStatus(state, actorId, {
        resolveDefinition: (definitionId) => kit.resolveDefinition(definitionId),
        catalog: kit.equipmentCatalog()
      });
    }
  },

  {
    event: "builder:offers",
    path: GAME_PATHS.builderOffers,
    scope: "game:read",
    schema: BuilderOffersSchema,
    malformed: "The builder draft is malformed.",
    // Over HTTP the draft is one JSON-encoded `draft` query parameter.
    httpInput: ({ query }) => {
      try {
        return typeof query.draft === "string" ? JSON.parse(query.draft) : undefined;
      } catch {
        return undefined;
      }
    },
    // The same gate as `character.create` and `character.rebuild`: a player builds only while the table lets
    // them. The caller's catalog keeps GM-only homebrew out of a player's offers.
    run: (principal, input, kit) => {
      if (!isGmGrade(principal) && kit.read().builderPolicy.playerBuilder !== "open")
        throw new GameAccessDeniedError("Your GM builds the characters at this table.");
      return builderOffers(input as z.output<typeof BuilderOffersSchema>, kit.catalogFor(principal));
    }
  },

  {
    event: "vision:preview",
    path: GAME_PATHS.visionPreview,
    scope: "scene:read",
    gmOnly: "Only the GM can look through a creature's eyes.",
    schema: VisionPreviewSchema,
    malformed: "The vision preview is malformed.",
    httpInput: ({ query }) => (typeof query.actorId === "string" ? { actorId: query.actorId } : {}),
    // The same sight the projections use: one creature's, or the whole party's when none is named.
    run: (_principal, input, kit) => {
      const state = kit.read();
      const { actorId } = input as z.output<typeof VisionPreviewSchema>;
      if (actorId !== undefined && !state.actors.some((actor) => actor.id === actorId))
        throw new GameNotFoundError("That combatant no longer exists.");
      const sight = sceneSight(state, kit.sightContent());
      if (!sight.enabled) return { enabled: false, visible: [], actorIds: [] };
      const viewers = actorId === undefined ? partyViewerIds(state) : [actorId];
      const perceived = sight.perceivedBy(viewers);
      return {
        enabled: true,
        // As the projections draw it: no light carried by a creature these eyes don't perceive.
        visible: sight.areaOf(viewers, (carrierId) => perceived.has(carrierId)).map(flatPolygon),
        actorIds: [...perceived]
      };
    }
  },

  {
    event: "log:read",
    path: GAME_PATHS.log,
    scope: "combat:read",
    schema: LogReadSchema,
    malformed: "limit must be an integer between 1 and 1000.",
    httpInput: ({ query }) => (query.limit === undefined ? {} : { limit: Number(query.limit) }),
    // The player's session id is what unlocks their own `self-only` rolls.
    run: (principal, input, kit) => ({
      entries: kit.context.combatLog.list(
        isGmGrade(principal),
        (input as z.output<typeof LogReadSchema>).limit,
        principal.kind === "player" ? principal.sessionId : undefined
      )
    })
  },

  {
    event: "sound:board",
    path: GAME_PATHS.sound,
    scope: "scene:read",
    gmOnly: "Only the GM controls the table's sound.",
    run: (_principal, _input, kit) => {
      if (!kit.context.sound) throw new GameNotFoundError("Sound is not available on this server.");
      return { view: kit.context.sound.view() };
    }
  }
] satisfies readonly ReadSpec[];

/** The state projection for a principal: GM-grade gets the GM view unless it asks for the player one;
 *  a player only ever gets theirs. */
export function viewFor(
  kit: Kit,
  principal: GamePrincipal,
  requested?: "gm" | "player"
): { view: "gm" | "player"; game: GmView | PlayerView } {
  const state = kit.read();
  if (!isGmGrade(principal) || requested === "player")
    return {
      view: "player",
      game: kit.context.playerView(state, principal.kind === "player" ? principal.sessionId : undefined)
    };
  return { view: "gm", game: kit.context.gmView(state) };
}
