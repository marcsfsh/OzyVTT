import { COST_GROUPS, optionsOf, type TurnOption } from "./turn-options";

/** What a row's button says it does. */
const verbOf = (option: TurnOption) => (option.kind === "weapon" ? "Attack" : option.kind === "spell" ? "Cast" : "Use");

/** The Concentration tag on a spell's name, and the legend's word for it. */
export function ConcentrationTag() {
  return (
    <span className="cs-tag" title="Concentration">
      C
    </span>
  );
}

function OptionRow({
  option,
  note,
  disabled,
  onUse
}: Readonly<{
  option: TurnOption;
  /** What the row says on its right: its verb, Off turn, or why it waits. */
  note: string;
  disabled: boolean;
  onUse: (option: TurnOption) => void;
}>) {
  return (
    <button
      type="button"
      className={`cs-action is-${option.kind}${option.reason ? " has-reason" : ""}`}
      disabled={disabled}
      title={option.summary.description || undefined}
      onClick={() => onUse(option)}
    >
      <span className="cs-action-text">
        <strong className="cs-action-name">
          {option.name}
          {option.mastery && (
            <>
              {" · "}
              <span className="cs-action-mastery">{option.mastery}</span>
            </>
          )}
          {option.concentration && <ConcentrationTag />}
          {option.freeLeft !== undefined && option.freeLeft !== 0 && (
            <span className="cs-tag is-free">{option.freeLeft === null ? "At will" : `${option.freeLeft} free`}</span>
          )}
        </strong>
        {option.line && <span className="cs-action-line">{option.line}</span>}
        {option.reason && <span className="cs-action-reason">{option.reason}</span>}
      </span>
      <span className="cs-action-verb">{note}</span>
    </button>
  );
}

/**
 * Everything the character can do, grouped by what it costs: Action, Magic action from items, Bonus Action and
 * Reaction. Each row says its level, range, attack or DC and effect in the server's words. A reaction waits for a
 * trigger to offer it, so its row reads Off turn; off the character's turn the others wait for it.
 */
export function ActionList({
  options,
  myTurn,
  busy,
  unavailable,
  empty,
  onUse
}: Readonly<{
  options: readonly TurnOption[];
  /** The character acts now: its turn, or a readied action off it. Reactions are offered either way. */
  myTurn: boolean;
  busy: boolean;
  /** Why nothing can be taken now ("Unavailable while Unconscious"): the list stays in view, disabled. */
  unavailable?: string;
  /** What shows when there are no rows (an Actions subtab with nothing in it). */
  empty?: string;
  onUse: (option: TurnOption) => void;
}>) {
  if (options.length === 0 && empty) return <p className="cs-note">{empty}</p>;
  const note = (option: TurnOption) =>
    unavailable ? "Unavailable" : option.cost === "reaction" ? "Off turn" : !myTurn ? "On your turn" : verbOf(option);
  const off = (option: TurnOption) => busy || unavailable !== undefined || (!myTurn && option.cost !== "reaction");
  return (
    <div className="cs-actions">
      {COST_GROUPS.map(([cost, label]) => {
        const group = optionsOf(options, cost);
        if (group.length === 0) return null;
        return (
          <section key={cost} className="cs-action-group" aria-label={label}>
            <span className="cs-eyebrow">{label}</span>
            <ul className="cs-action-list">
              {group.map((option) => (
                <li key={option.id}>
                  <OptionRow option={option} note={note(option)} disabled={off(option)} onUse={onUse} />
                  {option.children.length > 0 && (
                    <ul className="cs-action-children">
                      {option.children.map((child) => (
                        <li key={child.id}>
                          <OptionRow option={child} note={note(child)} disabled={off(child)} onUse={onUse} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
