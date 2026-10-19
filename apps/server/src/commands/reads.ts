import type { z } from "zod";
import { contentRoutes, gameRoutes, type ApiRoute } from "@vtt/api-contract/routes";
import { ContentCompendiumRequestSchema, type GmView, type PlayerView, type SpellZone } from "@vtt/domain";
import { actionAvailability } from "../action-resolution.js";
import { deriveActorSheet } from "../actor-derived.js";
import { storedDefinition } from "../actor-roster.js";
import { GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { builderOffers } from "../builder-offers.js";
import { conversionOffers } from "../conversions.js";
import { draftOwnerOf } from "../character-drafts.js";
import { BUILTIN_TARGETING, builtinActionsFor } from "../builtin-actions.js";
import { builtinCheckSkills } from "../resolution/builtins.js";
import { actionSummariesOf, actionSummaryOf, type ContentView } from "../content-library.js";
import { effectiveActions } from "../effective-actions.js";
import { formsOffer } from "../transform/offer.js";
import { deriveEquipment } from "../equipment-derivation.js";
import { rechoicesOf } from "../ledger-rechoice.js";
import { receivedSpellChoices, spellChoicesOf } from "../spell-choices.js";
import { withMasteries } from "../weapon-masteries.js";
import {
  ActorAvailableActionsSchema,
  ActorCraftingOffersSchema,
  ActorMovementSchema,
  BuilderOffersSchema,
  CharacterNextLevelSchema,
  ContentActionsSchema,
  ContentMonsterActionsSchema,
  ScenePreviewSchema,
  VisionPreviewSchema
} from "@vtt/domain/commands";
import { srdMonsterBenchmarks } from "../monster-benchmarks.js";
import { compendiumOf } from "../homebrew-player.js";
import { partyViewerIds } from "../vision/audience.js";
import { flatPolygon } from "../vision/geometry.js";
import { sceneSight } from "../vision/sight.js";
import { movementStatus } from "../movement-rules.js";
import { spaceSharingFor } from "../space-sharing.js";
import { areaGroundFor } from "../zone-preview.js";
import { visibleToPlayerAnnotation } from "../projections.js";
import { previewScene } from "../scene-preview.js";
import { nextLevelOf } from "../next-level.js";
import { craftingOffers } from "../crafting.js";
import { craftingDeps } from "./crafting.js";
import { GameNotFoundError } from "./failures.js";
import { initiatorOf, isGmGrade, type GamePrincipal, type Kit } from "./kit.js";
import type { ReadSpec } from "./pipeline.js";

// The reads both transports serve. Every catalog is scoped to the caller through `catalogFor`, so a homebrew
// GM-only record never reaches a player; which reads a player may call at all is the `gmOnly` gate.

/** The rules catalogs any joined session may read, each with the CC-BY attribution its display must carry
 *  (ADR-0015): reference text, and the character builder's choices. */
const PUBLIC_CATALOGS = [
  ["content:conditions", contentRoutes.listContentConditions, "conditions", (catalog) => catalog.conditionSummaries()],
  ["content:glossary", contentRoutes.listContentGlossary, "glossary", (catalog) => catalog.glossaryEntries()],
  ["content:skills", contentRoutes.listContentSkills, "skills", (catalog) => catalog.skillSummaries()],
  ["content:languages", contentRoutes.listContentLanguages, "languages", (catalog) => catalog.languageSummaries()],
  ["content:spells", contentRoutes.listContentSpells, "spells", (catalog) => catalog.spellSummaries()],
  ["content:equipment", contentRoutes.listContentEquipment, "equipment", (catalog) => catalog.equipmentSummaries()],
  ["content:classes", contentRoutes.listContentClasses, "classes", (catalog) => catalog.classSummaries()],
  ["content:subclasses", contentRoutes.listContentSubclasses, "subclasses", (catalog) => catalog.subclassSummaries()],
  ["content:species", contentRoutes.listContentSpecies, "species", (catalog) => catalog.speciesSummaries()],
  [
    "content:backgrounds",
    contentRoutes.listContentBackgrounds,
    "backgrounds",
    (catalog) => catalog.backgroundSummaries()
  ],
  ["content:feats", contentRoutes.listContentFeats, "feats", (catalog) => catalog.featSummaries()],
  ["content:names", contentRoutes.listContentNames, "names", (catalog) => catalog.nameBundles()]
] as const satisfies ReadonlyArray<
  readonly [ReadSpec["event"], ApiRoute, string, (catalog: ContentView) => readonly unknown[]]
>;

const LogReadSchema = gameRoutes.getCombatLog.query;

export const gameReads = [
  ...PUBLIC_CATALOGS.map(([event, route, key, rows]) => ({
    event,
    route,
    run: (principal: GamePrincipal, _input: unknown, kit: Kit) => {
      const catalog = kit.catalogFor(principal);
      return { [key]: rows(catalog), attribution: catalog.attribution };
    }
  })),

  {
    event: "content:compendium",
    route: contentRoutes.getContentCompendium,
    schema: ContentCompendiumRequestSchema,
    malformed: "Pick a kind of record for the Compendium: class, subclass, species, background, feat, spell or item.",
    httpInput: ({ query }) => ({ kind: query.kind }),
    // The reader's own catalog: the SRD and the homebrew shown to everyone or to one of the caller's characters.
    run: (principal, input, kit) =>
      compendiumOf(kit.catalogFor(principal), (input as z.output<typeof ContentCompendiumRequestSchema>).kind)
  },

  {
    event: "content:monsters",
    route: contentRoutes.listContentMonsters,
    gmOnly: "Only the GM can browse bundled content.",
    run: (principal, _input, kit) => {
      const catalog = kit.catalogFor(principal);
      return { monsters: catalog.monsterSummaries(), attribution: catalog.attribution };
    }
  },

  {
    event: "content:monster-benchmarks",
    route: contentRoutes.listContentMonsterBenchmarks,
    gmOnly: "Only the GM writes monsters.",
    run: (principal, _input, kit) => ({
      benchmarks: srdMonsterBenchmarks(),
      attribution: kit.catalogFor(principal).attribution
    })
  },

  {
    event: "content:monster-actions",
    route: contentRoutes.getContentMonsterActions,
    gmOnly: "Only the GM can browse stat blocks.",
    schema: ContentMonsterActionsSchema,
    httpInput: ({ params, query }) => ({
      definitionId: params.definitionId,
      ...(typeof query.actorId === "string" ? { actorId: query.actorId } : {})
    }),
    malformed: "The action lookup is malformed.",
    run: (principal, input, kit) => {
      const { definitionId, actorId } = input as z.output<typeof ContentMonsterActionsSchema>;
      const catalog = kit.catalogFor(principal);
      const imported = storedDefinition(kit.read(), definitionId);
      // A combatant built from the stat block acts with what it carries too (a wand, a potion, a magic weapon), as
      // its own sheet's list has it; it reads the play-time stat block, so one on the table stays runnable.
      const combatant = actorId
        ? kit.read().actors.find((candidate) => candidate.id === actorId && candidate.definitionId === definitionId)
        : undefined;
      const played = combatant ? kit.resolveDefinition(definitionId) : undefined;
      // Browse uses the catalog's own lookup (honours draft/published/deleted), and leaves the play-time resolver out.
      const definition = played ?? imported ?? catalog.monster(definitionId);
      const playedActions = combatant && played ? effectiveActions(played, combatant, kit.equipmentCatalog()) : [];
      const actions =
        combatant && played
          ? actionSummariesOf([...playedActions]).map((summary, index) => {
              // A Shape-Shift offers its forms and aims at no one; leaving a form too.
              const action = playedActions[index]!;
              if (!action.shapeShift && !action.endsForm && !action.effectOptions) return summary;
              return {
                ...summary,
                ...(action.shapeShift
                  ? { forms: formsOffer(kit.read(), combatant, action, played, kit.equipmentCatalog()) }
                  : {}),
                ...(action.effectOptions
                  ? { options: action.effectOptions.map((option) => ({ id: option.id, name: option.name })) }
                  : {}),
                ...(action.endsForm || (action.shapeShift && !action.shapeShift.onTargets && !action.save)
                  ? { targeting: "none" as const }
                  : {})
              };
            })
          : imported
            ? actionSummariesOf(imported.actions)
            : catalog.monsterActionSummaries(definitionId);
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
    route: contentRoutes.getContentMonster,
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
    route: gameRoutes.getActorAvailableActions,
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
      const builtins = builtinActionsFor(definition, actor).filter(
        (candidate) => !available.some((declared) => declared.id === candidate.id)
      );
      const derivation = deriveEquipment(actor, definition, catalog);
      return {
        rulesMode: state.combat.rulesMode,
        // Each mastered swing names its property, from the same derivation the resolver reads it from.
        actions: withMasteries(
          [
            ...actionAvailability(state, actor, available, definition, false, available, catalog),
            ...actionAvailability(state, actor, builtins, definition, true, available, catalog)
          ],
          derivation
        ),
        // Derived numbers are computed only after the authorization gate above, which is why they ride a
        // request and is never on the broadcast projection (see `actor-derived.ts`).
        // The class table's columns read the classes the sheet already has, as play does.
        derived: deriveActorSheet(
          actor,
          definition,
          derivation,
          kit.catalogFor(principal).skillSummaries(),
          catalog,
          (id) => kit.playCatalog().classRecord(id)
        ),
        // Read against what the sheet already has, as `actor.rechoose` checks them.
        rechoices: rechoicesOf(actor, definition, kit.playCatalog()),
        // Read against the sheet's content and the table's builder policy, as the swap and the spellbook check them,
        // and offered only where the caller receives the spell, so another character's homebrew is never named.
        spellChoices: receivedSpellChoices(
          spellChoicesOf(actor, definition, kit.playCatalog(), state.builderPolicy),
          kit.catalogFor(principal)
        ),
        // Checked as `actor.convert` checks them, so a control the sheet offers is one the server applies.
        conversions: conversionOffers(state, actor, { resolveDefinition: kit.resolveDefinition, catalog })
      };
    }
  },

  {
    event: "character:draft",
    route: gameRoutes.getCharacterDraft,
    // Only ever the caller's own: the owner comes from the signed principal, never from the request.
    run: (principal, _input, kit) => ({ draft: kit.context.characterDrafts.get(draftOwnerOf(principal)) })
  },

  {
    event: "actor:movement",
    route: gameRoutes.getActorMovement,
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
      const initiator = initiatorOf(principal);
      // The preview charges what the server will: a creature that shares spaces passes others, and anyone may cross a
      // swarm. A player hears only of swarms their characters can see.
      const hidden = initiator.role === "gm" ? () => false : kit.hiddenFor(initiator, state);
      // The ground the spell areas change for the mover, of those the asker can see: a placed area by its template's
      // visibility, one around its caster by the caster's.
      const mapAssetId = state.combat.mapAssetId;
      const calibration = mapAssetId
        ? (kit.context.mapCatalog.get(mapAssetId)?.calibration?.calibration ?? null)
        : null;
      const sessionId = initiator.role === "player" ? initiator.sessionId : undefined;
      const seen = (zone: SpellZone) => {
        if (initiator.role === "gm") return true;
        const annotation = zone.annotationId
          ? state.combat.annotations.find((candidate) => candidate.id === zone.annotationId)
          : undefined;
        return annotation ? visibleToPlayerAnnotation(state, annotation, sessionId) : !hidden(zone.casterId);
      };
      const areaGround = calibration
        ? areaGroundFor(
            state,
            actorId,
            {
              geometry: { width: 0, height: 0, calibration },
              resolveDefinition: (definitionId) => kit.resolveDefinition(definitionId),
              catalog: kit.equipmentCatalog()
            },
            seen
          )
        : undefined;
      return {
        ...movementStatus(state, actorId, {
          resolveDefinition: (definitionId) => kit.resolveDefinition(definitionId),
          catalog: kit.equipmentCatalog()
        }),
        ...spaceSharingFor(state, actorId, (definitionId) => kit.resolveDefinition(definitionId), hidden),
        ...(areaGround ? { areaGround } : {})
      };
    }
  },

  {
    event: "character:next-level",
    route: gameRoutes.getCharacterNextLevel,
    schema: CharacterNextLevelSchema,
    malformed: "The next-level lookup is malformed.",
    // Answered only to someone who may level the character: the GM always, a player their own while the table's
    // builder is open, as `character.rebuild` checks.
    run: (principal, input, kit) => {
      const state = kit.read();
      const actorId = (input as z.output<typeof CharacterNextLevelSchema>).actorId;
      if (!isGmGrade(principal) && state.builderPolicy.playerBuilder !== "open")
        throw new GameAccessDeniedError("Your GM builds the characters at this table.");
      // One answer for a missing character and someone else's, so a player can't probe which ids exist.
      requireActorAccess(
        initiatorOf(principal),
        state,
        actorId,
        "edit",
        "You can only read your own character's next level."
      );
      const actor = state.actors.find((candidate) => candidate.id === actorId);
      if (!actor) throw new GameNotFoundError("That character no longer exists.");
      const definition = actor.definitionId ? storedDefinition(state, actor.definitionId) : undefined;
      return nextLevelOf(actor, definition, kit.catalogFor(principal), state.builderPolicy);
    }
  },

  {
    event: "actor:crafting-offers",
    route: gameRoutes.getActorCraftingOffers,
    schema: ActorCraftingOffersSchema,
    malformed: "The crafting lookup is malformed.",
    // Its owner or the GM, from the reader's own catalog, so a player sees only what they may craft.
    run: (principal, input, kit) => {
      const state = kit.read();
      const actorId = (input as z.output<typeof ActorCraftingOffersSchema>).actorId;
      requireActorAccess(initiatorOf(principal), state, actorId, "resource", "You can only read your own character.");
      const actor = state.actors.find((candidate) => candidate.id === actorId);
      if (!actor) throw new GameNotFoundError("That character no longer exists.");
      return craftingOffers(actor, craftingDeps(kit, principal, state));
    }
  },

  {
    event: "builder:offers",
    route: gameRoutes.getBuilderOffers,
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
    route: gameRoutes.previewVision,
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
    event: "scene:preview",
    route: gameRoutes.previewScene,
    gmOnly: "Only the GM can preview a scene.",
    schema: ScenePreviewSchema,
    malformed: "The scene preview is malformed.",
    httpInput: ({ params, query }) => ({
      sceneId: params.sceneId,
      ...(typeof query.actorId === "string" ? { actorId: query.actorId } : {})
    }),
    // The GM's own look: the projections run over a copy where the scene is live, and nothing is committed.
    run: (_principal, input, kit) =>
      previewScene(kit.read(), input as z.output<typeof ScenePreviewSchema>, {
        content: kit.sightContent(),
        playerView: (state, sessionId) => kit.context.playerView(state, sessionId)
      })
  },

  {
    event: "log:read",
    route: gameRoutes.getCombatLog,
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
    route: gameRoutes.getSoundBoard,
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
