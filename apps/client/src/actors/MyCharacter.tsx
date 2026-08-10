import { useState } from "react";
import type { ActorDefinition, PartyVisibility, PlayerActor, PlayerView } from "@vtt/domain";
import { abilityModifier } from "@vtt/rules-5e";
import { Avatar, Button, Modal, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { RandomCharacterModal } from "../builder/RandomCharacter";
import { CLAIM_WORD, classLine, hpLabel, presenceDot, presenceLabel } from "./actor-display";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/**
 * **MY CHARACTER — the player's first tab (D9/D11, rulings 18, 20).**
 *
 * It replaces the character bar that used to ride over the map, which cost 69px of a phone's map band
 * to say who you are playing. The same three facts (who, how they are doing, the door to the sheet)
 * now have a surface of their own, and the map got the band back.
 *
 * **"Release" lives here.** `play-vocabulary.test.ts`'s D28 glossary pins the word to whichever file
 * owns the release action ("the table's release verb — never 'Leave'"), and `character:release` has
 * exactly one call site in the client: the one below. The bar's row moved here with the verb, and the
 * lock's row moved with it in the same change — that pairing is the contract, not a coincidence.
 *
 * **THE PARTY TIER IS RENDERED, NEVER INFERRED.** `PlayerView.partyVisibility` says which of the four
 * tiers the GM granted this table (rulings 5/8/19), and this surface branches on THAT — not on which
 * fields happen to have arrived. Two concrete reasons, both measured rather than theoretical:
 *  - At `off` every ally is STILL in `state.actors`, because the turn order names them and the map
 *    carries their token; removing the entry left an empty square where a teammate was standing. So
 *    "the character is in the list" is not permission to list them — the tier is.
 *  - A character with no imported sheet legitimately carries no class line, which is indistinguishable
 *    from a tier that withholds one. A surface that guessed would silently downgrade the first case.
 *
 * **AND IT NEVER FILTERS.** The tier is enforced in `projectPlayerView` (`apps/server/src/projections.ts`)
 * — filtering here would make the setting decorative and put the data on the wire anyway. What arrives
 * is what may be shown; this file's job is to choose the SHAPE, not to police the payload.
 */

/** The four tiers, in the GM's own words (ruling 5/8/19): Off · Name and class · Full sheet · Sheet + resources. */
const TIERS: readonly PartyVisibility[] = ["off", "name-and-class", "full-sheet", "sheet-and-resources"];

/**
 * The tier this player was given, defaulting to the SAFE MIDDLE rather than the fullest.
 *
 * `name-and-class` is the client's stated default (ruling 5/8/19: "players get a useful party roster
 * out of the box; the GM opts in to more"), and it is also the right answer to a projection that has
 * not learned the field yet: assuming the fullest tier would render doors the GM never opened.
 */
export function partyVisibilityOf(state: PlayerView): PartyVisibility {
  const raw = (state as { partyVisibility?: unknown }).partyVisibility;
  return TIERS.includes(raw as PartyVisibility) ? (raw as PartyVisibility) : "name-and-class";
}

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));

/**
 * A party member's sheet, READ ONLY — and read-only by construction rather than by disabling.
 *
 * The full `CharacterSheet` is not reused here for one concrete reason: it renders damage/heal
 * controls for whoever it is handed, and on someone else's character every one of those is a tap the
 * server correctly refuses. A control that cannot work is worse than a readout that never claimed to.
 * So this renders the projection and offers nothing.
 */
