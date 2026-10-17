import { useState } from "react";
import type { CheckRollResult, PlayerRollCall, PlayerView } from "@vtt/domain";
import { Button, useToast } from "@vtt/ui";
import { useSkillCatalog } from "../content/catalogs";
import { callLabel, resultWords } from "../dice/roll-call-words";
import { useRollPreference } from "../dice/roll-preference";
import { command } from "../lib/command";
import { FaceEntry, RerollControl } from "./RollControls";
import { SavePrompt } from "./SavePrompt";
import { checkLine } from "./useSheetRolls";
import "../dice/roll-calls.css";

type Entry = PlayerRollCall["entries"][number];

/**
 * The GM's calls for a roll, wherever the player is: one card per character called on, pinned to the bottom of the
 * screen until it is rolled and put away. A check is rolled here (or typed from a physical die); a save call is the
 * save the character owes, answered as any other. A blind call's result stays with the GM.
 */
export function RollCallPrompts({ state }: Readonly<{ state: PlayerView }>) {
  // Answered cards the player has put away, until the GM closes the call.
  const [putAway, setPutAway] = useState<ReadonlySet<string>>(new Set());
  const cards = state.rollCalls.flatMap((call) =>
    call.entries
      .filter((entry) => !putAway.has(`${call.id}:${entry.actorId}`))
      .map((entry) => ({ call, entry, key: `${call.id}:${entry.actorId}` }))
  );
  if (cards.length === 0) return null;
  return (
    <aside className="roll-call-dock scroll-y" aria-label="Rolls the GM calls for">
      {cards.map(({ call, entry, key }) => (
        <RollCallCard
          key={key}
          call={call}
          entry={entry}
          state={state}
          // A player with one character needs no name on the card.
          named={new Set(state.rollCalls.flatMap((open) => open.entries.map((each) => each.actorId))).size > 1}
          onPutAway={() => setPutAway((current) => new Set([...current, key]))}
        />
      ))}
    </aside>
  );
}

function RollCallCard({
  call,
  entry,
  state,
  named,
  onPutAway
}: Readonly<{
  call: PlayerRollCall;
  entry: Entry;
  state: PlayerView;
  named: boolean;
  onPutAway: () => void;
}>) {
  const { toast } = useToast();
  const { mayType, rollMode } = useRollPreference();
  const skillCatalog = useSkillCatalog();
  const [busy, setBusy] = useState(false);
  // The answer was typed from a physical die, so a Heroic Inspiration reroll is typed too.
  const [typed, setTyped] = useState(false);
  const actor = state.actors.find((candidate) => candidate.id === entry.actorId);
  const name = actor?.name ?? "Your character";
  const inspired = actor?.heroicInspiration === true;
  const label = callLabel(call, (id) => skillCatalog.items.find((skill) => skill.id === id)?.name);
  const save = entry.saveId ? state.combat.pendingSaves.find((pending) => pending.id === entry.saveId) : undefined;

  const say = (result: CheckRollResult) => {
    if (!result.ok) toast(result.message ?? "That roll was refused.", { tone: "error" });
    else if (result.hiddenFromRoller) toast(`${label}: rolled for the GM.`, { tone: "success" });
    else if (result.check) toast(checkLine(result.check), { tone: "success" });
  };
  const answer = async (face?: number) => {
    setBusy(true);
    const result = await command("roll-call:answer", {
      callId: call.id,
      actorId: entry.actorId,
      ...(face !== undefined ? { face } : {})
    });
    setBusy(false);
    if (result.ok) setTyped(face !== undefined);
    return result;
  };
  const reroll = async (face?: number) => {
    setBusy(true);
    const result = await command("check:reroll", { actorId: entry.actorId, ...(face !== undefined ? { face } : {}) });
    setBusy(false);
    say(result);
  };

  return (
    <article className="roll-call-card" aria-label={`${label} for ${name}`}>
      <p className="roll-call-card-head">
        <strong>The GM calls for a {label}</strong>
        <span className="roll-call-meta">
          {named ? name : ""}
          {named && call.dc !== null ? " · " : ""}
          {call.dc !== null ? `DC ${call.dc}` : ""}
          {call.blind ? `${named || call.dc !== null ? " · " : ""}Hidden from you` : ""}
        </span>
      </p>
      {entry.answered ? (
        <div className="roll-call-answered">
          <span className="roll-call-result">{entry.result ? resultWords(entry.result) : "Rolled for the GM."}</span>
          {call.kind === "check" && entry.result && inspired && (
            <RerollControl
              viewer="player"
              typed={typed}
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
          <button type="button" className="save-prompt-roll" disabled={busy} onClick={() => void answer().then(say)}>
            Roll
          </button>
          {mayType && (
            <FaceEntry
              label={`Your d20 for the ${label}`}
              busy={busy}
              onFace={(face) => void answer(face).then(say)}
              onInvalid={(message) => toast(message, { tone: "error" })}
            />
          )}
        </span>
      )}
    </article>
  );
}
