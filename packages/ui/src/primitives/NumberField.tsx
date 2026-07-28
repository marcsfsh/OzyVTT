import { useEffect, useId, useRef, useState } from "react";
import { cx } from "./util";
import { Input } from "./forms";
import "./NumberField.css";

export interface NumberFieldProps {
  value: number | null;
  onChange: (next: number | null) => void;
  min?: number;
  max?: number;
  /** Costs and weights (1.5 lb, 0.02 gp). Off by default — most numbers here are counts. */
  allowDecimal?: boolean;
  /** Modifier amounts (−2 STR, a −1 attack bonus). Off by default. */
  allowNegative?: boolean;
  /** Suffix shown inside the well: "gp", "lb", "ft". Never part of the value. */
  unit?: string;
  id?: string;
  placeholder?: string;
  invalid?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  className?: string;
}

/** A free-typed number — "1250 gp", "133 hit points", a −2 ability bonus.

    Two decisions, both of which are bugs if taken the other way:

    1. **`type="text"` + `inputMode`, not `type="number"`.** The repo's established idiom
       (EncounterPanel's d20 field, DiceInputRow's manual entry). `type="number"` gives a
       spinner nobody uses at 375px, silently swallows the value on a stray letter (the
       input reports ""), and scroll-wheels over a focused field change the number.
    2. **Clamp on BLUR, never mid-typing.** Clamping per keystroke against `min: 10` eats
       the first digit of "12" the instant it is typed — the field fights the GM. While
       typing, only characters are filtered; the range is enforced when the field is left.

    `Stepper` remains the control for small bounded nudges (an ability score, "choose 3").
    This is for the values where nudging by one twelve hundred times is absurd. */
export function NumberField({
  value,
  onChange,
  min,
  max,
  allowDecimal = false,
  allowNegative = false,
  unit,
  id,
  placeholder,
  invalid,
  className,
  ...aria
}: NumberFieldProps) {
  const autoId = useId();
  const fieldId = id ?? `nh-num-${autoId}`;
  const unitId = `${fieldId}-unit`;
  const [text, setText] = useState(() => format(value));
  /** The last number this field emitted, so an EXTERNAL change adopts but a round-trip
      of our own value never rewrites what is being typed ("1." → "1"). */
  const emitted = useRef<number | null>(value);

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setText(format(value));
  }, [value]);

  const clean = (raw: string) => {
    let out = raw.replace(allowDecimal ? /[^0-9.\-]/g : /[^0-9\-]/g, "");
    // A sign is only legal leading, and only once.
    const negative = allowNegative && out.startsWith("-");
    out = out.replace(/-/g, "");
    // Likewise one decimal point.
    const dot = out.indexOf(".");
    if (dot >= 0) out = `${out.slice(0, dot + 1)}${out.slice(dot + 1).replace(/\./g, "")}`;
    return negative ? `-${out}` : out;
  };

  const commit = (raw: string) => {
    setText(raw);
    const parsed = parse(raw);
    emitted.current = parsed;
    onChange(parsed);
  };

  const blur = () => {
    const parsed = parse(text);
    if (parsed === null) {
      setText("");
      if (emitted.current !== null) { emitted.current = null; onChange(null); }
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    const settled = allowDecimal ? clamped : Math.round(clamped);
    setText(format(settled));
    if (settled !== emitted.current) { emitted.current = settled; onChange(settled); }
  };

  return (
    <div className={cx("nh-numberfield", unit != null && "nh-numberfield--unit", className)}>
      <Input
        id={fieldId}
        className="nh-numberfield-input tabular"
        type="text"
        /* "decimal" surfaces the point on the iOS keypad; "numeric" does not, which
           would make 1.5 lb untypeable on a phone. */
        inputMode={allowDecimal ? "decimal" : "numeric"}
        pattern={allowNegative ? "-?[0-9]*" : "[0-9]*"}
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        invalid={invalid}
        aria-label={aria["aria-label"]}
        aria-describedby={cx(unit != null && unitId, aria["aria-describedby"]) || undefined}
        onChange={(event) => commit(clean(event.target.value))}
        onBlur={blur}
      />
      {/* Not aria-hidden: "1250" and "1250 gp" are different facts, and the unit is the
          one that says which. It rides aria-describedby so the control announces both. */}
      {unit != null && <span className="nh-numberfield-unit" id={unitId}>{unit}</span>}
    </div>
  );
}

function format(value: number | null): string {
  return value === null || Number.isNaN(value) ? "" : String(value);
}

function parse(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === "-.") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