function PartyMemberSheet({ actor, resources, onClose }: Readonly<{ actor: PlayerActor; resources: boolean; onClose: () => void }>) {
  const definition: ActorDefinition | undefined = actor.definition;
  const identity = definition?.character;
  // The server derives a party member's class line (`classLine`) because a player projection carries
  // no `definitions` list to derive one from; the stored sheet is the fallback for your own.
  const line = actor.classLine ?? classLine(definition);
  return <Modal open onClose={onClose} size="md" title={actor.name} ariaLabel={`${actor.name}'s sheet`}>
    <div className="party-sheet">
      <p className="party-sheet-line">
        {line ?? "No class recorded"}
        {identity?.race && <> · {identity.race.name}</>}
        {identity?.background && <> · {identity.background.name}</>}
      </p>
      <dl className="party-sheet-stats">
        <div><dt>HP</dt><dd>{hpLabel(actor.hp)}</dd></div>
        {(actor.armorClass ?? definition?.armorClass) !== undefined && <div><dt>AC</dt><dd>{actor.armorClass ?? definition?.armorClass}</dd></div>}
        {(actor.speedFeet ?? definition?.speedFeet) !== undefined && <div><dt>Speed</dt><dd>{actor.speedFeet ?? definition?.speedFeet} ft</dd></div>}
      </dl>
      {definition && <ul className="party-sheet-abilities">
        {ABILITIES.map((ability) => <li key={ability}>
          <span className="party-sheet-ability">{ability.toUpperCase()}</span>
          <strong>{definition.abilityScores[ability]}</strong>
          <span className="party-sheet-mod">{signed(abilityModifier(definition.abilityScores[ability]))}</span>
        </li>)}
      </ul>}
      {actor.conditions.length > 0 && <p className="party-sheet-line">Conditions: {actor.conditions.map((condition) => condition.id).join(", ")}</p>}
      {/* The resources tier's extra, rendered only where the projection carried it. Nothing is
          filtered — a missing pool means the server did not send one, which is the answer. */}
      {resources && actor.hitDice && <p className="party-sheet-line">Hit dice: {actor.hitDice.entries.map((entry) => `${entry.remaining}/${entry.maximum} ${entry.die}`).join(" · ")}</p>}
      {resources && actor.spellSlots && actor.spellSlots.length > 0 && <p className="party-sheet-line">
        Spell slots: {actor.spellSlots.map((slot) => `L${slot.level} × ${slot.remaining}`).join(" · ")}
      </p>}
    </div>
  </Modal>;
}

