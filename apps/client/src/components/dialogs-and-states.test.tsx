import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setViewport } from "../../test/viewport";
import { useConfirm, usePrompt } from "./feedback";
import { SomethingBroke } from "./AppErrorBoundary";
import { LOADING_LINE_DELAY_MS, SurfaceFallback } from "./lazySurface";

// The frame's dialogs and states (ADR-0049, rules 3.6, 3.8 and 3.9).

function Confirming({ onResult }: Readonly<{ onResult: (confirmed: boolean) => void }>) {
  const { confirm, dialog } = useConfirm();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void confirm({ title: "Delete the map?", body: "Its pins go with it.", danger: true }).then(onResult)
        }
      >
        Ask
      </button>
      {dialog}
    </>
  );
}

function Prompting() {
  const { prompt, dialog } = usePrompt();
  return (
    <>
      <button type="button" onClick={() => void prompt({ title: "Name the folder?" })}>
        Ask
      </button>
      {dialog}
    </>
  );
}

describe("confirm and prompt", () => {
  it("draws Cancel as a ghost and the deleting action as a danger line, centred on a laptop", async () => {
    const user = userEvent.setup();
    setViewport(1280);
    const onResult = vi.fn();
    render(<Confirming onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    const dialog = screen.getByRole("dialog", { name: "Delete the map?" });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("nh-btn--ghost");
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveClass("nh-btn--destructive");
    expect(dialog).not.toHaveClass("nh-modal--bottom");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it("opens from the bottom on a phone, the prompt too", async () => {
    const user = userEvent.setup();
    setViewport(390);
    const { unmount } = render(<Confirming onResult={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByRole("dialog", { name: "Delete the map?" })).toHaveClass("nh-modal--bottom");
    unmount();
    render(<Prompting />);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByRole("dialog", { name: "Name the folder?" })).toHaveClass("nh-modal--bottom");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("nh-btn--ghost");
  });
});

describe("something broke", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("copies the message from the click and reloads from the primary", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<SomethingBroke message="Cannot read properties of undefined" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/^Something broke/i);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("Cannot read properties of undefined");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalled();
  });

  it("selects the message when the clipboard is refused", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
      configurable: true
    });
    render(<SomethingBroke message="Boom" />);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await vi.waitFor(() => expect(window.getSelection()?.toString()).toBe("Boom"));
  });
});

describe("loading", () => {
  it("says what is loading only after 400ms, and is announced from the start", () => {
    vi.useFakeTimers();
    render(<SurfaceFallback name="Codex" />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Loading$/);
    expect(screen.queryByText("Loading the Codex")).toBeNull();
    act(() => vi.advanceTimersByTime(LOADING_LINE_DELAY_MS + 10));
    expect(screen.getByRole("status")).toHaveTextContent("Loading the Codex");
    vi.useRealTimers();
  });
});
