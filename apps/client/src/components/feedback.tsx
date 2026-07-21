import { useCallback, useState } from "react";

export type NoticeTone = "success" | "error" | "info";
export type NoticeMessage = { tone: NoticeTone; text: string } | null;

/** One consistent notice. Errors announce assertively; success/info announce politely. */
export function Notice({ notice }: { notice: NoticeMessage }) {
  if (!notice) return null;
  const isError = notice.tone === "error";
  return <p className={`notice notice-${notice.tone}`} role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"}>{notice.text}</p>;
}

type ConfirmOptions = { title: string; body: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type ConfirmRequest = ConfirmOptions & { resolve: (confirmed: boolean) => void };

/**
 * Styled replacement for window.confirm. Returns `confirm(options)` returning a Promise<boolean>,
 * plus a `dialog` element to render once near the app root.
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setRequest({ ...options, resolve })), []);
  const settle = (confirmed: boolean) => { request?.resolve(confirmed); setRequest(null); };
  const dialog = request
    ? <div className="confirm-overlay" role="presentation" onClick={() => settle(false)}>
        <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
          <h2 id="confirm-title">{request.title}</h2>
          <p>{request.body}</p>
          <div className="confirm-actions">
            <button className="secondary" onClick={() => settle(false)}>{request.cancelLabel ?? "Cancel"}</button>
            <button className={request.danger ? "danger" : ""} autoFocus onClick={() => settle(true)}>{request.confirmLabel ?? "Confirm"}</button>
          </div>
        </div>
      </div>
    : null;
  return { confirm, dialog };
}

type PromptOptions = { title: string; body?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string };
type PromptRequest = PromptOptions & { resolve: (value: string | null) => void };

/**
 * Styled replacement for window.prompt. `prompt(options)` returns a Promise<string | null>
 * (trimmed value, or null on cancel/empty), plus a `dialog` element to render near the app root.
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
  const dialog = request
    ? <div className="confirm-overlay" role="presentation" onClick={() => settle(null)}>
        <form
          className="confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-title"
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => { event.preventDefault(); const trimmed = value.trim(); settle(trimmed ? trimmed : null); }}
        >
          <h2 id="prompt-title">{request.title}</h2>
          {request.body && <p>{request.body}</p>}
          <input
            autoFocus
            value={value}
            placeholder={request.placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") settle(null); }}
          />
          <div className="confirm-actions">
            <button type="button" className="secondary" onClick={() => settle(null)}>{request.cancelLabel ?? "Cancel"}</button>
            <button type="submit">{request.confirmLabel ?? "OK"}</button>
          </div>
        </form>
      </div>
    : null;
  return { prompt, dialog };
}
