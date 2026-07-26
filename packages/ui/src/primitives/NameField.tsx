import { useId, type ReactNode } from "react";
import { cx } from "./util";
import { Field, Input } from "./forms";
import { IconButton } from "./Button";
import { IconShuffle } from "./icons";
import "./NameField.css";

export interface NameFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: ReactNode;
  placeholder?: string;
  /** Recent generator output — click one to take it. Keep the list short (4-6). */
  suggestions?: readonly string[];
  /** Draw a fresh batch. Omit to hide the shuffle button entirely. */
  onShuffle?: () => void;
  shuffleLabel?: string;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
  id?: string;
  className?: string;
}

/** Name entry with a generator beside it: type your own, or shuffle for a
    species-appropriate suggestion and click one.

    The suggestions are plain buttons rather than a dropdown so they are visible
    without a gesture and tappable on a phone — a name list you have to open is a
    name list nobody uses. Picking one fills the field; it stays fully editable. */
export function NameField({
  value, onChange, label = "Name", placeholder = "Name your character",
  suggestions, onShuffle, shuffleLabel = "Suggest names",
  help, error, required, disabled = false, maxLength, id, className
}: NameFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-suggestions`;

  return (
    <div className={cx("nh-namefield", className)}>
      <Field label={label} htmlFor={inputId} help={help} error={error} required={required}>
        <div className="nh-namefield-row">
          <Input
            id={inputId}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            maxLength={maxLength}
            invalid={error != null || undefined}
            autoComplete="off"
            onChange={(event) => onChange(event.target.value)}
          />
          {onShuffle && (
            <IconButton label={shuffleLabel} onClick={onShuffle} disabled={disabled} className="nh-namefield-shuffle">
              <IconShuffle />
            </IconButton>
          )}
        </div>
      </Field>

      {suggestions && suggestions.length > 0 && (
        <div className="nh-namefield-suggestions">
          <span className="nh-namefield-suggestions-label" id={listId}>Suggestions</span>
          <ul className="nh-namefield-list" aria-labelledby={listId}>
            {suggestions.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className={cx("nh-namefield-suggestion", "interactive", name === value && "is-taken")}
                  disabled={disabled}
                  onClick={() => onChange(name)}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
