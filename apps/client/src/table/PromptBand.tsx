import type { PlayerView } from "@vtt/domain";
import { Button, Tag } from "@vtt/ui";
import { RollCallCard, useRollCallCards } from "../encounter/RollCallPrompt";
import { navigate } from "../router";
import { abilityName } from "./needs";
import { playerPrompts, type PlayerPrompt } from "./playerPrompts";

/** The kind's tag and the band's title, from the player's side. */
function bandWords(prompt: PlayerPrompt): Readonly<{ tag: string; title: string }> {
  switch (prompt.kind) {
    case "reaction":
      return { tag: "Reaction", title: `${prompt.actor.name} may react` };
    case "death-save":
      return { tag: "Dying", title: `${prompt.actor.name} is dying` };
    case "save":
      return { tag: "Save", title: `DC ${prompt.save.dc} ${abilityName(prompt.save.ability)} saving throw` };
    case "initiative":
      return { tag: "Initiative", title: `Roll initiative for ${prompt.actor.name}` };
    case "order":
      return { tag: "Turn", title: `${prompt.actor.name} chooses the order of what happens` };
    case "damage-roll":
      return { tag: "Damage", title: `Roll damage for ${prompt.roll.actionName}` };
  }
}

/**
 * Away from the table, the leading prompt is A's band (frame rule 3.10, C4 spec 2.1), widened from calls for a roll to
 * every prompt: the kind's tag, the title and its answer. A call's band rolls it, as before; every other prompt's band
 * offers Go to the table, where its card waits. The band counts the rest.
 */
export function PromptBand({ state }: Readonly<{ state: PlayerView }>) {
  const calls = useRollCallCards(state);
  const prompts = playerPrompts(state);
  const total = prompts.length + calls.cards.length;
  if (total === 0) return null;
  const rest = total - 1;
  const more = rest > 0 ? <span className="prompt-band-more">{rest} more</span> : null;
  const lead = prompts[0];
  if (!lead) {
    const card = calls.cards[0];
    return (
      <aside className="roll-call-dock prompt-band-dock" aria-label="What waits for you">
        <RollCallCard
          key={card.key}
          band
          card={card}
          state={state}
          named={calls.named}
          onAnswered={(outcome) => calls.keep(card, outcome)}
          onPutAway={() => calls.putAway(card.key)}
        />
        {more}
      </aside>
    );
  }
  const words = bandWords(lead);
  return (
    <aside className="prompt-band-dock" aria-label="What waits for you">
      <div className="prompt-band" role="group" aria-label={`${words.tag}: ${words.title}`}>
        <Tag tone="roll">{words.tag}</Tag>
        <span className="prompt-band-title">{words.title}</span>
        {more}
        <Button size="sm" className="prompt-band-go" onClick={() => void navigate("/table")}>
          Go to the table
        </Button>
      </div>
    </aside>
  );
}
