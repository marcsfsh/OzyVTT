import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@vtt/ui";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({ ok: false }))
}));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { setRollVisibility } from "../dice/roll-visibility";
import { LogComposer, composerIntent, type ComposerTalk } from "./LogComposer";

// The composer under the log: a quick die is one 1dN the server rolls, `/roll` rolls a typed formula, and anything
// else is a line of chat (ADR-0038). Nothing is evaluated here, and a mistyped roll is never sent as chat.

const LYRA = { id: "10000000-0000-4000-8000-000000000001", name: "Lyra" };
const composer = (talk: ComposerTalk = { role: "player", speaker: LYRA }) =>
  render(
    <ToastProvider>
      <LogComposer options={<p>The dice options</p>} talk={talk} />
    </ToastProvider>
  );
const field = () => screen.getByRole("textbox", { name: "Say something or roll" });

afterEach(() => {
  command.mockReset();
  command.mockImplementation(async () => ({ ok: true }));
  setRollVisibility("public");
});

describe("the log's composer", () => {
  it("sends one 1dN for a quick die, at the chosen visibility, and leaves the typed text alone", async () => {
    const user = userEvent.setup();
    composer();
    await user.type(field(), "hello");
    await user.click(screen.getByRole("button", { name: "Roll 1d8" }));
    expect(command).toHaveBeenCalledWith("dice:roll", { formula: "1d8", purpose: "manual", visibility: "public" });
    expect(field()).toHaveValue("hello");
    setRollVisibility("gm-only");
    await user.click(await screen.findByRole("button", { name: "Roll 1d20" }));
    expect(command).toHaveBeenLastCalledWith("dice:roll", {
      formula: "1d20",
      purpose: "manual",
      visibility: "gm-only"
    });
    expect(screen.getByText("GM only")).toBeInTheDocument();
  });

  it("rolls the formula after /roll on Enter and clears the field once the server takes it", async () => {
    const user = userEvent.setup();
    composer();
    await user.type(field(), "/roll 2d6 + 1d4 - 2{Enter}");
    expect(command).toHaveBeenCalledWith("dice:roll", {
      formula: "2d6 + 1d4 - 2",
      purpose: "manual",
      visibility: "public"
    });
    expect(field()).toHaveValue("");
  });

  it("says a line as the player's character, or whispers it to the GM", async () => {
    const user = userEvent.setup();
    composer();
    await user.type(field(), "Hello table{Enter}");
    expect(command).toHaveBeenCalledWith("chat:send", { text: "Hello table", actorId: LYRA.id });
    await user.selectOptions(screen.getByRole("combobox", { name: "Who hears it" }), "Whisper to the GM");
    await user.type(field(), "I steal the idol{Enter}");
    expect(command).toHaveBeenLastCalledWith("chat:send", {
      text: "I steal the idol",
      actorId: LYRA.id,
      whisperTo: "gm"
    });
  });

  it("lets the GM whisper to one party character", async () => {
    const user = userEvent.setup();
    composer({ role: "gm", characters: [LYRA] });
    await user.selectOptions(screen.getByRole("combobox", { name: "Who hears it" }), "Whisper to Lyra");
    await user.type(field(), "It's a fake{Enter}");
    expect(command).toHaveBeenCalledWith("chat:send", { text: "It's a fake", whisperTo: LYRA.id });
  });

  it("keeps a malformed roll out of the chat, and says the server's reason, keeping the text", async () => {
    const user = userEvent.setup();
    command.mockImplementation(async () => ({ ok: false, message: "That isn't a dice formula." }));
    composer();
    await user.type(field(), "/roll 2d");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(command).toHaveBeenCalledWith("dice:roll", { formula: "2d", purpose: "manual", visibility: "public" });
    expect(command).not.toHaveBeenCalledWith("chat:send", expect.anything());
    expect(await screen.findByText("That isn't a dice formula.")).toBeInTheDocument();
    expect(field()).toHaveValue("/roll 2d");
  });

  it("refuses a slash word it doesn't know without sending anything", async () => {
    const user = userEvent.setup();
    composer();
    await user.type(field(), "/rol 1d20{Enter}");
    expect(command).not.toHaveBeenCalled();
    expect(await screen.findByText(/doesn't know \/rol/)).toBeInTheDocument();
    expect(composerIntent("/r 1d6")).toEqual({ kind: "roll", formula: "1d6" });
    expect(composerIntent("/roll")).toMatchObject({ kind: "unknown" });
    expect(composerIntent("1d20+5")).toEqual({ kind: "chat", text: "1d20+5" });
  });

  it("opens the full dice tools from Dice options", async () => {
    const user = userEvent.setup();
    composer();
    await user.click(screen.getByRole("button", { name: "Dice options" }));
    expect(screen.getByRole("dialog", { name: "Dice options" })).toHaveTextContent("The dice options");
  });
});
