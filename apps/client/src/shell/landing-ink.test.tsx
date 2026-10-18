import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseColour, THEMES, THEME_NAMES, type Theme } from "@vtt/ui";
import { baseStylesheets, contrastRatio, loadStylesheets, resolveVars, textColourOf } from "../../test/real-css";
import { Landing } from "./Landing";

/*
 * Every button on the title screen and in the GM sign-in, painted with the real stylesheets in each theme: its words
 * clear 4.5:1 on the plate under them, and nothing dims the whole button. A page rule that coloured every button in a
 * card once put dark ink on the primary's dark plate in Night and Dusk; this fails on that.
 */

let unload = () => {};
beforeEach(() => {
  unload = loadStylesheets([...baseStylesheets(), "apps/client/src/shell/landing.css"]);
});
afterEach(() => {
  unload();
  document.documentElement.removeAttribute("data-theme");
});

/** The element that carries a control's words, or its icon when it has none. */
function inkElementOf(control: HTMLElement): Element {
  const label = [...control.querySelectorAll("*")].find((element) =>
    [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
  );
  return label ?? control.querySelector("svg") ?? control;
}

/** The token whose colours lie under a control's words, by the primitive it is. */
function plateOf(control: HTMLElement): string {
  if (control.matches(".nh-btn:disabled")) return "--surface-2";
  if (control.matches(".nh-btn--primary")) return "--primary-base";
  if (control.matches(".nh-btn--secondary")) return "--raised";
  if (control.matches(".nh-modal-close")) return "--surface-3";
  if (control.matches(".nh-segmented-option[aria-pressed='true']")) return "--tab-on";
  if (control.matches(".nh-segmented-option")) return "--track";
  // Ghost buttons, links and switch labels sit on the card's own plate.
  return "--surface-1";
}

function expectReadable(theme: Theme, control: HTMLElement) {
  const name = control.getAttribute("aria-label") ?? control.textContent?.trim() ?? control.className;
  const ink = textColourOf(inkElementOf(control));
  const plate = resolveVars(control, `var(${plateOf(control)})`);
  const stops = [...plate.matchAll(/#[0-9a-f]{6}|#[0-9a-f]{3}\b|rgba?\([^)]*\)/gi)].map((match) => match[0]);
  expect(stops.length, `${name}: ${plateOf(control)} resolves to colours`).toBeGreaterThan(0);
  for (const stop of stops) {
    const ratio = contrastRatio(ink, parseColour(stop)!);
    expect(ratio, `${THEME_NAMES[theme]} · ${name} on ${stop}`).toBeGreaterThanOrEqual(4.5);
  }
  expect(getComputedStyle(control).opacity, `${THEME_NAMES[theme]} · ${name} opacity`).toBe("1");
}

const props = () => ({
  driving: false,
  bootstrapped: true,
  busy: false,
  resuming: false,
  gmPrompt: false,
  notice: null,
  onJoin: vi.fn(),
  onSignIn: vi.fn(),
  onSetPassword: vi.fn(),
  onClearNotice: vi.fn()
});

describe("the title screen's buttons", () => {
  for (const theme of THEMES) {
    it(`are readable in ${THEME_NAMES[theme]}, from the title to the reset steps`, async () => {
      document.documentElement.setAttribute("data-theme", theme);
      // jsdom resolves no `var()` in a font size, so role queries skip their visibility check and clicks skip theirs.
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      render(<Landing {...props()} />);

      for (const control of screen.getAllByRole("button", { hidden: true })) expectReadable(theme, control);

      await user.click(screen.getByRole("button", { name: "Enter as GM", hidden: true }));
      // The sign-in opens with the button off until there is a password, then on.
      expect(screen.getByRole("button", { name: "Enter table", hidden: true })).toBeDisabled();
      for (const control of [
        ...screen.getAllByRole("button", { hidden: true }),
        screen.getByRole("switch", { hidden: true })
      ])
        expectReadable(theme, control);
      await user.type(screen.getByLabelText("GM password"), "a long enough password");
      expectReadable(theme, screen.getByRole("button", { name: "Enter table", hidden: true }));

      await user.click(screen.getByRole("button", { name: "Forgot the password", hidden: true }));
      const dialog = screen.getByRole("dialog", { name: "Reset the GM password", hidden: true });
      for (const control of within(dialog).getAllByRole("button", { hidden: true })) expectReadable(theme, control);
    });
  }
});
