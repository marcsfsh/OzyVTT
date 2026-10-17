import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PlayerActor, PlayerPendingReaction, PlayerView } from "@vtt/domain";
import { useRollPreference } from "../dice/roll-preference";
import { DyingTracker } from "../encounter/DyingTracker";
import { InitiativePrompt } from "../encounter/InitiativePrompt";
import { ReactionPrompt } from "../encounter/ReactionPrompt";
import { RollCallCard, useRollCallCards, type RollCallCardModel } from "../encounter/RollCallPrompt";
import { SavePrompt } from "../encounter/SavePrompt";
import { abilityName } from "./needs";
import { playerPrompts, type PlayerPrompt } from "./playerPrompts";
import "./prompt-slot.css";

type SlotEntry = PlayerPrompt | Readonly<{ kind: "roll-call"; key: string; card: RollCallCardModel }>;

/** The spell slot a reaction spell costs and how many the character has left at that level, when the sheet says. */
function slotCost(actor: PlayerActor, actionId: string): string | null {
  const spell = actor.definition?.spellcasting?.spells.find((candidate) => candidate.id === actionId);
  if (!spell || spell.level < 1) return null;
  const left = actor.spellSlots?.find((slot) => slot.level === spell.level)?.remaining;
  return left === undefined
    ? `It costs a level ${spell.level} spell slot.`
    : `It costs a level ${spell.level} spell slot, and you have ${left} left.`;
}

/** The headline and the one-line why of a reaction, from the side of the character who may take it. */
function reactionWords(reaction: PlayerPendingReaction, actor: PlayerActor) {
  switch (reaction.kind) {
    case "attack-would-hit":
      return {
        title: `${reaction.sourceName}'s attack would hit you`,
        detail: `${reaction.actionName} gives you +${reaction.acBonus} AC against it, so the hit becomes a miss.`
      };
    case "leaves-reach":
      return {
        title: `${reaction.sourceName} is leaving your reach`,
        detail: "You can make an Opportunity Attack with your Reaction."
      };
    case "damaged-by-creature":
      return {
        title: `${reaction.sourceName} damaged you`,
        detail: `${reaction.actionName} strikes back with your Reaction.`
      };
    default:
      return {
        title: `${reaction.sourceName}'s hit deals ${reaction.proposedDamage} damage to ${actor.name}`,
        detail: `${reaction.actionName} uses your Reaction to halve it.`
      };
  }
}

function PromptCard({
  eyebrow,
  title,
  meta,
  detail,
  tone = "alert",
  headingRef,
  children
}: Readonly<{
  eyebrow?: string;
  title: string;
  meta?: ReactNode;
  detail?: ReactNode;
  tone?: "alert" | "danger";
  headingRef: (element: HTMLElement | null) => void;
  children: ReactNode;
}>) {
  return (
    <article className={`prompt-card prompt-card--${tone}`}>
      {eyebrow && <p className="prompt-card-eyebrow">{eyebrow}</p>}
      <h3 className="prompt-card-title" ref={headingRef} tabIndex={-1}>
        <span>{title}</span>
        {meta && <span className="prompt-card-meta">{meta}</span>}
      </h3>
      {detail && <p className="prompt-card-detail">{detail}</p>}
      <div className="prompt-card-body">{children}</div>
    </article>
  );
}

const typing = (element: Element | null) =>
  element instanceof HTMLElement &&
  (element.matches("input, textarea, select, [contenteditable='true']") || element.isContentEditable);

/**
 * The player's one prompt slot: reactions, death saves, saving throws, initiative and the GM's calls for a roll all
 * land here, one at a time, in the space reserved between the map and the panel. It pushes what is under it down and
 * stays until answered, so a toast or a scrolled list never hides it. A new prompt is announced and takes the focus
 * unless the player is typing; when the last one is answered the focus goes back to `onSettled`'s target.
 */
