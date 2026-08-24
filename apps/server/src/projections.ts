import type { Annotation, GameState, GmView, PlayerAnnotation, PlayerCombatView, PlayerEffect, PlayerHp, PlayerInitiativeEntry, PlayerRollRecord, PlayerView, PresenceStatus, RollRecord } from "@vtt/domain";
import { actionPools } from "./effective-actions.js";
import { healthBandOf } from "./hit-points.js";

type PresenceLookup = (sessionId: string) => PresenceStatus | null;

/**
 * Party members stay exact for each other; monster/NPC hit points reach players only as a coarse band.
 *
 * EXPORTED so the replay projection (`replay-projection.ts`) applies the identical rule to an
 * archived state instead of restating it. No field is added or widened by the export - the point is
 * that there is ONE definition of what a player may know about a creature's hit points.
 */
export function playerHp(actor: GameState["actors"][number]): PlayerHp {
  return actor.kind === "player-character"
    ? { kind: "exact", current: actor.hp.current, maximum: actor.hp.maximum, temporary: actor.hp.temporary }
    : { kind: "band", band: healthBandOf(actor.hp) };
}

function visibleToPlayer(roll: RollRecord, playerSessionId?: string) {
  return roll.visibility === "public" || (roll.visibility === "self-only" && roll.initiatorSessionId === playerSessionId);
}

function safeRoll(roll: RollRecord): PlayerRollRecord {
  const { initiatorSessionId: _privateSession, ...visible } = roll;
  return visible;
}

/** Display labels for condition badges ("Prone", "Exhaustion 3") - public info, safe for players and the shared screen (which has no rules-reference lookup of its own). */
export function conditionLabels(actor: GameState["actors"][number]): readonly string[] {
  return actor.conditions.map((condition) => `${condition.id.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ")}${condition.level !== undefined ? ` ${condition.level}` : ""}`);
}

export function projectPublicInitiative(state: GameState): readonly PlayerInitiativeEntry[] {
  const publicActors = new Map(state.actors.filter((actor) => actor.visibility === "public").map((actor) => [actor.id, actor]));
  return state.combat.initiative.flatMap((entry) => {
    const actor = publicActors.get(entry.actorId);
    // Conditions travel as parallel ids + labels (like the viewer token) so players and the shared
    // screen render the same dots from one source; public actors only, so nothing hidden leaks.
    return actor ? [{ actorId: actor.id, name: actor.name, score: entry.score, active: state.combat.active && state.combat.turnActorId === actor.id, health: healthBandOf(actor.hp), conditionIds: actor.conditions.map((condition) => condition.id), conditions: conditionLabels(actor) }] : [];
  });
}

function visibleToPlayerAnnotation(state: GameState, annotation: Annotation, playerSessionId: string | undefined) {
  switch (annotation.visibility) {
    case "public": return true;
    case "gm-only": return false;
    case "owner-only":
    case "owner-gm": return annotation.ownerSessionId === playerSessionId;
    case "gm-actor": return playerSessionId !== undefined && state.actors.some((actor) => actor.id === annotation.visibleToActorId && actor.ownerSessionId === playerSessionId);
  }
}

function safeAnnotation(annotation: Annotation, playerSessionId: string | undefined): PlayerAnnotation {
  const { ownerSessionId, ...visible } = annotation;
  return { ...visible, mine: ownerSessionId === playerSessionId };
}

export function projectPlayerAnnotations(state: GameState, playerSessionId: string | undefined, now: number): readonly PlayerAnnotation[] {
  return state.combat.annotations
    .filter((annotation) => (annotation.expiresAt === null || annotation.expiresAt > now) && visibleToPlayerAnnotation(state, annotation, playerSessionId))
    .map((annotation) => safeAnnotation(annotation, playerSessionId));
}

/**
 * THE ONE MASK a hidden source's identity collapses to. A constant rather than five string literals
 * because it is now written into more than one FIELD of more than one projection, and two of them
 * sit side by side on the same chip - a drift between them would read as two different creatures.
 */
