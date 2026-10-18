import { useState } from "react";
import type { ActorDefinition, PartyVisibility, PlayerActor, PlayerView } from "@vtt/domain";
import { abilityModifier } from "@vtt/rules-5e";
import { Avatar, Button, Modal, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { RandomCharacterModal } from "../builder/RandomCharacter";
import { CLAIM_WORD, classLine, hpLabel, presenceDot, presenceLabel } from "./actor-display";
import { command } from "../lib/command";
import { aidGiverOf, isKnockedOut, StabilizeControl } from "../encounter/StabilizeControl";
import { ShortRestPrompt } from "../rest/ShortRestPrompt";
import { CharacterSheet } from "../sheet/CharacterSheet";
import "./my-character.css";

/** Dying and not yet stable: what first aid, a Healer's Kit or Spare the Dying is for. */
const needsAid = (actor: PlayerActor) =>
  actor.deathSaves !== null && !actor.deathSaves.stable && actor.deathSaves.failures < 3;

/**
 * The player's "My character" tab: who they play, how they are doing, and the door to the sheet.
 * Holds the client's one `character:release` call site (play-vocabulary.test.ts pins the verb).
 *
 * Branches on `PlayerView.partyVisibility`, never on which fields arrived: at `off` allies are still
 * in `state.actors` (initiative and tokens need them), and a sheet with no class line looks the same
 * as a tier that withholds one. The tier is enforced in `projectPlayerView`; this file never filters.
 */

/** The four tiers the GM can grant: Off · Name and class · Full sheet · Sheet + resources. */
const TIERS: readonly PartyVisibility[] = ["off", "name-and-class", "full-sheet", "sheet-and-resources"];

/**
 * The tier this player was given. Defaults to `name-and-class`, the narrowest tier with a card, so a
 * projection without the field never shows more than the GM opened.
 */
export function partyVisibilityOf(state: PlayerView): PartyVisibility {
  const raw = (state as { partyVisibility?: unknown }).partyVisibility;
  return TIERS.includes(raw as PartyVisibility) ? (raw as PartyVisibility) : "name-and-class";
}

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));

/**
 * A party member's sheet, read-only. Not the full `CharacterSheet`, which renders damage/heal
 * controls the server would refuse on someone else's character.
 */
