import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeSwitch, ThemeToggle } from "@vtt/ui";

// The theme is a device choice in Settings > Device; the standalone sheet, which has no Settings, keeps the compact
// switch in its header. The two always agree, whichever changes the theme.

beforeEach(() => {
  localStorage.setItem("vtt.theme", "dusk");
  document.documentElement.setAttribute("data-theme", "dusk");
});
afterEach(() => document.documentElement.removeAttribute("data-theme"));

describe("the theme switches", () => {
  it("offer Dusk and Dawn by the names people read, and apply and keep the choice", async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);
    await user.click(screen.getByLabelText("Theme: Dusk"));
    const choices = screen.getAllByRole("menuitemradio", { hidden: true });
    expect(choices.map((choice) => choice.textContent)).toEqual(["Dusk", "Dawn"]);
    expect(within(choices[0]).getByText("Dusk").closest("button")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: "Dawn", hidden: true }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dawn");
    expect(localStorage.getItem("vtt.theme")).toBe("dawn");
    expect(screen.getByLabelText("Theme: Dawn")).toBeInTheDocument();
  });

  it("agree with each other, whichever changes the theme", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ThemeSwitch />
        <ThemeToggle />
      </>
    );
    await user.click(screen.getByRole("button", { name: "Dawn" }));
    expect(screen.getByLabelText("Theme: Dawn")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Theme: Dawn"));
    await user.click(screen.getByRole("menuitemradio", { name: "Dusk", hidden: true }));
    expect(screen.getByRole("button", { name: "Dusk" })).toHaveAttribute("aria-pressed", "true");
  });
});
