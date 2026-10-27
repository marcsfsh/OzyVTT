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
import { LogComposer } from "./LogComposer";

// The composer under the log sends rolls the server makes: a quick die is one 1dN, the field is a typed formula.
// Nothing is evaluated here, and until the table has chat the field takes formulas only.

const composer = () =>
  render(
    <ToastProvider>
      <LogComposer options={<p>The dice options</p>} />
    </ToastProvider>
  );

afterEach(() => {
  command.mockReset();
  command.mockImplementation(async () => ({ ok: true }));
  setRollVisibility("public");
});

describe("the log's composer", () => {
  it("sends one 1dN for a quick die, at the chosen visibility, and leaves a typed formula alone", async () => {
    const user = userEvent.setup();
    composer();
    await user.type(screen.getByRole("textbox", { name: "Roll dice" }), "2d6+3");
    await user.click(screen.getByRole("button", { name: "Roll 1d8" }));
    expect(command).toHaveBeenCalledWith("dice:roll", { formula: "1d8", purpose: "manual", visibility: "public" });
    expect(screen.getByRole("textbox", { name: "Roll dice" })).toHaveValue("2d6+3");
    setRollVisibility("gm-only");
    await user.click(await screen.findByRole("button", { name: "Roll 1d20" }));
    expect(command).toHaveBeenLastCalledWith("dice:roll", {
      formula: "1d20",
      purpose: "manual",
      visibility: "gm-only"
    });
    expect(screen.getByText("GM only")).toBeInTheDocument();
  });

  it("rolls the typed formula on Enter and clears the field once the server takes it", async () => {
    const user = userEvent.setup();
    composer();
    await user.type(screen.getByRole("textbox", { name: "Roll dice" }), "2d6 + 1d4 - 2{Enter}");
    expect(command).toHaveBeenCalledWith("dice:roll", {
      formula: "2d6 + 1d4 - 2",
      purpose: "manual",
      visibility: "public"
    });
    expect(screen.getByRole("textbox", { name: "Roll dice" })).toHaveValue("");
  });

  it("keeps the text and says the server's reason when it refuses the formula", async () => {
    const user = userEvent.setup();
    command.mockImplementation(async () => ({ ok: false, message: "That isn't a dice formula." }));
    composer();
    await user.type(screen.getByRole("textbox", { name: "Roll dice" }), "hello table");
    await user.click(screen.getByRole("button", { name: "Roll the formula" }));
    expect(await screen.findByText("That isn't a dice formula.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Roll dice" })).toHaveValue("hello table");
  });

  it("opens the full dice tools from Dice options", async () => {
    const user = userEvent.setup();
    composer();
    await user.click(screen.getByRole("button", { name: "Dice options" }));
    expect(screen.getByRole("dialog", { name: "Dice options" })).toHaveTextContent("The dice options");
  });
});
