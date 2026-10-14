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
 * The tier this player was given. Defaults to `name-and-class` rather than the fullest tier, so a
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

export function MyCharacter({
  state,
  onOpenSheet,
  onCreateCharacter,
  onLevel,
  onGoToTable
}: Readonly<{
  state: PlayerView;
  /** Opens the player's own sheet at `/characters/<id>`. */
  onOpenSheet: (actorId: string) => void;
  /** The builder door; the claim screen has its own copy. */
  onCreateCharacter: () => void;
  /** Levelling follows the same builder policy as creating. */
  onLevel: (actorId: string) => void;
  /** An unclaimed player is sent to the Table, where the claim picker lives. */
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
  const openActor = openId ? (others.find((actor) => actor.id === openId) ?? null) : null;
  const builderOpen = state.builderPolicy.playerBuilder === "open";
  // The generator is offered only when `playerRandom` is open, unlike the builder door, which is
  // always shown and explains a closed policy itself.
  const randomOpen = state.builderPolicy.playerRandom === "open";

  const release = async (name: string) => {
    // A character is released, never "left".
    if (
      !(await confirm({
        title: `Release ${name}?`,
        body: "Someone else will be able to play them.",
        confirmLabel: "Release"
      }))
    )
      return;
    setReleasing(true);
    socket.emit("character:release", { commandId: newId(), expectedRevision: state.revision }, (result) => {
      setReleasing(false);
      if (result.ok) toast(`You released ${name}. Pick another when you're ready.`, { tone: "success" });
      else toast(result.message ?? "Couldn't release the character.", { tone: "error" });
    });
  };

  return (
    <section className="my-character pane-frame pane-scene scanlines frame-col anim-view" aria-label="My character">
      <div className="pane-sky" aria-hidden="true" />
      <div className="my-character-head neon-beam">
        <h2>My character</h2>
        <div className="my-character-head-actions">
          {/* Always offered: the route answers with the builder or its policy gate (main.tsx). */}
          <Button variant="secondary" onClick={onCreateCharacter}>
            Create a character
          </Button>
          {!mine && randomOpen && (
            <Button variant="secondary" onClick={() => setRolling(true)}>
              Roll a random one
            </Button>
          )}
          {mine && builderOpen && (
            <Button variant="secondary" onClick={() => onLevel(mine.id)}>
              Level up or down…
            </Button>
          )}
        </div>
      </div>

      <div className="my-character-body scroll-y frame-fill">
        {mine ? (
          <div className="my-character-card">
            <Avatar name={mine.name} size="lg" presence={mine.presence ? presenceDot(mine.presence) : undefined} />
            <div className="my-character-facts">
              <strong className="my-character-name">{mine.name}</strong>
              <span className="my-character-line">{classLine(mine.definition) ?? "No class recorded"}</span>
              <span className="my-character-hp" role="status">
                HP {hpLabel(mine.hp)}
              </span>
            </div>
            <div className="my-character-doors">
              <Button variant="primary" onClick={() => onOpenSheet(mine.id)}>
                My sheet
              </Button>
              <Button
                variant="ghost"
                disabled={releasing}
                title={`Release ${mine.name}`}
                onClick={() => release(mine.name)}
              >
                Release
              </Button>
            </div>
          </div>
        ) : (
          /* Nobody claimed: point at the Table's claim picker rather than duplicating it. */
          <div className="scene-empty">
            <p>You haven&rsquo;t claimed a character yet.</p>
            <Button variant="primary" arrow onClick={onGoToTable}>
              Go to the table
            </Button>
          </div>
        )}

        {/* `off` removes this party surface, not allies from state: initiative and tokens still need
          every ally, so presence in `state.actors` is not permission to list them. Unclaimed
          characters are listed at every tier where this surface exists. */}
        {tier !== "off" && others.length > 0 && (
          <div className="my-character-party">
            <h3 className="my-character-party-head">The rest of the party</h3>
            <ul className="my-character-party-list">
              {others.map((actor) => {
                const line = actor.classLine ?? classLine(actor.definition);
                const claimed = actor.claimStatus === "claimed";
                /* Openable when the tier allows it and the row is someone's character. */
                const rowOpenable = openable && claimed;
                const label = `${actor.name}${line ? ` — ${line}` : ""}${claimed && actor.presence ? ` — ${presenceLabel(actor.presence)}` : ""}${claimed ? "" : ` — ${CLAIM_WORD.available}`}`;
                const body = (
                  <>
                    <Avatar
                      name={actor.name}
                      size="sm"
                      presence={claimed && actor.presence ? presenceDot(actor.presence) : undefined}
                    />
                    <span className="my-character-party-name">{actor.name}</span>
                    <span className="my-character-party-line">{line ?? (claimed ? "—" : CLAIM_WORD.available)}</span>
                  </>
                );
                return (
                  <li key={actor.id}>
                    {rowOpenable ? (
                      <button
                        type="button"
                        className="my-character-party-row tap-target interactive"
                        aria-label={`${label}. Open sheet.`}
                        onClick={() => setOpenId(actor.id)}
                      >
                        {body}
                      </button>
                    ) : (
                      /* A plain readout rather than a disabled button when there is no sheet to open. */
                      <span className="my-character-party-row is-static" role="group" aria-label={label}>
                        {body}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

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
        onRolled={() => toast("Rolled up and claimed — it's yours.", { tone: "success" })}
      />
      {dialog}
    </section>
  );
}
