import { useCallback, useState } from "react";
import { Modal, Button, Input, Switch } from "@vtt/ui";

export type NoticeTone = "success" | "error" | "info";
export type NoticeMessage = { tone: NoticeTone; text: string } | null;

/** One consistent notice. Errors announce assertively; success/info announce politely. */
export function Notice({ notice }: { notice: NoticeMessage }) {
  if (!notice) return null;
  const isError = notice.tone === "error";
  return (
    <p
      className={`notice notice-${notice.tone}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      {notice.text}
    </p>
  );
}

/**
 * An optional "don't ask me this again" control inside a confirm. `onChange` fires only when the
 * GM confirms, with the control's final state; cancelling must not disable a warning.
 * A caller that offers this owes the GM a way to turn the warning back on.
 */
export type ConfirmSuppress = { label: string; onChange: (suppressed: boolean) => void };
type ConfirmOptions = {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  suppress?: ConfirmSuppress;
};
type ConfirmRequest = ConfirmOptions & { resolve: (confirmed: boolean) => void };

/**
 * Styled replacement for window.confirm: `confirm(options)` returns a Promise<boolean>, and
 * `dialog` is rendered once near the app root. Built on the shared Modal primitive.
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  // Reset per request: a stale `true` from a previous dialog would suppress a warning the GM never saw.
  const [suppressed, setSuppressed] = useState(false);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setSuppressed(false);
        setRequest({ ...options, resolve });
      }),
    []
  );
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
      footer={
        request && (
          <>
            <Button variant="secondary" onClick={() => settle(false)}>
              {request.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={request.danger ? "destructive" : "primary"} autoFocus onClick={() => settle(true)}>
              {request.confirmLabel ?? "Confirm"}
            </Button>
          </>
        )
      }
    >
      {request && <p>{request.body}</p>}
      {/* `Switch` carries its own 44px tap floor; there is no styled checkbox primitive. The label says
          it takes effect on Confirm. */}
      {request?.suppress && (
        <div className="confirm-suppress">
          <Switch checked={suppressed} onChange={setSuppressed} label={request.suppress.label} />
        </div>
      )}
    </Modal>
  );
  return { confirm, dialog };
}

type PromptOptions = {
  title: string;
  body?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};
type PromptRequest = PromptOptions & { resolve: (value: string | null) => void };

/**
 * Styled replacement for window.prompt: `prompt(options)` returns a Promise<string | null>
 * (trimmed value, or null on cancel/empty), and `dialog` is rendered near the app root.
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
  const settle = (result: string | null) => {
    request?.resolve(result);
    setRequest(null);
  };
  const submit = () => {
    const trimmed = value.trim();
    settle(trimmed ? trimmed : null);
  };
  const dialog = (
    <Modal
      open={!!request}
      onClose={() => settle(null)}
      size="sm"
      title={request?.title}
      ariaLabel={request?.title ?? "Enter a value"}
      footer={
        request && (
          <>
            <Button variant="secondary" onClick={() => settle(null)}>
              {request.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant="primary" onClick={submit}>
              {request.confirmLabel ?? "OK"}
            </Button>
          </>
        )
      }
    >
      {request && (
        <>
          {request.body && <p>{request.body}</p>}
          <Input
            autoFocus
            value={value}
            placeholder={request.placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
        </>
      )}
    </Modal>
  );
  return { prompt, dialog };
}