function PartyMemberSheet({
  actor,
  resources,
  onClose
}: Readonly<{ actor: PlayerActor; resources: boolean; onClose: () => void }>) {
  const definition: ActorDefinition | undefined = actor.definition;
  const identity = definition?.character;
  // The server derives `classLine` for other players' characters; your own falls back to the stored sheet.
  const line = actor.classLine ?? classLine(definition);
  return (
    <Modal open onClose={onClose} size="md" title={actor.name} ariaLabel={`${actor.name}'s sheet`}>
      <div className="party-sheet">
        <p className="party-sheet-line">
          {line ?? "No class recorded"}
          {identity?.race && <> · {identity.race.name}</>}
          {identity?.background && <> · {identity.background.name}</>}
        </p>
        <dl className="party-sheet-stats">
          <div>
            <dt>HP</dt>
            <dd>{hpLabel(actor.hp)}</dd>
          </div>
          {(actor.armorClass ?? definition?.armorClass) !== undefined && (
            <div>
              <dt>AC</dt>
              <dd>{actor.armorClass ?? definition?.armorClass}</dd>
            </div>
          )}
          {(actor.speedFeet ?? definition?.speedFeet) !== undefined && (
            <div>
              <dt>Speed</dt>
              <dd>{actor.speedFeet ?? definition?.speedFeet} ft</dd>
            </div>
          )}
        </dl>
        {definition && (
          <ul className="party-sheet-abilities">
            {ABILITIES.map((ability) => (
              <li key={ability}>
                <span className="party-sheet-ability">{ability.toUpperCase()}</span>
                <strong>{definition.abilityScores[ability]}</strong>
                <span className="party-sheet-mod">{signed(abilityModifier(definition.abilityScores[ability]))}</span>
              </li>
            ))}
          </ul>
        )}
        {actor.conditions.length > 0 && (
          <p className="party-sheet-line">Conditions: {actor.conditions.map((condition) => condition.id).join(", ")}</p>
        )}
        {/* Resources tier only; a missing pool means the server did not send one. */}
        {resources && actor.hitDice && (
          <p className="party-sheet-line">
            Hit dice:{" "}
            {actor.hitDice.entries.map((entry) => `${entry.remaining}/${entry.maximum} ${entry.die}`).join(" · ")}
          </p>
        )}
        {resources && actor.spellSlots && actor.spellSlots.length > 0 && (
          <p className="party-sheet-line">
            Spell slots: {actor.spellSlots.map((slot) => `L${slot.level} × ${slot.remaining}`).join(" · ")}
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * The player's own release verb (play-vocabulary.test.ts pins it here): confirmed, then the claim is given back so
 * someone else can play the character. The sheet's menu offers it as its last item.
 */
export function useReleaseCharacter(state: PlayerView) {
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const [releasing, setReleasing] = useState(false);
  const release = async (name: string) => {
    // A character is released, never "left".
    if (
      !(await confirm({
        title: `Release ${name}?`,
        body: `Someone else will be able to play ${name}.`,
        confirmLabel: "Release"
      }))
    )
      return;
    setReleasing(true);
    const result = await command("character:release", { expectedRevision: state.revision });
    setReleasing(false);
    if (result.ok) toast(`You released ${name}. Pick another when you're ready.`, { tone: "success" });
    else toast(result.message ?? "Couldn't release the character.", { tone: "error" });
  };
  return { release, releasing, dialog };
}

/**
 * The rest of the party, as the GM's party tier lets this player see it: who plays what, a read-only sheet where the
 * tier opens one, and outside a fight the aid the player's character can give a dying or knocked-out ally.
 */
function PartyList({
  state,
  mine,
  onOpen
}: Readonly<{ state: PlayerView; mine: PlayerActor | null; onOpen: (actorId: string) => void }>) {
  const { toast } = useToast();
  const party = state.actors.filter((actor) => actor.kind === "player-character");
  const others = party.filter((actor) => actor.id !== mine?.id);
  const tier = partyVisibilityOf(state);
  const openable = tier === "full-sheet" || tier === "sheet-and-resources";
  // `off` removes this party surface, not allies from state: initiative and tokens still need every ally, so
  // presence in `state.actors` is not permission to list them. Characters nobody has claimed are listed at every tier
  // where this surface exists.
  if (tier === "off" || others.length === 0) return <p className="cs-note">No one else is in the party yet.</p>;
  return (
    <ul className="my-character-party-list">
      {others.map((actor) => {
        const line = actor.classLine ?? classLine(actor.definition);
        const claimed = actor.claimStatus === "claimed";
        const rowOpenable = openable && claimed;
        const label = [
          actor.name,
          line,
          claimed && actor.presence ? presenceLabel(actor.presence) : null,
          claimed ? null : CLAIM_WORD.available
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · ");
        const body = (
          <>
            <Avatar
              name={actor.name}
              size="sm"
              presence={claimed && actor.presence ? presenceDot(actor.presence) : undefined}
            />
            <span className="my-character-party-name">{actor.name}</span>
            <span className="my-character-party-line">{line ?? (claimed ? "None" : CLAIM_WORD.available)}</span>
          </>
        );
        return (
          <li key={actor.id}>
            {rowOpenable ? (
              <button
                type="button"
                className="my-character-party-row tap-target interactive"
                aria-label={`${label}. Open sheet.`}
                onClick={() => onOpen(actor.id)}
              >
                {body}
              </button>
            ) : (
              /* A plain readout, since there is no sheet to open. */
              <span className="my-character-party-row is-static" role="group" aria-label={label}>
                {body}
              </span>
            )}
            {/* Outside a fight your character can stabilize a dying ally or wake a knocked-out one; in a fight that
                happens on the turn order. */}
            {mine &&
              !state.combat.active &&
              (mine.hp.kind !== "exact" || mine.hp.current > 0) &&
              (needsAid(actor) || isKnockedOut(actor)) && (
                <StabilizeControl
                  targetId={actor.id}
                  targetName={actor.name}
                  helpers={[aidGiverOf(mine, mine.definition)]}
                  gm={false}
                  knockedOut={isKnockedOut(actor)}
                  onFeedback={(text) => toast(text)}
                />
              )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The player's "My character" tab. With a character claimed it is that character's sheet, whose menu also holds the
 * rest of the party, the builder and Release; the party's Short Rest takes the band above the sheet's tabs. Without
 * one it points at the table's claim picker and the builder.
 *
 * Branches on `PlayerView.partyVisibility`, never on which fields arrived (see `partyVisibilityOf`). The tier is
 * enforced in `projectPlayerView`; this file never filters.
 */
export function MyCharacter({
  state,
  token,
  onCreateCharacter,
  onLevel,
  onGoToTable
}: Readonly<{
  state: PlayerView;
  /** The player's bearer, which the token image picker needs. */
  token: string;
  /** The builder door; the claim screen has its own copy. */
  onCreateCharacter: () => void;
  /** Levelling follows the same builder policy as creating. */
  onLevel: (actorId: string) => void;
  /** An unclaimed player is sent to the Table, where the claim picker lives. */
  onGoToTable: () => void;
}>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [partyOpen, setPartyOpen] = useState(false);
  const [rolling, setRolling] = useState(false);
  const { toast } = useToast();
  const { release, releasing, dialog } = useReleaseCharacter(state);

  const party = state.actors.filter((actor) => actor.kind === "player-character");
  const mine = party.find((actor) => actor.claimStatus === "mine") ?? null;
  const tier = partyVisibilityOf(state);
  const openActor = openId ? (party.find((actor) => actor.id === openId && actor.id !== mine?.id) ?? null) : null;
  const builderOpen = state.builderPolicy.playerBuilder === "open";
  // The generator is offered only when `playerRandom` is open, unlike the builder door, which is always shown and
  // explains a closed policy itself.
  const randomOpen = state.builderPolicy.playerRandom === "open";

  const dialogs = (
    <>
      {partyOpen && (
        <Modal open onClose={() => setPartyOpen(false)} size="md" title="The rest of the party">
          <PartyList state={state} mine={mine} onOpen={(actorId) => setOpenId(actorId)} />
        </Modal>
      )}
      {openActor && (
        <PartyMemberSheet
          actor={openActor}
          resources={tier === "sheet-and-resources"}
          onClose={() => setOpenId(null)}
        />
      )}
      <RandomCharacterModal
        open={rolling}
        maxLevel={state.builderPolicy.maxLevel}
        onClose={() => setRolling(false)}
        onRolled={() => toast("Rolled up and claimed. The character is yours.", { tone: "success" })}
      />
      {dialog}
    </>
  );

  if (mine)
    return (
      <section className="my-character-sheet anim-view frame-col" aria-label="My character">
        <CharacterSheet
          actor={mine}
          role="player"
          state={state}
          presentation="page"
          token={token}
          top={<ShortRestPrompt state={state} />}
          {...(builderOpen ? { onLevel: () => onLevel(mine.id) } : {})}
          doors={{
            ...(tier !== "off" ? { party: () => setPartyOpen(true) } : {}),
            createCharacter: onCreateCharacter,
            ...(releasing ? {} : { release: { name: mine.name, onSelect: () => void release(mine.name) } })
          }}
          onClose={onGoToTable}
        />
        {dialogs}
      </section>
    );

  return (
    <section className="my-character pane-frame pane-scene scanlines frame-col anim-view" aria-label="My character">
      <div className="pane-sky" aria-hidden="true" />
      <div className="my-character-head neon-beam">
        <h2>My character</h2>
        <div className="my-character-head-actions">
          {/* Always offered: the route answers with the builder or its policy gate (shell/LayerView.tsx). */}
          <Button variant="secondary" onClick={onCreateCharacter}>
            Create a character
          </Button>
          {randomOpen && (
            <Button variant="secondary" onClick={() => setRolling(true)}>
              Roll a random one
            </Button>
          )}
        </div>
      </div>
      <div className="my-character-body scroll-y frame-fill">
        {/* Nobody claimed: point at the Table's claim picker, which is the one place to claim. */}
        <div className="scene-empty">
          <p>You haven't claimed a character yet.</p>
          <Button variant="primary" arrow onClick={onGoToTable}>
            Go to the table
          </Button>
        </div>
        {tier !== "off" && party.length > 0 && (
          <div className="my-character-party">
            <h3 className="my-character-party-head">The party</h3>
            <PartyList state={state} mine={null} onOpen={(actorId) => setOpenId(actorId)} />
          </div>
        )}
      </div>
      {dialogs}
    </section>
  );
}