const HIDDEN_SOURCE = "A hidden threat";

/**
 * SCRUB A HIDDEN SOURCE'S REAL NAME OUT OF A FREE-FORM DISPLAY STRING.
 *
 * `sourceName` is a field and can simply be replaced. `name` cannot: it is the chip's own label
 * ("Slowed by Vashkar", "Grappled by Vashkar", "Restrained by Vashkar (Bite)"), so blanking it
 * leaves the player an empty chip - a worse bug than the leak. Four separate authoring sites build
 * that label by interpolating the attacker's name (`weapon-mastery.ts` slow/sap,
 * `action-resolution.ts` on-hit riders and the unarmed Grapple), and a fifth WILL be written: `slow`
 * re-introduced exactly what `sap` had already done. So the substitution happens HERE, at the
 * security boundary, and covers every present and future site that follows the "<Something> by
 * <sourceName>" convention rather than an allow-list that a new site is not on.
 *
 * WORD-BOUNDARY, NOT `replaceAll`. A two-letter creature called "Al" would otherwise turn "Alarmed"
 * into gibberish in an unrelated sentence, so the match must not be flanked by a letter or a digit -
 * which also makes a short name safe rather than special-cased. An empty or whitespace-only
 * `sourceName` names nobody and is left alone: there is nothing to find and a zero-width pattern
 * would rewrite the whole string.
 *
 * It is a MASK, not an escape hatch: what it cannot see (a nickname, a title the label spelled a
 * different way) it cannot remove, which is why the resolver must never put anything on a
 * player-facing string that is not already the source's own `sourceName`.
 */
function withoutSourceName(text: string, sourceName: string | null): string {
  const needle = sourceName?.trim() ?? "";
  if (needle.length === 0) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), HIDDEN_SOURCE);
}

