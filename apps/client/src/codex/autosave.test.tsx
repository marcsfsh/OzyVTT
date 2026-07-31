import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useCodexAutosave } from "./autosave";
import { CodexRequestError, type CodexAutosaveSettings } from "./api";
import { navigate } from "../router";
import { goTo } from "../../test/route";

/**
 * D6 — one rule, one implementation: **the Codex always keeps your work.**
 *
 * Before this hook every editor had its own answer, and the disagreements were where work was lost: the
 * page editor debounced at 800ms, sessions and quests demanded an explicit Save (so a quest objective
 * ticked without saving was simply gone), and the pin inspector wrote through per control. So the tests
 * here are about the two MODES and the one discipline, not about any surface — a per-surface test would
 * re-prove the same hook five times and still not cover the part that actually bites.
 *
 * The part that actually bites is serialization. Two overlapping saves race the same `expectedRev`,
 * 409 against *themselves*, and then wedge the editor because the local rev never resyncs. That is the
 * bug this hook exists to make unrepeatable, and it is the hardest thing here to get right.
 */

const ON: CodexAutosaveSettings = { enabled: true, intervalSeconds: 1 };
const OFF: CodexAutosaveSettings = { enabled: false, intervalSeconds: 1 };

/** A minimal editor: one field, the hook, and the readout. Nothing else, so nothing else can explain a result. */
function Editor({ settings, save, onConflict, initial = "a", disabled = false }: Readonly<{
  settings: CodexAutosaveSettings;
  save: (draft: { text: string }) => Promise<void>;
  onConflict?: () => void;
  initial?: string;
  disabled?: boolean;
}>) {
  const [text, setText] = useState(initial);
  const autosave = useCodexAutosave({ settings, draft: { text }, save, onConflict, disabled });
  return (
    <div>
      <input aria-label="Body" value={text} onChange={(event) => setText(event.target.value)} />
      <output aria-label="Status">{autosave.status}</output>
      <output aria-label="Dirty">{String(autosave.dirty)}</output>
      <button type="button" onClick={() => void autosave.flush()}>Save now</button>
    </div>
  );
}

afterEach(() => { vi.useRealTimers(); goTo("/"); });
beforeEach(() => { goTo("/codex/pages/p1"); });

