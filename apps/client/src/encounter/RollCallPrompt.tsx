import { useState, useSyncExternalStore } from "react";
import type { CheckRollResult, PlayerRollCall, PlayerView } from "@vtt/domain";
import { Button, useToast } from "@vtt/ui";
import { useSkillCatalog } from "../content/catalogs";
import { callLabel } from "../dice/roll-call-words";
import { useRollPreference } from "../dice/roll-preference";
import { command } from "../lib/command";
import { FaceEntry, RerollControl } from "./RollControls";
import { SavePrompt } from "./SavePrompt";
import { checkLine } from "./useSheetRolls";
import "../dice/roll-calls.css";

type Entry = PlayerRollCall["entries"][number];

/** A card for one character a call names: open until rolled, then kept with its result until put away. */
export type RollCallCardModel = Readonly<{
  key: string;
  call: PlayerRollCall;
  entry: Entry;
  /** What this browser rolled for it; the server's view drops an answered call. */
  outcome?: CheckRollResult;
}>;

/* Answered cards, kept here until put away, so the result and a Heroic Inspiration reroll outlive the call leaving
   the player's view, and a tab change doesn't lose them. */
let answered: ReadonlyMap<string, RollCallCardModel> = new Map();
const listeners = new Set<() => void>();
const setAnswered = (next: ReadonlyMap<string, RollCallCardModel>) => {
  answered = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The roll-call cards this player has open: the calls still to roll, then the answered ones not yet put away. */
export function useRollCallCards(state: PlayerView) {
  const kept = useSyncExternalStore(
    subscribe,
    () => answered,
    () => answered
  );
  const open: RollCallCardModel[] = state.rollCalls.flatMap((call) =>
    call.entries
      .filter((entry) => !entry.answered && !kept.has(`${call.id}:${entry.actorId}`))
      .map((entry) => ({ key: `${call.id}:${entry.actorId}`, call, entry }))
  );
  return {
    cards: [...open, ...kept.values()],
    // A player with one character needs no name on the card.
    named: new Set(state.rollCalls.flatMap((call) => call.entries.map((each) => each.actorId))).size > 1,
    keep: (card: RollCallCardModel, outcome: CheckRollResult) =>
      setAnswered(new Map([...answered, [card.key, { ...card, outcome }]])),
    putAway: (key: string) => setAnswered(new Map([...answered].filter(([candidate]) => candidate !== key)))
  };
}

/**
 * The GM's calls for a roll on the pages away from the table, as a row of the frame that pushes the page down: it
 * never covers a control. On the table they wait in the prompt slot instead.
 */
export function RollCallPrompts({ state }: Readonly<{ state: PlayerView }>) {
  const { cards, named, keep, putAway } = useRollCallCards(state);
  if (cards.length === 0) return null;
  return (
    <aside className="roll-call-dock scroll-y" aria-label="Rolls the GM calls for">
      {cards.map((card) => (
        <RollCallCard
          key={card.key}
          card={card}
          state={state}
          named={named}
          onAnswered={(outcome) => keep(card, outcome)}
          onPutAway={() => putAway(card.key)}
        />
      ))}
    </aside>
  );
}

/**
 * One character's part of a call: a check is rolled here (or typed from a physical die); a save call is the save the
 * character owes, answered as any other. A blind call's result stays with the GM.
 */
export function RollCallCard({
  card,
  state,
  named,
  onAnswered,
  onPutAway
}: Readonly<{
  card: RollCallCardModel;
  state: PlayerView;
  named: boolean;
  onAnswered: (outcome: CheckRollResult) => void;
  onPutAway: () => void;
}>) {
  const { call, entry, outcome } = card;
  const { toast } = useToast();
  const { mayType, rollMode } = useRollPreference();
  const skillCatalog = useSkillCatalog();
  const [busy, setBusy] = useState(false);
  // The answer was typed from a physical die, so a Heroic Inspiration reroll is typed too.
  const [typed, setTyped] = useState(false);
  const [rerolled, setRerolled] = useState<CheckRollResult | null>(null);
  const actor = state.actors.find((candidate) => candidate.id === entry.actorId);
  const name = actor?.name ?? "Your character";
  const inspired = actor?.heroicInspiration === true;
  const label = callLabel(call, (id) => skillCatalog.items.find((skill) => skill.id === id)?.name);
  const save = entry.saveId ? state.combat.pendingSaves.find((pending) => pending.id === entry.saveId) : undefined;
  const shown = rerolled ?? outcome;

  const answer = async (face?: number) => {
    setBusy(true);
    const result = await command("roll-call:answer", {
      callId: call.id,
      actorId: entry.actorId,
      ...(face !== undefined ? { face } : {})
    });
    setBusy(false);
    if (!result.ok) toast(result.message ?? "That roll was refused.", { tone: "error" });
    else {
      setTyped(face !== undefined);
      onAnswered(result);
    }
  };
  const reroll = async (face?: number) => {
    setBusy(true);
    const result = await command("check:reroll", { actorId: entry.actorId, ...(face !== undefined ? { face } : {}) });
    setBusy(false);
    if (!result.ok) toast(result.message ?? "That roll was refused.", { tone: "error" });
    else setRerolled(result);
  };

  return (
    <article className="roll-call-card" aria-label={`${label} for ${name}`}>
      <p className="roll-call-card-eyebrow">The GM calls for a roll</p>
      <p className="roll-call-card-head">
        <strong>{label}</strong>
        <span className="roll-call-meta">
          {named ? name : ""}
          {named && call.dc !== null ? " · " : ""}
          {call.dc !== null ? `DC ${call.dc}` : ""}
          {call.blind ? `${named || call.dc !== null ? " · " : ""}The GM keeps the result` : ""}
        </span>
      </p>
      {shown ? (
        <div className="roll-call-answered">
          <span className="roll-call-result">
            {shown.hiddenFromRoller || !shown.check ? "Rolled for the GM." : checkLine(shown.check)}
          </span>
          {call.kind === "check" && shown.check && inspired && (
            <RerollControl
              viewer="player"
              // The card can mount again once answered, so the result's own mark says the die was typed.
              typed={typed || shown.check.typed === true}
              busy={busy}
              onReroll={(face) => void reroll(face)}
              onInvalid={(message) => toast(message, { tone: "error" })}
            />
          )}
          <Button size="sm" variant="secondary" onClick={onPutAway}>
            Done
          </Button>
        </div>
      ) : call.kind === "save" ? (
        save ? (
          <SavePrompt
            save={save}
            targetName={name}
            canDismiss={false}
            onFeedback={(text) => toast(text)}
            rollMode={rollMode}
            viewer="player"
            inspired={inspired}
          />
        ) : (
          <p className="roll-call-waiting">Waiting for the save.</p>
        )
      ) : (
        <span className="save-prompt-actions">
          <button type="button" className="save-prompt-roll" disabled={busy} onClick={() => void answer()}>
            Roll {label}
          </button>
          {mayType && (
            <FaceEntry
              label={`Your d20 for the ${label}`}
              busy={busy}
              onFace={(face) => void answer(face)}
              onInvalid={(message) => toast(message, { tone: "error" })}
            />
          )}
        </span>
      )}
    </article>
  );
}