export function MyCharacter({ state, onOpenSheet, onCreateCharacter, onLevel, onGoToTable }: Readonly<{
  state: PlayerView;
  /** The player's own sheet has a real address (`/characters/<id>`); the shell navigates. */
  onOpenSheet: (actorId: string) => void;
  /** Ruling 18 — the builder door, in both places. The claim screen keeps its own copy. */
  onCreateCharacter: () => void;
  /** Ruling 18 — levelling gates on the same policy, so it is offered on the same terms. */
  onLevel: (actorId: string) => void;
  /** The claim picker lives on the Table; an unclaimed player is pointed there, not given a copy. */
  onGoToTable: () => void;
}>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [rolling, setRolling] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();

  const party = state.actors.filter((actor) => actor.kind === "player-character");
  const mine = party.find((actor) => actor.claimStatus === "mine") ?? null;
  const others = party.filter((actor) => actor.id !== mine?.id);
  const tier = partyVisibilityOf(state);
  const openable = tier === "full-sheet" || tier === "sheet-and-resources";
  const openActor = openId ? others.find((actor) => actor.id === openId) ?? null : null;
  const builderOpen = state.builderPolicy.playerBuilder === "open";
  /**
   * The generator's door is offered only when the GM has OPENED it — the opposite of the builder
   * door beside it (ruling 18), and deliberately so. The builder's door explains itself when the
   * policy is closed because a player who walks it has decided to make a character; the generator
   * is one tap, `playerRandom` is closed by default, and a permanently-greyed button on the
   * player's first tab would advertise a thing this table has said no to.
   */
  const randomOpen = state.builderPolicy.playerRandom === "open";

  const release = async (name: string) => {
    // D28's claim verbs: you RELEASE a character, you do not "leave" one.
    if (!(await confirm({ title: `Release ${name}?`, body: "Someone else will be able to play them.", confirmLabel: "Release" }))) return;
    setReleasing(true);
    socket.emit("character:release", { commandId: newId(), expectedRevision: state.revision }, (result) => {
      setReleasing(false);
      if (result.ok) toast(`You released ${name}. Pick another when you're ready.`, { tone: "success" });
      else toast(result.message ?? "Couldn't release the character.", { tone: "error" });
    });
  };

  return <section className="my-character pane-frame pane-scene scanlines frame-col anim-view" aria-label="My character">
    <div className="pane-sky" aria-hidden="true" />
    <div className="my-character-head neon-beam">
      <h2>My character</h2>
      <div className="my-character-head-actions">
        {/* Ruling 18: the door is offered whether or not the policy is open — the address answers
            with the builder or with its gate (main.tsx), and a door that explains itself beats a
            door that is not there. Levelling is the policy's own action, so it follows the policy. */}
        <Button variant="secondary" onClick={onCreateCharacter}>Create a character</Button>
        {!mine && randomOpen && <Button variant="secondary" onClick={() => setRolling(true)}>Roll a random one</Button>}
        {mine && builderOpen && <Button variant="secondary" onClick={() => onLevel(mine.id)}>Level up or down…</Button>}
      </div>
    </div>

    <div className="my-character-body scroll-y frame-fill">
      {mine
        ? <div className="my-character-card">
            <Avatar name={mine.name} size="lg" presence={mine.presence ? presenceDot(mine.presence) : undefined} />
            <div className="my-character-facts">
              <strong className="my-character-name">{mine.name}</strong>
              <span className="my-character-line">{classLine(mine.definition) ?? "No class recorded"}</span>
              <span className="my-character-hp" role="status">HP {hpLabel(mine.hp)}</span>
            </div>
            <div className="my-character-doors">
              <Button variant="primary" onClick={() => onOpenSheet(mine.id)}>My sheet</Button>
              <Button variant="ghost" disabled={releasing} title={`Release ${mine.name}`} onClick={() => release(mine.name)}>Release</Button>
            </div>
          </div>
        /* Nobody claimed: one line and one door (§9). The picker itself lives on the Table, which is
           where a claim is made, so this points at it rather than growing a second copy of it. */
        : <div className="scene-empty">
            <p>You haven&rsquo;t claimed a character yet.</p>
            <Button variant="primary" arrow onClick={onGoToTable}>Go to the table</Button>
          </div>}

      {/* THE REST OF THE PARTY — and the ONE place the tier is load-bearing rather than descriptive.
          **`off` removes the party SURFACE, not the player.** Every ally stays in `state.actors` at
          every tier, because `combat.initiative` names them and `combat.tokens` carries their token:
          strip the entry and `EncounterMap` bails, so a player at `off` would read an ally's name in
          the turn order and see an empty square where they are standing. That is a broken table, not
          a privacy tier. So the entries being present is NOT permission to list them — the tier is,
          which is exactly why the tier is a field and not something to infer from what arrived.
          Characters nobody has claimed sit outside the gate entirely (the claim screen reads the same
          list), and they are listed here at every tier the party surface exists at. */}
      {tier !== "off" && others.length > 0 && <div className="my-character-party">
        <h3 className="my-character-party-head">The rest of the party</h3>
        <ul className="my-character-party-list">
          {others.map((actor) => {
            const line = actor.classLine ?? classLine(actor.definition);
            const claimed = actor.claimStatus === "claimed";
            /* A sheet to open exists when the GM's tier says so AND the row is somebody's character.
               An unclaimed one is not a tier question — nobody is playing it, and its door is the
               claim picker on the Table. */
            const rowOpenable = openable && claimed;
            const label = `${actor.name}${line ? ` — ${line}` : ""}${claimed && actor.presence ? ` — ${presenceLabel(actor.presence)}` : ""}${claimed ? "" : ` — ${CLAIM_WORD.available}`}`;
            const body = <>
              <Avatar name={actor.name} size="sm" presence={claimed && actor.presence ? presenceDot(actor.presence) : undefined} />
              <span className="my-character-party-name">{actor.name}</span>
              <span className="my-character-party-line">{line ?? (claimed ? "—" : CLAIM_WORD.available)}</span>
            </>;
            return <li key={actor.id}>
              {rowOpenable
                ? <button type="button" className="my-character-party-row tap-target interactive" aria-label={`${label}. Open sheet.`} onClick={() => setOpenId(actor.id)}>{body}</button>
                /* Not a disabled button: there is no sheet to open here, and a control that looks
                   broken reads worse than a plain readout of the same facts. */
                : <span className="my-character-party-row is-static" role="group" aria-label={label}>{body}</span>}
            </li>;
          })}
        </ul>
      </div>}
    </div>

    {openActor && <PartyMemberSheet actor={openActor} resources={tier === "sheet-and-resources"} onClose={() => setOpenId(null)} />}
    <RandomCharacterModal
      open={rolling}
      maxLevel={state.builderPolicy.maxLevel}
      onClose={() => setRolling(false)}
      onRolled={() => toast("Rolled up and claimed — it's yours.", { tone: "success" })}
    />
    {dialog}
  </section>;
}