export function projectPlayerCombat(state: GameState, playerSessionId?: string, now = Date.now()): PlayerCombatView {
  const initiative = projectPublicInitiative(state);
  const publicActorIds = new Set(state.actors.filter((actor) => actor.visibility === "public").map((actor) => actor.id));
  const currentIsPublic = initiative.some((entry) => entry.active);
  return {
    active: state.combat.active,
    round: state.combat.round,
    turnActorId: currentIsPublic ? state.combat.turnActorId : null,
    mapAssetId: state.combat.active ? state.combat.mapAssetId : null,
    hiddenTurn: state.combat.active && state.combat.turnActorId !== null && !currentIsPublic,
    initiative,
    tokens: state.combat.active ? state.combat.tokens.filter((token) => publicActorIds.has(token.actorId)) : [],
    annotations: state.combat.active ? projectPlayerAnnotations(state, playerSessionId, now) : [],
    // A hidden combatant's turn stays opaque: economy flags (and the compound-action instance /
    // per-turn uses, which name stat-block action ids) reset to idle rather than narrating its activity.
    turn: currentIsPublic
      ? { actionUsed: state.combat.turn.actionUsed, bonusActionUsed: state.combat.turn.bonusActionUsed, actionInstance: state.combat.turn.actionInstance ? { actorId: state.combat.turn.actionInstance.actorId, components: { ...state.combat.turn.actionInstance.components } } : null, turnUses: { ...state.combat.turn.turnUses }, movementUsedFeet: state.combat.turn.movementUsedFeet }
      // Hidden turn: movement spent would narrate a hidden combatant's activity - reset with the rest.
      : { actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 0 },
    rulesMode: state.combat.rulesMode,
    // The per-family exceptions ride to players for exactly the reason `rulesMode` already does: they
    // are the table's rules CONFIGURATION, not its secrets, and a player's sheet has to know whether a
    // tap is about to be blocked, warned, or waved through before they take it. Copied, never a live
    // reference into GameState.
    ruleExceptions: { ...state.combat.ruleExceptions },
    // The policy (not the GM-only pendingDamage proposals) rides to players so the runner can say
    // whether a hit is handed to the GM or applied directly.
    playerDamageMode: state.combat.playerDamageMode,
    // Public claimed-PC ids still owing an initiative roll (all public by construction), plus the mode -
    // a player checks whether their own id is here to show the "Roll initiative" prompt.
    pendingInitiative: state.combat.pendingInitiative.filter((actorId) => publicActorIds.has(actorId)),
    playerInitiativeMode: state.combat.playerInitiativeMode,
    underwater: state.combat.underwater,
    reactionsUsed: state.combat.reactionsUsed.filter((actorId) => publicActorIds.has(actorId)),
    // The fog mask travels verbatim - it IS what players render, and it carries geometry only.
    // Fog is never the security boundary: hidden actors/annotations are stripped above regardless.
    fog: { enabled: state.combat.fog.enabled, shapes: state.combat.fog.shapes.map((shape) => ({ ...shape })) },
    // legendaryUsed is deliberately absent: a monster's remaining legendary actions are GM knowledge
    // (same rationale as the stripped actionUses), and the pool never drives player-side UI.
    // The whole table is rewound when the GM is reviewing an earlier turn; players see only the flag
    // (a banner), never the turn labels - those can name hidden combatants.
    rewound: state.combat.historyCursor !== null,
    // A player sees only the saves their own claimed character owes. The source actor id never
    // crosses the wire, and a hidden source's name is masked so gm-only attackers stay unnarrated.
    pendingSaves: state.combat.pendingSaves
      .filter((entry) => { const target = state.actors.find((actor) => actor.id === entry.targetActorId); return target !== undefined && target.ownerSessionId !== null && target.ownerSessionId === playerSessionId; })
      .map(({ sourceActorId, endsEffects: _endsEffects, ...entry }) => {
        // The on-fail effect's source ids never cross the wire either (same masking as effects), and
        // its `name` is the SAME free-form "Grappled by <attacker>" label an effect carries - the
        // unarmed Grapple writes it here first and `saving-throws.ts` copies it onto the real effect
        // on a failure - so it is scrubbed the same way. Concentration effect references
        // (endsEffects) are server bookkeeping and are stripped.
        const onFail = entry.onFailEffect;
        const onFailHidden = onFail !== undefined && onFail.sourceActorId !== null && !publicActorIds.has(onFail.sourceActorId);
        return {
          ...entry,
          sourceName: sourceActorId !== null && !publicActorIds.has(sourceActorId) ? HIDDEN_SOURCE : entry.sourceName,
          ...(onFail
            ? { onFailEffect: onFailHidden
              ? { ...onFail, sourceActorId: null, name: withoutSourceName(onFail.name, onFail.sourceName), sourceName: HIDDEN_SOURCE }
              : { ...onFail, sourceActorId: null } }
            : {})
        };
      }),
    // ASK THE GM (D8), same boundary as saves and reaction prompts: a player sees ONLY their own
    // claimed character's parked asks - never another player's question, and never the GM's
    // deliberation about it. The parked `command` is dropped entirely: its payload can name target ids
    // the asker is not allowed to know, and reading their own pending question needs none of it.
    pendingRuleAsks: state.combat.pendingRuleAsks
      .filter((entry) => { const actor = state.actors.find((candidate) => candidate.id === entry.actorId); return actor !== undefined && actor.ownerSessionId !== null && actor.ownerSessionId === playerSessionId; })
      .map(({ command: _command, ...entry }) => entry),
    // Same boundary as saves: a player sees only their own claimed character's reaction prompts,
    // with the source actor id stripped and a hidden source's name masked.
    pendingReactions: state.combat.pendingReactions
      .filter((entry) => { const reactor = state.actors.find((actor) => actor.id === entry.actorId); return reactor !== undefined && reactor.ownerSessionId !== null && reactor.ownerSessionId === playerSessionId; })
      .map(({ sourceActorId, ...entry }) => ({ ...entry, sourceName: sourceActorId !== null && !publicActorIds.has(sourceActorId) ? HIDDEN_SOURCE : entry.sourceName }))
  };
}