export function PromptSlot({
  state,
  onSettled
}: Readonly<{ state: PlayerView; onSettled?: () => HTMLElement | null }>) {
  const { rollMode } = useRollPreference();
  const rollCalls = useRollCallCards(state);
  const entries: SlotEntry[] = [
    ...playerPrompts(state),
    ...rollCalls.cards.map((card) => ({ kind: "roll-call" as const, key: card.key, card }))
  ];
  const first = entries[0];
  const [outcome, setOutcome] = useState("");
  const heading = useRef<HTMLElement | null>(null);
  const slot = useRef<HTMLElement | null>(null);
  const shownKey = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const titleOf = (entry: SlotEntry): string => {
    switch (entry.kind) {
      case "reaction":
        return reactionWords(entry.reaction, entry.actor).title;
      case "death-save":
        return "You are dying";
      case "save":
        return `DC ${entry.save.dc} ${abilityName(entry.save.ability)} saving throw`;
      case "initiative":
        return "Roll initiative";
      case "roll-call":
        return "The GM calls for a roll";
    }
  };

  // A new prompt in the slot: announce it, and bring the focus to it unless the player is typing elsewhere.
  useLayoutEffect(() => {
    const key = first?.key ?? null;
    if (key === shownKey.current) return;
    const hadFocus = slot.current?.contains(document.activeElement) === true || document.activeElement === document.body;
    shownKey.current = key;
    if (first) {
      setAnnouncement(`Answer now: ${titleOf(first)}.`);
      if (!typing(document.activeElement) || hadFocus) heading.current?.focus({ preventScroll: true });
    } else if (hadFocus) onSettled?.()?.focus({ preventScroll: true });
    // Keyed on which prompt leads the slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first?.key]);
  // An outcome stays in view a moment after its prompt closes.
  useEffect(() => {
    if (!outcome) return;
    const timer = window.setTimeout(() => setOutcome(""), 8000);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  const headingRef = (element: HTMLElement | null) => {
    heading.current = element;
  };
  let card: ReactNode = null;
  if (first) {
    switch (first.kind) {
      case "reaction": {
        const words = reactionWords(first.reaction, first.actor);
        const cost = slotCost(first.actor, first.reaction.actionId);
        card = (
          <PromptCard
            eyebrow="Reaction · answer now"
            title={words.title}
            detail={cost ? `${words.detail} ${cost}` : words.detail}
            headingRef={headingRef}
          >
            <ReactionPrompt
              reaction={first.reaction}
              actorName={first.actor.name}
              canDismiss={false}
              onFeedback={setOutcome}
              rollMode={rollMode}
              viewer="player"
              inspired={first.actor.heroicInspiration === true}
            />
          </PromptCard>
        );
        break;
      }
      case "death-save": {
        const saves = first.actor.deathSaves!;
        card = (
          <PromptCard
            tone="danger"
            title="You are dying"
            meta={`${saves.successes} ${saves.successes === 1 ? "success" : "successes"} · ${saves.failures} ${saves.failures === 1 ? "failure" : "failures"}`}
            detail="You're Unconscious, so you can't act or move. An ally can heal you, or stabilize you with the Help action."
            headingRef={headingRef}
          >
            <DyingTracker
              actorId={first.actor.id}
              name={first.actor.name}
              deathSaves={saves}
              canRoll
              onFeedback={setOutcome}
              rollMode={rollMode}
              isActingTurn
              viewer="player"
              inspired={first.actor.heroicInspiration === true}
              rollLabel="Roll death save"
            />
          </PromptCard>
        );
        break;
      }
      case "save": {
        const { save } = first;
        card = (
          <PromptCard
            eyebrow="Saving throw · answer now"
            title={`DC ${save.dc} ${abilityName(save.ability)} saving throw`}
            detail={`${save.sourceName ? `${save.sourceName}'s ` : ""}${save.actionName}${
              save.proposedDamage > 0
                ? `: ${save.proposedDamage} damage on a failure${save.halfOnSuccess ? ", half on a success" : ""}.`
                : "."
            }`}
            headingRef={headingRef}
          >
            <SavePrompt
              save={save}
              targetName={first.actor.name}
              canDismiss={false}
              onFeedback={setOutcome}
              rollMode={rollMode}
              viewer="player"
              inspired={first.actor.heroicInspiration === true}
            />
          </PromptCard>
        );
        break;
      }
      case "initiative":
        card = (
          <PromptCard eyebrow="The fight starts" title={`Roll initiative for ${first.actor.name}`} headingRef={headingRef}>
            <InitiativePrompt actorId={first.actor.id} />
          </PromptCard>
        );
        break;
      case "roll-call":
        card = (
          <div className="prompt-card prompt-card--alert prompt-card--call">
            <h3 className="nh-sr-only" ref={headingRef} tabIndex={-1}>
              The GM calls for a roll
            </h3>
            <RollCallCard
              card={first.card}
              state={state}
              named={rollCalls.named}
              onAnswered={(result) => rollCalls.keep(first.card, result)}
              onPutAway={() => rollCalls.putAway(first.card.key)}
            />
          </div>
        );
        break;
    }
  }
  return (
    <>
      <p className="nh-sr-only" aria-live="assertive">
        {announcement}
      </p>
      {(first || outcome) && (
        <section className="prompt-slot" aria-label="Answer now" ref={slot}>
          {card}
          {entries.length > 1 && (
            <p className="prompt-slot-more">
              {entries.length - 1} more after this: {entries.slice(1).map(titleOf).join(" · ")}
            </p>
          )}
          {outcome && (
            <p className="prompt-slot-outcome" role="status">
              {outcome}
            </p>
          )}
        </section>
      )}
    </>
  );
}

/** Whether the slot holds a prompt, so a bottom bar can step its own primary down. */
export function hasPlayerPrompt(state: PlayerView): boolean {
  return playerPrompts(state).length > 0;
}
