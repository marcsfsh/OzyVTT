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

/** A save's DC as the table stacks it, the ability over the number ("CON" over 14); an attack bonus as it is. */
export function HitOrDc({ value }: Readonly<{ value: string | null | undefined }>) {
  const save = value ? /^DC (\d+) (\w+)$/.exec(value) : null;
  if (!save) return <>{value}</>;
  return (
    <span className="cs-dc" aria-label={value ?? undefined}>
      <small className="cs-dc-ab" aria-hidden="true">
        {save[2]!.toUpperCase()}
      </small>
      <span aria-hidden="true">{save[1]}</span>
    </span>
  );
}

/** The parts of a row's line the table's columns don't already show: a spell's level, darts, free casts, uses left. */
function tableLine(option: TurnOption) {
  const shown = [option.hitOrDc, option.range, option.damage ? `${option.damage.dice}` : null];
  const damageWords = option.damage
    ? [option.damage.type ? `${option.damage.dice} ${option.damage.type}` : option.damage.dice]
    : [];
  return option.line
    .split(" · ")
    .filter((part) => !shown.includes(part) && !damageWords.includes(part) && !part.startsWith("Regain "))
    .join(" · ");
}

function OptionRow({
  option,
  note,
  plain,
  disabled,
  table,
  onUse
}: Readonly<{
  option: TurnOption;
  /** What the row says on its right: its verb, Off turn, or why it waits. */
  note: string;
  /** The note is the row's plain verb (Attack, Cast, Use), which a phone's table leaves out. */
  plain: boolean;
  disabled: boolean;
  /** The sheet's table: the range, hit or DC and damage in columns inside the same button (ADR-0047). */
  table: boolean;
  onUse: (option: TurnOption) => void;
}>) {
  if (table) {
    const line = tableLine(option);
    // A phone's table has no Range or verb column, so the range, the damage type and a verb that isn't the row's plain
    // one (Off turn, On your turn) join the line under the name.
    const phoneLine = [line, option.range, option.damage?.type, plain ? null : note].filter(Boolean).join(" · ");
    return (
      <button
        type="button"
        className={`cs-action is-table is-${option.kind}${option.reason ? " has-reason" : ""}`}
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
          {line && <span className="cs-action-line is-wide">{line}</span>}
          {phoneLine && <span className="cs-action-line is-narrow">{phoneLine}</span>}
          {option.reason && <span className="cs-action-reason">{option.reason}</span>}
        </span>
        <span className="cs-action-col is-range">{option.range}</span>
        <span className="cs-action-col is-hit">
          <HitOrDc value={option.hitOrDc} />
        </span>
        <span className="cs-action-col is-dmg">
          {option.damage && (
            <>
              <b className="cs-action-dice">{option.damage.dice}</b>
              {option.damage.type && <small className="cs-action-type"> {option.damage.type}</small>}
            </>
          )}
        </span>
        <span className={`cs-action-verb${plain ? " is-plain" : ""}`}>{note}</span>
      </button>
    );
  }
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
  table = false,
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
  /** The sheet's table, with one header row for the whole list. */
  table?: boolean;
  onUse: (option: TurnOption) => void;
}>) {
  if (options.length === 0 && empty) return <p className="cs-note">{empty}</p>;
  const note = (option: TurnOption) =>
    unavailable ? "Unavailable" : option.cost === "reaction" ? "Off turn" : !myTurn ? "On your turn" : verbOf(option);
  const off = (option: TurnOption) => busy || unavailable !== undefined || (!myTurn && option.cost !== "reaction");
  const plain = (option: TurnOption) => note(option) === verbOf(option);
  return (
    <div className={`cs-actions${table ? " is-table" : ""}`}>
      {table && (
        <div className="cs-action-th" aria-hidden="true">
          <span>Name</span>
          <span className="is-range">Range</span>
          <span className="is-hit">Hit / DC</span>
          <span className="is-dmg">Damage</span>
          <span />
        </div>
      )}
      {COST_GROUPS.map(([cost, label]) => {
        const group = optionsOf(options, cost);
        if (group.length === 0) return null;
        return (
          <section key={cost} className="cs-action-group" aria-label={label}>
            <span className="cs-eyebrow">{label}</span>
            <ul className="cs-action-list">
              {group.map((option) => (
                <li key={option.id}>
                  <OptionRow
                    option={option}
                    note={note(option)}
                    plain={plain(option)}
                    disabled={off(option)}
                    table={table}
                    onUse={onUse}
                  />
                  {option.children.length > 0 && (
                    <ul className="cs-action-children">
                      {option.children.map((child) => (
                        <li key={child.id}>
                          <OptionRow
                            option={child}
                            note={note(child)}
                            plain={plain(child)}
                            disabled={off(child)}
                            table={table}
                            onUse={onUse}
                          />
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
