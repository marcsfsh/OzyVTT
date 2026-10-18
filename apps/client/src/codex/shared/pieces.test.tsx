import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "@vtt/ui";
import userEvent from "@testing-library/user-event";

vi.mock("../api", async (actual) => (await import("../../../test/codex-fakes")).fakeApiModule(await actual()));

import type { CodexCalendar, CodexInWorldDate, GmCodexCalendar } from "@vtt/domain";
import { api, block, resetFakes } from "../../../test/codex-fakes";
import { DateBar } from "./DateBar";
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
const gmCalendar = (current: number, published: number | null): GmCodexCalendar => ({
  ...CALENDAR,
  eras: [],
  currentDate: day(current),
  publishedDate: published === null ? null : day(published)
});

beforeEach(resetFakes);

describe("The date bar", () => {
  const bar = () => within(screen.getByRole("group", { name: "The two dates" }));
  const gmBar = (current: number, published: number | null, onChanged = vi.fn()) =>
    render(
      <ToastProvider>
        <DateBar role="gm" token="gm" calendar={gmCalendar(current, published)} onChanged={onChanged} />
      </ToastProvider>
    );

  it("gives the GM both dates, and Publish only once they differ", () => {
    const view = gmBar(14, 14);
    expect(bar().getByText("Yours")).toBeInTheDocument();
    expect(bar().getByText("Players")).toBeInTheDocument();
    expect(bar().getByRole("button", { name: "Publish" })).toBeDisabled();
    view.unmount();

    gmBar(15, 14);
    expect(bar().getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("publishes the GM's date through the calendar route, and can hide the players' date again", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    api.calendarApi.publish.mockResolvedValue({});
    api.calendarApi.unpublish.mockResolvedValue({});
    gmBar(15, 14, onChanged);
    await user.click(bar().getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(api.calendarApi.publish).toHaveBeenCalledWith("gm"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    await user.click(bar().getByRole("button", { name: "Hide the date from players" }));
    await waitFor(() => expect(api.calendarApi.unpublish).toHaveBeenCalledWith("gm"));
  });

  it("offers nothing to hide before a date is published, and says when publishing failed", async () => {
    const user = userEvent.setup();
    api.calendarApi.publish.mockRejectedValue(new Error("The codex request failed (500)."));
    gmBar(15, null);
    expect(bar().getByText("Not shared yet")).toBeInTheDocument();
    expect(bar().queryByRole("button", { name: "Hide the date from players" })).not.toBeInTheDocument();
    await user.click(bar().getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
  });

  it("gives a player Today alone, the day without the year in a tight bar, and nothing to press", () => {
    const view = render(<DateBar role="player" calendar={{ ...CALENDAR, currentDate: day(14) }} />);
    expect(screen.getByRole("group", { name: "Today" })).toHaveTextContent("Emberfall 14, 412 SR");
    expect(screen.queryByText("Yours")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.unmount();

    render(<DateBar role="player" calendar={{ ...CALENDAR, currentDate: day(14) }} tight />);
    expect(screen.getByRole("group", { name: "Today" })).toHaveTextContent(/^TodayEmberfall 14$/);
  });

  it("tells a player when no date has been shared", () => {
    render(<DateBar role="player" calendar={null} />);
    expect(screen.getByRole("group", { name: "Today" })).toHaveTextContent("Not shared yet");
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
