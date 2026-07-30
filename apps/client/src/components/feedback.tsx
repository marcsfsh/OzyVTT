import { useCallback, useState } from "react";
import { Modal, Button, Input, Switch } from "@vtt/ui";

export type NoticeTone = "success" | "error" | "info";
export type NoticeMessage = { tone: NoticeTone; text: string } | null;

/** One consistent notice. Errors announce assertively; success/info announce politely. */
export function Notice({ notice }: { notice: NoticeMessage }) {
  if (!notice) return null;
  const isError = notice.tone === "error";
  return <p className={`notice notice-${notice.tone}`} role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"}>{notice.text}</p>;
}

/**
 * An optional "don't ask me this again" control inside a confirm.
 *
 * `onChange` fires **only when the GM confirms**, with the control's final state. Suppressing a warning
 * is an affirmative choice, so it rides on the affirmative button: a GM who flicks this and then cancels
 * has abandoned the whole interaction, and silently disabling a warning on the way out of a dialog they
 * backed out of is how a safety net disappears without anyone deciding it should.
 *
 * A caller that offers this owes the GM a way BACK — there is no settings screen in this app to undo it in.
 */
export type ConfirmSuppress = { label: string; onChange: (suppressed: boolean) => void };
type ConfirmOptions = { title: string; body: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; suppress?: ConfirmSuppress };
type ConfirmRequest = ConfirmOptions & { resolve: (confirmed: boolean) => void };

/**
 * Styled replacement for window.confirm. Returns `confirm(options)` returning a Promise<boolean>,
 * plus a `dialog` element to render once near the app root. Built on the shared Modal primitive,
 * so it inherits the native focus-trap, focus return, scrim blur, scroll lock, and dialog entrance.
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  // Reset per request, not per settle: a stale `true` from a previous dialog would arrive pre-flicked on
  // the next one, and the GM would suppress a warning by agreeing to something else entirely.
  const [suppressed, setSuppressed] = useState(false);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => { setSuppressed(false); setRequest({ ...options, resolve }); }), []);
  const settle = (confirmed: boolean) => {
    if (confirmed && request?.suppress) request.suppress.onChange(suppressed);
    request?.resolve(confirmed);
    setRequest(null);
  };
  const dialog = (
    <Modal
      open={!!request}
      onClose={() => settle(false)}
      size="sm"
      title={request?.title}
      ariaLabel={request?.title ?? "Confirm"}
      footer={request && <>
        <Button variant="secondary" onClick={() => settle(false)}>{request.cancelLabel ?? "Cancel"}</Button>
        <Button variant={request.danger ? "destructive" : "primary"} autoFocus onClick={() => settle(true)}>{request.confirmLabel ?? "Confirm"}</Button>
      </>}
    >
      {request && <p>{request.body}</p>}
      {/* `Switch`, not a bare checkbox: it carries its own 44px tap floor (mobile parity is an invariant and
          this dialog is reachable from a phone), and this app has no styled checkbox primitive to inherit
          one from. The change does not take effect until Confirm, which is stated in the label. */}
      {request?.suppress && (
        <div className="confirm-suppress">
          <Switch checked={suppressed} onChange={setSuppressed} label={request.suppress.label} />
        </div>
      )}
    </Modal>
  );
  return { confirm, dialog };
}

type PromptOptions = { title: string; body?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string };
type PromptRequest = PromptOptions & { resolve: (value: string | null) => void };

/**
 * Styled replacement for window.prompt. `prompt(options)` returns a Promise<string | null>
 * (trimmed value, or null on cancel/empty), plus a `dialog` element to render near the app root.
 * Built on the shared Modal primitive (focus-trap, scrim blur, scroll lock, dialog entrance).
 */
export function usePrompt() {
  const [request, setRequest] = useState<PromptRequest | null>(null);
  const [value, setValue] = useState("");
  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(options.defaultValue ?? "");
        setRequest({ ...options, resolve });
      }),
    []
  );
  const settle = (result: string | null) => { request?.resolve(result); setRequest(null); };
  const submit = () => { const trimmed = value.trim(); settle(trimmed ? trimmed : null); };
  const dialog = (
    <Modal
      open={!!request}
      onClose={() => settle(null)}
      size="sm"
      title={request?.title}
      ariaLabel={request?.title ?? "Enter a value"}
      footer={request && <>
        <Button variant="secondary" onClick={() => settle(null)}>{request.cancelLabel ?? "Cancel"}</Button>
        <Button variant="primary" onClick={submit}>{request.confirmLabel ?? "OK"}</Button>
      </>}
    >
      {request && <>
        {request.body && <p>{request.body}</p>}
        <Input
          autoFocus
          value={value}
          placeholder={request.placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }}
        />
      </>}
    </Modal>
  );
  return { prompt, dialog };
}
