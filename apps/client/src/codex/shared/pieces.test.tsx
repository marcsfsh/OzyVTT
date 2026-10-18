import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api", async (actual) => (await import("../../../test/codex-fakes")).fakeApiModule(await actual()));

import type { CodexCalendar, CodexInWorldDate } from "@vtt/domain";
import { api, block, resetFakes } from "../../../test/codex-fakes";
import { DateBar, worldDateLabel } from "./DateBar";
import { Dropdown } from "./Dropdown";
import { linksSentence, stampOf } from "./reveals";

const CALENDAR: CodexCalendar = {
  yearName: "SR",
  months: [
    { name: "Frostfall", days: 30 },
    { name: "Emberfall", days: 30 }
  ],
  weekdays: ["Moonday", "Galeday"]
};
const day = (value: number): CodexInWorldDate => ({ year: 412, month: 1, day: value });
const gmCalendar = (current: number, published: number | null) => ({
  ...CALENDAR,
  currentDate: day(current),
  publishedDate: published === null ? null : day(published)
});

beforeEach(resetFakes);

describe("The date bar", () => {
  it("says a date with its weekday, or the day alone in a tight bar", () => {
    expect(worldDateLabel(CALENDAR, day(14))).toMatch(/^(Moonday|Galeday), Emberfall 14, 412 SR$/);
    expect(worldDateLabel(CALENDAR, day(14), true)).toBe("Emberfall 14");
  });

  it("gives the GM both dates, and Publish only once they differ", () => {
    const view = render(<DateBar calendar={gmCalendar(14, 14)} role="gm" token="gm" />);
    expect(screen.getByText("Your date")).toBeInTheDocument();
    expect(screen.getByText("Players' date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    view.unmount();

    render(<DateBar calendar={gmCalendar(15, 14)} role="gm" token="gm" />);
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("publishes the GM's date through the calendar route, and can hide the players' date again", async () => {
    const user = userEvent.setup();
    const onPublished = vi.fn();
    api.calendarApi.publish.mockResolvedValue({});
    api.calendarApi.unpublish.mockResolvedValue({});
    render(<DateBar calendar={gmCalendar(15, 14)} role="gm" token="gm" onPublished={onPublished} />);
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(api.calendarApi.publish).toHaveBeenCalledWith("gm"));
    await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Hide from players" }));
    await waitFor(() => expect(api.calendarApi.unpublish).toHaveBeenCalledWith("gm"));
  });

  it("offers nothing to hide before a date is published, and says when publishing failed", async () => {
    const user = userEvent.setup();
    api.calendarApi.publish.mockRejectedValue(new Error("The codex request failed (500)."));
    render(<DateBar calendar={gmCalendar(15, null)} role="gm" token="gm" />);
    expect(screen.getByText("No date yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide from players" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
  });

  it("gives a player Today alone, and nothing to press", () => {
    render(<DateBar calendar={{ ...CALENDAR, currentDate: day(14) }} role="player" token="player" />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.queryByText("Your date")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing without a calendar", () => {
    const { container } = render(<DateBar calendar={null} role="gm" token="gm" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("The dropdown", () => {
  it("opens its panel from the button, and the panel can close itself", async () => {
    const user = userEvent.setup();
    render(
      <Dropdown label="Visibility: All">
        {(close) => (
          <button type="button" onClick={close}>
            Hidden
          </button>
        )}
      </Dropdown>
    );
    const button = screen.getByRole("button", { name: "Visibility: All" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Hidden" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});

describe("What a reveal says about its links", () => {
  const PAGES = [
    { title: "Saltmere", revealedToPlayers: true },
    { title: "The Tidebound", revealedToPlayers: false }
  ];

  it("names the pages everyone can see and the Hidden ones players read as plain text", () => {
    expect(linksSentence("To [[Saltmere]] and the [[The Tidebound]].", PAGES)).toBe(
      "The links go to Saltmere, which everyone can already see. The Tidebound is Hidden, so players read that name as plain text."
    );
  });

  it("says nothing for a block with no links, and treats a page no one made as Hidden", () => {
    expect(linksSentence("No links here.", PAGES)).toBeNull();
    expect(linksSentence("[[Wren]] and [[Lena]] and [[Mira]]", PAGES)).toBe(
      "Wren, Lena and Mira are Hidden, so players read those names as plain text."
    );
  });

  it("stamps a block with the reveal that reached its current audience", () => {
    const stamp = {
      at: "2026-10-01T00:00:00.000Z",
      sessionId: null,
      sessionNumber: 6,
      inWorldDate: null,
      inWorldLabel: null
    };
    const shared = block({
      audience: "everyone",
      reveals: [
        { ...stamp, to: "a-lyra" },
        { ...stamp, sessionNumber: 7, to: "everyone" }
      ]
    });
    expect(stampOf(shared)?.sessionNumber).toBe(7);
    expect(
      stampOf(block({ audience: "characters", characterIds: ["a-lyra"], reveals: [{ ...stamp, to: "a-lyra" }] }))
        ?.sessionNumber
    ).toBe(6);
    expect(stampOf(block())).toBeNull();
  });
});
