import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from "react";
import { cx } from "./util";
import { IconWarning } from "./icons";
import "./forms.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}
export function Input({ invalid, className, ...rest }: InputProps) {
  return <input className={cx("nh-input", invalid && "nh-input--invalid", className)} aria-invalid={invalid || undefined} {...rest} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  ref?: Ref<HTMLSelectElement>;
}
export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <select className={cx("nh-input", "nh-select", invalid && "nh-input--invalid", className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}
export function Textarea({ invalid, className, ...rest }: TextareaProps) {
  return <textarea className={cx("nh-input", "nh-textarea", invalid && "nh-input--invalid", className)} aria-invalid={invalid || undefined} {...rest} />;
}

export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  /** Helper text shown below the control when there's no error. */
  help?: ReactNode;
  /** Error text (with icon) — replaces help and gets role=alert. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}
/** Label + control + help/error wrapper. Validation always pairs an icon with
    text (the palette is color-vision-unfriendly, so color is never the only cue). */
export function Field({ label, htmlFor, help, error, required, className, children }: FieldProps) {
  return (
    <div className={cx("nh-field", className)}>
      {label != null && (
        <label className="nh-field-label" htmlFor={htmlFor}>
          {label}
          {required && <span aria-hidden="true" className="nh-field-req"> *</span>}
        </label>
      )}
      {children}
      {error != null ? (
        <p className="nh-field-error" role="alert">
          <span className="nh-field-error-icon" aria-hidden="true"><IconWarning /></span>{error}
        </p>
      ) : help != null ? (
        <p className="nh-field-help">{help}</p>
      ) : null}
    </div>
  );
}
