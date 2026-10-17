import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Landing } from "./Landing";

type Props = Parameters<typeof Landing>[0];

const landing = (overrides: Partial<Props> = {}) => {
  const props: Props = {
    driving: false,
    bootstrapped: true,
    busy: false,
    resuming: false,
    gmPrompt: true,
    notice: null,
    onJoin: vi.fn(),
    onSignIn: vi.fn(),
    onSetPassword: vi.fn(),
    onClearNotice: vi.fn(),
    ...overrides
  };
  render(<Landing {...props} />);
  return props;
};

describe("the GM sign-in", () => {
  it("shows the password on request", async () => {
    const user = userEvent.setup();
    landing();
    const field = screen.getByLabelText("GM password");
    expect(field).toHaveAttribute("type", "password");
    const show = screen.getByRole("button", { name: "Show password" });
    await user.click(show);
    expect(field).toHaveAttribute("type", "text");
    expect(show).toHaveAttribute("aria-pressed", "true");
  });

  it("clears the last error as the next attempt starts, and passes the keep-signed-in choice", async () => {
    const user = userEvent.setup();
    const props = landing({ notice: { tone: "error", text: "That is not the GM password. Check it and try again." } });
    await user.type(screen.getByLabelText("GM password"), "correct horse battery");
    await user.click(screen.getByRole("switch", { name: "Keep me signed in on this computer" }));
    await user.click(screen.getByRole("button", { name: "Enter table" }));
    expect(props.onClearNotice).toHaveBeenCalled();
    expect(props.onSignIn).toHaveBeenCalledWith("correct horse battery", true);
  });

  it("keeps the reset steps behind a link, in a dialog", async () => {
    const user = userEvent.setup();
    landing();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Forgot the password" }));
    const dialog = screen.getByRole("dialog", { name: "Reset the GM password" });
    expect(dialog).toHaveTextContent("Delete the file data/auth.json");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sets the first password with no keep-signed-in switch or reset link", async () => {
    const user = userEvent.setup();
    const props = landing({ bootstrapped: false });
    expect(screen.getByRole("heading", { name: "Set up the GM password" })).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Forgot the password" })).toBeNull();
    await user.type(screen.getByLabelText("GM password"), "a long enough password");
    await user.click(screen.getByRole("button", { name: "Set GM password" }));
    expect(props.onSetPassword).toHaveBeenCalledWith("a long enough password");
  });

  it("offers neither door while a stored session is tried", () => {
    landing({ gmPrompt: false, resuming: true });
    expect(screen.getByRole("button", { name: "Join as Player" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enter as GM" })).toBeDisabled();
  });
});