/**
 * An effect as players see it (viewer safety): source ids never cross the wire, and a hidden
 * source's name is masked in BOTH the fields that carry it - a player learns "Grappled by A hidden
 * threat", never who.
 *
 * BOTH, because for a long time it was only one. `sourceName` was replaced and `name` was not, and
 * `name` is the string the chip actually prints (`EncounterPanel.tsx` `EffectChips`), so the masked
 * source sat in the tooltip beside the attacker's real name in the label - the leak this docblock
 * had already claimed did not exist. See `withoutSourceName` for why the label is scrubbed rather
 * than blanked, and why the scrub belongs here rather than at the sites that write the label.
 */
function playerEffect(effect: GameState["actors"][number]["effects"][number], publicActorIds: ReadonlySet<string>): PlayerEffect {
  const { sourceActorId, sourceActionId: _sourceActionId, ...visible } = effect;
  if (sourceActorId === null || publicActorIds.has(sourceActorId)) return visible;
  return { ...visible, name: withoutSourceName(visible.name, effect.sourceName), sourceName: HIDDEN_SOURCE };
}

/**
 * "Fighter 7" / "Fighter 5 / Rogue 2" - the identity card's second line, computed here because a
 * player projection carries no `definitions` list to derive it from. Null when the sheet records no
 * class identity, so the field is OMITTED rather than sent as an empty string.
 */
function classLineOf(definition: GameState["definitions"][number]["definition"] | undefined): string | null {
  const classes = definition?.character?.classes ?? [];
  return classes.length === 0 ? null : classes.map((entry) => `${entry.name} ${entry.level}`).join(" / ");
}

/**
 * **PARTY VISIBILITY - the per-tier field table (rulings 5/8/19).**
 *
 * `GameState.partyVisibility` governs exactly one thing: what a player receives about ANOTHER
 * PLAYER'S CLAIMED CHARACTER. It is enforced here, in the projection, and nowhere else. A tier
 * filtered in the client would be decorative - the data would still be on the wire.
 *
 * **Who each column applies to.** `mine` is the requesting player's own claimed character.
 * `theirs` is a player-character claimed by ANOTHER session. Monsters, NPCs and UNCLAIMED characters
 * are governed by neither and are unchanged by this setting at every tier - an unclaimed character is
 * nobody's, and the claim screen (`ClaimCharacter.tsx`) is the surface that would break if `off`
 * swept it up.
 *
 * | Field                                   | mine | off | name-and-class | full-sheet | sheet-and-resources |
 * | --------------------------------------- | ---- | --- | -------------- | ---------- | ------------------- |
 * | (the actor entry exists at all)         |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | id, name, kind, visibility              |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | armorClass, initiative, speedFeet       |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | size, sizeCells, tokenAssetId           |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | definitionId, conditions, deathSaves    |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | hp (exact for a PC), effects (masked)   |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | claimStatus, presence, healthDisplay    |  Y   |  Y  |       Y        |     Y      |          Y          |
 * | classLine                               |  -   |  -  |       Y        |     Y      |          Y          |
 * | definition (the imported sheet)         |  Y   |  -  |       -        |     Y      |          Y          |
 * | actionUses, hitDice                     |  Y   |  -  |       -        |     -      |          Y          |
 * | spellSlots, pactSlots, preparedSpellIds |  Y   |  -  |       -        |     -      |          Y          |
 * | inventory, currency                     |  Y   |  -  |       -        |     -      |          Y          |
 * | notes, ownerSessionId, conditionImmunities, legendary, lastUsedAt, archived, sheetPreview: NEVER, at any tier, to anyone. |
 *
 * **`off` KEEPS THE ENTRY, and that is deliberate - do not "restore" the drop.** The first cut of this
 * feature removed another player's character from the array entirely at `off`. Measured against a live
 * fight, that is not a stricter privacy tier, it is a broken table: `projectPlayerCombat` still names
 * the ally in `combat.initiative` and still carries their token in `combat.tokens` (neither is governed
 * by this setting), while `EncounterMap.tsx` bails on a token whose actor it cannot find - so a player
 * got a name in the turn order and an empty square where their teammate was standing. A GM choosing
 * "Off" is saying *my players don't read each other's sheets*; they are not saying *delete my players
 * from the battle map*. So `off` is **the base actor entry and nothing a sheet is made of**: exactly
 * what the map, the tokens and the turn order need to stay coherent. What it removes is the PARTY
 * SURFACE - no identity card, no sheet to open, no resources - which is what D9 actually described.
 *
 * **Three rules for whoever adds the next field.**
 * 1. **The `mine` column is not negotiable.** A player always gets their own full sheet whatever the
 *    tier says. Never gate a field on the tier without excluding `mine` first.
 * 2. **A field belongs above the `off` line only if the MAP, THE TOKENS OR THE TURN ORDER need it.**
 *    That is the whole test for the `off` column, and it is why `off` is not empty.
 * 3. **A new field belongs to a tier, and the default is the strictest one that still works.** Adding
 *    a field to a player projection is a viewer-safety change (CLAUDE.md rule 3). When in doubt, omit.
 *
 * `classLine` is deliberately absent on `mine`: the owner already holds the whole `definition` and can
 * read the class off it, so duplicating it would be a second source of the same truth.
 */