describe("Autosave ON", () => {
  it("saves after the interval and never renders a Save button's job as the GM's", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Editor settings={ON} save={save} />);

    await user.type(screen.getByLabelText("Body"), "b");
    expect(save).not.toHaveBeenCalled();               // not on the keystroke — that would be a write per character

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toEqual({ text: "ab" });
    await waitFor(() => expect(screen.getByLabelText("Status")).toHaveTextContent("saved"));
  });

  it("debounces — five keystrokes inside the interval are ONE write", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Editor settings={ON} save={save} />);

    await user.type(screen.getByLabelText("Body"), "bcdef");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toEqual({ text: "abcdef" });
  });

  it("honours the GM's interval rather than a hardcoded one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Editor settings={{ enabled: true, intervalSeconds: 5 }} save={save} />);

    await user.type(screen.getByLabelText("Body"), "b");
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  /**
   * THE ONE THAT MATTERS. Two saves in flight race the same `expectedRev` and 409 against each other,
   * and the editor then wedges because its local rev never resyncs. A test that only checked "the second
   * edit was saved" would pass on the broken version too, so this asserts the OVERLAP directly: while
   * the first write is unresolved, no second write may start.
   */
  it("never has two writes in flight — an edit mid-save waits and then re-runs", async () => {
    let release: (() => void) | null = null;
    const inFlight: string[] = [];
    const save = vi.fn((draft: { text: string }) => {
      inFlight.push(draft.text);
      return new Promise<void>((resolve) => { release = resolve; });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Editor settings={ON} save={save} />);

    await user.type(screen.getByLabelText("Body"), "b");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    // Edit again while the first write is still unresolved, and let the debounce fire.
    await user.type(screen.getByLabelText("Body"), "c");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(save).toHaveBeenCalledTimes(1);                 // ...and nothing started

    await act(async () => { release!(); await Promise.resolve(); });
    // Only once the first settles does the second run — and it carries the LATEST draft, not a stale one.
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(inFlight).toEqual(["ab", "abc"]);
  });

  it("reports a 409 as a conflict and asks the caller to resync, rather than as a generic error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onConflict = vi.fn();
    const save = vi.fn().mockRejectedValue(new CodexRequestError("Someone else saved first.", 409, "conflict"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Editor settings={ON} save={save} onConflict={onConflict} />);

    await user.type(screen.getByLabelText("Body"), "b");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await waitFor(() => expect(screen.getByLabelText("Status")).toHaveTextContent("conflict"));
    // The distinction is load-bearing: "conflict" offers Reload, "error" offers Retry, and retrying a
    // 409 with the same stale rev fails forever.
    expect(onConflict).toHaveBeenCalledTimes(1);
  });

  it("reports any other failure as an error, not as a conflict", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn().mockRejectedValue(new CodexRequestError("The codex request failed (500).", 500, "error"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Editor settings={ON} save={save} />);

    await user.type(screen.getByLabelText("Body"), "b");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await waitFor(() => expect(screen.getByLabelText("Status")).toHaveTextContent("error"));
  });

  it("flushes a pending edit on unmount, so switching sections cannot drop the last keystrokes", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const view = render(<Editor settings={ON} save={save} />);

    await user.type(screen.getByLabelText("Body"), "b");
    view.unmount();
    await waitFor(() => expect(save).toHaveBeenCalledWith({ text: "ab" }));
  });

  it("registers no navigation guard — nothing is unsaved for long enough to ask about", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Editor settings={ON} save={vi.fn().mockResolvedValue(undefined)} />);

    await user.type(screen.getByLabelText("Body"), "b");
    navigate("/codex/journal");
    await waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("Autosave OFF", () => {
  it("never writes on a timer, however long you wait", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Editor settings={OFF} save={save} />);

    await user.type(screen.getByLabelText("Body"), "b");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(save).not.toHaveBeenCalled();
  });

  it("reads 'Unsaved changes', not the resting 'Saved'", async () => {
    const user = userEvent.setup();
    render(<Editor settings={OFF} save={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getByLabelText("Status")).toHaveTextContent("idle");
    await user.type(screen.getByLabelText("Body"), "b");
    // The whole point of the OFF mode's readout: "Saved" over an unsaved draft is a lie the GM only
    // discovers on leaving, which is the moment it is most expensive.
    await waitFor(() => expect(screen.getByLabelText("Status")).toHaveTextContent("dirty"));
    expect(screen.getByLabelText("Dirty")).toHaveTextContent("true");
  });

  it("saves on the explicit Save, and stops being dirty", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Editor settings={OFF} save={save} />);

    await user.type(screen.getByLabelText("Body"), "b");
    await user.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ text: "ab" }));
    await waitFor(() => expect(screen.getByLabelText("Dirty")).toHaveTextContent("false"));
    expect(screen.getByLabelText("Status")).toHaveTextContent("saved");
  });

  it("BLOCKS a navigation when the GM declines the prompt", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Editor settings={OFF} save={vi.fn().mockResolvedValue(undefined)} />);

    await user.type(screen.getByLabelText("Body"), "b");
    navigate("/codex/journal");
    // A macrotask, not one microtask: `mayLeave` awaits the guard, so the push that this asserts the
    // ABSENCE of lands three microtasks out. Resuming earlier passed whether or not the answer was
    // honoured, which is no test at all.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // The address must not half-move: the editor stays mounted with the draft in it.
    expect(window.location.pathname).toBe("/codex/pages/p1");
    confirmSpy.mockRestore();
  });

  /**
   * **The phone case, and the one that lost work.** The guard was consulted by `navigate()` and by
   * nothing else, so browser Back and the Android back gesture walked out of a dirty editor with no
   * prompt at all. On a phone, Back *is* the navigation.
   */
  it("BLOCKS the browser Back when the GM declines, and the draft is still on screen after", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Editor settings={OFF} save={vi.fn().mockResolvedValue(undefined)} />);

    // A real history entry to go back FROM, pushed while the draft is still clean.
    navigate("/codex/pages/p2");
    await waitFor(() => expect(window.location.pathname).toBe("/codex/pages/p2"));
    await user.type(screen.getByLabelText("Body"), "b");

    window.history.back();
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/pages/p2"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.location.pathname).toBe("/codex/pages/p2");
    expect(screen.getByLabelText("Body")).toHaveValue("ab");
    confirmSpy.mockRestore();
  });

  it("LETS the browser Back through when the GM accepts", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Editor settings={OFF} save={vi.fn().mockResolvedValue(undefined)} />);

    navigate("/codex/pages/p2");
    await waitFor(() => expect(window.location.pathname).toBe("/codex/pages/p2"));
    await user.type(screen.getByLabelText("Body"), "b");

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/codex/pages/p1"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("ALLOWS the navigation when the GM accepts, and does not save behind their back", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Editor settings={OFF} save={save} />);

    await user.type(screen.getByLabelText("Body"), "b");
    navigate("/codex/journal");
    await waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));
    // "Leave without saving" has to mean it. Silently saving would be a different, worse answer than
    // either of the two the prompt offered.
    expect(save).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("asks nothing when there is nothing unsaved", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Editor settings={OFF} save={vi.fn().mockResolvedValue(undefined)} />);

    navigate("/codex/journal");
    await waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("releases the guard once the draft is saved, so a clean editor never prompts again", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Editor settings={OFF} save={vi.fn().mockResolvedValue(undefined)} />);

    await user.type(screen.getByLabelText("Body"), "b");
    await user.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(screen.getByLabelText("Dirty")).toHaveTextContent("false"));

    navigate("/codex/journal");
    await waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("Disabled", () => {
  it("does nothing at all — no timer, no guard, never dirty", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Editor settings={OFF} save={save} disabled />);

    await user.type(screen.getByLabelText("Body"), "b");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Dirty")).toHaveTextContent("false");

    navigate("/codex/journal");
    await waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
