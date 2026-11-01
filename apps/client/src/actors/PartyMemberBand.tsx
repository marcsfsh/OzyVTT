import type { ActorDefinition, PlayerActor } from "@vtt/domain";
import { abilityModifier } from "@vtt/rules-5e";
import { Modal, Tag } from "@vtt/ui";
import { useMediaQuery } from "../lib/useMediaQuery";
import { BandPlate } from "../sheet/SheetBand";
import { classLine, hpLabel } from "./actor-display";
import { ActorAvatar } from "./ActorAvatar";
import "./party-member.css";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));

/**
 * A party member, read-only, drawn as the Ledger's band (characters spec 2.4). It reads only what the projection sends
 * another player at the GM's tier: the class line and the plate at every tier with a sheet, the abilities only when a
 * `definition` arrived, Hit Point Dice and spell slots only with `resources`. Never the full `CharacterSheet`, whose
 * damage and heal controls the server would refuse on someone else's character.
 */
export function PartyMemberBand({
  actor,
  resources,
  onClose
}: Readonly<{ actor: PlayerActor; resources: boolean; onClose: () => void }>) {
  const definition: ActorDefinition | undefined = actor.definition;
  const identity = definition?.character;
  // The server derives `classLine` for other players' characters; your own falls back to the stored sheet.
  const line = [actor.classLine ?? classLine(definition), identity?.race?.name ?? null]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  const conditions = actor.conditions.filter((condition) => condition.id !== "exhaustion");
  // A sheet from the bottom on a phone (theme rule 16), its head the member's name with the close at its right.
  const phone = useMediaQuery("(max-width: 760px)");
  const hitDice = resources && actor.hitDice ? actor.hitDice.entries : null;
  const slots = resources && actor.spellSlots && actor.spellSlots.length > 0 ? actor.spellSlots : null;
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      align={phone ? "bottom" : "center"}
      className="party-member-dialog"
      title={actor.name}
      ariaLabel={`${actor.name}'s sheet`}
    >
      <div className="party-member">
        <div className="party-member-head">
          <ActorAvatar actor={actor} name={actor.name} size="lg" />
          <div className="party-member-id">
            <p className="party-member-line">{line || "No class recorded"}</p>
            {conditions.length > 0 && (
              <p className="party-member-tags" aria-label="Conditions">
                {conditions.map((condition) => (
                  <Tag key={condition.id} tone={condition.id === "invisible" ? "status" : "miss"}>
                    {condition.id.replace(/-/g, " ")}
                  </Tag>
                ))}
              </p>
            )}
          </div>
        </div>
        <BandPlate
          armorClass={actor.armorClass ?? definition?.armorClass}
          hp={actor.hp.kind === "exact" ? actor.hp : null}
          hpText={hpLabel(actor.hp)}
          speed={actor.speedFeet ?? definition?.speedFeet}
        />
        {definition && (
          <ul className="party-member-abilities" aria-label="Abilities">
            {ABILITIES.map((ability) => (
              <li key={ability}>
                <span className="party-member-ability">{ability.toUpperCase()}</span>
                <strong className="party-member-mod">
                  {signed(abilityModifier(definition.abilityScores[ability]))}
                </strong>
                <span className="party-member-score">{definition.abilityScores[ability]}</span>
              </li>
            ))}
          </ul>
        )}
        {/* Resources tier only; a missing pool means the server did not send one. */}
        {(hitDice || slots) && (
          <p className="party-member-res">
            {hitDice && (
              <span>
                Hit Point Dice{" "}
                <b>{hitDice.map((entry) => `${entry.remaining}/${entry.maximum} ${entry.die}`).join(" · ")}</b>
              </span>
            )}
            {slots && (
              <span>
                Spell slots <b>{slots.map((slot) => `L${slot.level} × ${slot.remaining}`).join(" · ")}</b>
              </span>
            )}
          </p>
        )}
      </div>
    </Modal>
  );
}