export function projectPlayerView(state: GameState, playerSessionId: string | undefined, presenceFor: PresenceLookup, now = Date.now()): PlayerView {
  // Archived characters (GM management, v4 #10) are hidden from players entirely, like gm-only actors.
  const publicActorIds = new Set(state.actors.filter((actor) => actor.visibility === "public" && !actor.archived).map((actor) => actor.id));
  const tier = state.partyVisibility;
  return {
    revision: state.revision,
    // The tier the server APPLIED, so the client renders the shape it was handed rather than guessing
    // one from which fields happen to be present ("no sheet" and "sheet withheld" look identical
    // otherwise). It describes work already done here; nothing downstream is trusted to enforce it.
    partyVisibility: tier,
    // The GM's builder policy travels verbatim (GM-set, player-read - decision 10): it holds no
    // secrets, and a player's wizard must know which ability methods to offer. Copied FIELD BY FIELD,
    // never spread: this list is the viewer-safety review point for the builder policy, so a field
    // added to BuilderPolicySchema reaches players only when someone writes it here on purpose.
    //   - maxLevel: the cap the player's own wizard must enforce in its UI before the server refuses.
    //   - playerBuilder: whether the wizard door is open to them at all. A dial about the player, told
    //     to the player; it names no character, no monster and no GM plan.
    builderPolicy: {
      allowedAbilityMethods: [...state.builderPolicy.allowedAbilityMethods],
      customFormula: state.builderPolicy.customFormula,
      maxLevel: state.builderPolicy.maxLevel,
      playerBuilder: state.builderPolicy.playerBuilder,
      //   - playerRandom: the same, for the random generator's door. Deny-by-default, so a player
      //     surface that reads it renders the closed state until the GM opens it.
      playerRandom: state.builderPolicy.playerRandom
    },
    // The door to an archived character's shared sheet, and nothing more: id + name, only for archived
    // characters the GM explicitly shared, and only ones that were public to begin with. Everything
    // else about them - hit points, conditions, claim, notes, the definition - is omitted. Empty for
    // every table that has not used the feature, which is the default.
    archivedCharacters: state.actors
      .filter((actor) => actor.archived && actor.sheetPreview && actor.visibility === "public")
      .map((actor) => ({ id: actor.id, name: actor.name })),
    combat: projectPlayerCombat(state, playerSessionId, now),
    // No tier removes an actor from this array - `partyVisibility` subtracts FIELDS, never entries.
    // The two things that do remove one are above: gm-only visibility, and archived. See the field
    // table on this function for why `off` is a narrower entry rather than a missing one.
    actors: state.actors.filter((actor) => actor.visibility === "public" && !actor.archived).map((source) => {
      // Explicit strips: notes/ownerSessionId/hp (existing) plus effects (rebuilt masked below),
      // actionUses (limited-use spending names stat-block action ids - own claimed character only),
      // conditionImmunities and legendary resources (monster defenses are GM knowledge),
      // hitDice (a healing resource that tracks with exact HP - own claimed character only), and
      // archived and sheetPreview (GM-only management flags - the shared-archived door is the
      // name-and-id-only `archivedCharacters` list above, never a flag on a live actor).
      const { notes: _notes, ownerSessionId, hp: _exactHp, effects: _effects, actionUses, choiceOverrides, conditionImmunities: _conditionImmunities, legendary: _legendary, hitDice, spellSlots, pactSlots, preparedSpellIds, inventory, currency, healthDisplay: _healthDisplay, lastUsedAt: _lastUsedAt, archived: _archived, sheetPreview: _sheetPreview, replaySceneId, ...actor } = source;
      const mine = ownerSessionId !== null && ownerSessionId === playerSessionId;
      // ANOTHER PLAYER'S CHARACTER: the one and only thing `partyVisibility` governs. A monster, an
      // NPC and an unclaimed character are all outside it - see the field table above this function.
      const theirs = !mine && source.kind === "player-character" && ownerSessionId !== null;
      // `mine` is never gated by the tier - a player always gets their own full sheet and resources.
      // For `theirs`, each of the three below is the tier line it is named for; at `off` all three are
      // false and what survives is the base entry the map and the turn order need.
      const cardVisible = mine || (theirs && tier !== "off");
      const sheetVisible = mine || (theirs && (tier === "full-sheet" || tier === "sheet-and-resources"));
      const resourcesVisible = mine || (theirs && tier === "sheet-and-resources");
      // Effective token-health display = the per-token override or the table default. The richer
      // bar/ring reaches players only when the GM aimed it at everyone (audience "all"); band stays
      // the coarse badge. Only the style crosses - the client derives the fill from `hp` (exact for
      // the owner, coarse band otherwise), so exact HP never leaks for someone else's token.
      const effectiveDisplay = source.healthDisplay ?? state.combat.healthDisplay;
      const sharedDisplayStyle = effectiveDisplay.audience === "all" && effectiveDisplay.style !== "band" ? effectiveDisplay.style : null;
      // The stored sheet is READ for your own character and for a party member whose card you may see
      // (the class line is derived from it); whether it is SENT is `sheetVisible`, decided above. At
      // `off` it is not even looked up - nothing of another player's sheet is touched on that path.
      const storedSheet = cardVisible && source.definitionId ? state.definitions.find((entry) => entry.id === source.definitionId)?.definition : undefined;
      // The identity card's second line - a party member's, never your own (you hold the definition).
      const classLine = theirs && cardVisible ? classLineOf(storedSheet) : null;
      return {
        ...actor,
        hp: playerHp(source),
        effects: source.effects.map((effect) => playerEffect(effect, publicActorIds)),
        claimStatus: ownerSessionId === null ? "available" as const : mine ? "mine" as const : "claimed" as const,
        presence: ownerSessionId === null ? null : presenceFor(ownerSessionId),
        // A LAUNCHED REPLAY'S CLONE (D3), copied ACROSS rather than allowed to ride the spread - it was
        // destructured out above so that adding it here is a decision someone made on purpose.
        //
        // VIEWER SAFETY. It reaches players because their surfaces need it: without it the party strip
        // shows a second copy of every character in the recording and the claim screen offers those
        // copies for claiming (the clone is unowned, so `claimStatus` reads "available"). What it
        // discloses is that a combatant the player is ALREADY looking at - named in `combat.initiative`,
        // drawn on the map they are already served - belongs to the replay the GM deliberately made
        // live on the shared table. It names no hidden actor, no prepared scene, no GM note. The VALUE
        // is a scene id, and a player receives neither `combat.scenes` nor `activeSceneId`, so it
        // resolves to nothing they can look up; it is an opaque grouping key for creatures they can see.
        //
        // The ENTRY stays even for a clone, deliberately, and for the same reason `partyVisibility`'s
        // `off` tier keeps one: `combat.tokens` still carries the clone's token and `EncounterMap.tsx`
        // renders nothing for a token whose actor it cannot find. Dropping the entry would replace the
        // replay's combatants with empty squares. The lists subtract, the projection does not.
        ...(replaySceneId !== undefined ? { replaySceneId } : {}),
        ...(classLine !== null ? { classLine } : {}),
        ...(sheetVisible && storedSheet ? { definition: storedSheet } : {}),
        ...(resourcesVisible ? { actionUses: { ...actionUses } } : {}),
        // PICKS RE-MADE ON A REST (ruling A's runtime half), under the SAME gate as `actionUses` and
        // for the same reason: it is a sheet resource, it names the character's own offer keys, and
        // it is exactly as private as the spent-use map beside it. Copied rather than referenced -
        // a player projection never hands out a live reference into GameState.
        ...(resourcesVisible ? { choiceOverrides: Object.fromEntries(Object.entries(choiceOverrides).map(([key, value]) => [key, { ...value }])) } : {}),
        // WHAT THOSE SPENT COUNTS ARE OUT OF. `actionUses` has always been a bare map of spent
        // numbers with nothing on the wire naming the pools or their ceilings, so "3" could not be
        // rendered as "3 of 5". `pools` is derived from the sheet that is ALREADY being sent (see
        // `actionPools`) and adds no state.
        //
        // VIEWER SAFETY. It is a pure function of `storedSheet.actions[].uses`, and it rides
        // `resourcesVisible`, which is strictly NARROWER than `sheetVisible` - the gate under which
        // the whole definition, every `uses.limit` included, already ships. So this can reveal
        // nothing to a recipient who could not already read it off the definition in the same
        // payload, and at `off`/`name-and-class` the sheet is never even looked up.
        ...(resourcesVisible && storedSheet ? { pools: actionPools(storedSheet.actions) } : {}),
        // The pool's `entries` array is copied too - a player projection must never hand out a live
        // reference into GameState (same deep-copy rule as spellSlots/inventory below).
        ...(resourcesVisible && hitDice ? { hitDice: { ...hitDice, entries: hitDice.entries.map((entry) => ({ ...entry })) } } : {}),
        // Sheet resources reach the owning player always, and another player ONLY at the top tier -
        // never the viewer, which projects separately and has no tier at all.
        ...(resourcesVisible ? { spellSlots: spellSlots === null ? null : spellSlots.map((slot) => ({ ...slot })), pactSlots: pactSlots === null ? null : { ...pactSlots }, preparedSpellIds: [...preparedSpellIds], inventory: inventory.map((item) => ({ ...item })), currency: { ...currency } } : {}),
        ...(sharedDisplayStyle ? { healthDisplay: { style: sharedDisplayStyle } } : {})
      };
    }),
    rolls: state.rolls.filter((roll) => visibleToPlayer(roll, playerSessionId)).map(safeRoll)
  };
}

export function projectGmView(state: GameState, presenceFor: PresenceLookup, now = Date.now()): GmView {
  return {
    ...state,
    // Ephemeral annotations (measurements ~5s, pings ~4s) must drop off the GM's own screen when
    // they expire, not only when the next add prunes state - the scheduled expiry re-broadcast
    // relies on this filter (the player/viewer projections already do the same).
    combat: { ...state.combat, annotations: state.combat.annotations.filter((annotation) => annotation.expiresAt === null || annotation.expiresAt > now) },
    actors: state.actors.map((actor) => ({ ...actor, presence: actor.ownerSessionId === null ? null : presenceFor(actor.ownerSessionId) }))
  };
}
