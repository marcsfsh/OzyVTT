import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CodexCalendar, CodexCalendarMove, GmCodexCalendar } from "@vtt/domain";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const calendar = vi.hoisted(() => ({
  get: vi.fn(),
  check: vi.fn(),
  set: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn()
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, calendarApi: { ...actual.calendarApi, ...calendar } };
});

import { ToastProvider } from "@vtt/ui";
import { CalendarPage, type CalendarPart } from "./CalendarPage";
import { DateBar } from "./shared/DateBar";
import { goTo } from "../../test/route";

const SAVED: GmCodexCalendar = {
  yearName: "DR",
  eras: [{ name: "Third Age", startYear: 1 }],
  months: [
    { name: "Hammer", days: 30 },
    { name: "Alturiak", days: 30 }
  ],
  weekdays: ["Sul", "Mol"],
  currentDate: { year: 1492, month: 1, day: 2 },
  publishedDate: null
};

/** The body the page last saved. */
const lastSaved = (): CodexCalendar => calendar.set.mock.calls.at(-1)?.[1] as CodexCalendar;

function renderPage(part: CalendarPart = "months", phone = false) {
  const onPart = vi.fn();
  const view = render(
    <ToastProvider>
      <CalendarPage gmToken="gm" phone={phone} part={part} onPart={onPart} onBack={vi.fn()} />
    </ToastProvider>
  );
  return { onPart, view };
}

beforeEach(() => {
  for (const fn of Object.values(calendar)) fn.mockReset();
  calendar.get.mockResolvedValue(SAVED);
  calendar.check.mockResolvedValue([]);
  calendar.set.mockImplementation(async (_token: string, body: CodexCalendar) => ({ ...SAVED, ...body }));
});

describe("The calendar page", () => {
  it("lists the parts at the side with their counts, and the chosen part lit", async () => {
    const { onPart } = renderPage();
    const parts = within(await screen.findByRole("group", { name: "Calendar" }));
    expect(parts.getByRole("button", { name: /Months/ })).toHaveTextContent("2");
    expect(parts.getByRole("button", { name: /Eras/ })).toHaveTextContent("1");
    expect(parts.getByRole("button", { name: /Weekdays/ })).toHaveTextContent("2");
    expect(parts.getByRole("button", { name: /Year suffix/ })).toHaveTextContent("DR");
    const dates = within(screen.getByRole("group", { name: "Dates" }));
    await userEvent.setup().click(dates.getByRole("button", { name: "Your date" }));
    expect(onPart).toHaveBeenCalledWith("yours");
  });

  it("adds a month and saves it as you go, after the check", async () => {
    const user = userEvent.setup();
    renderPage("months");
    expect(await screen.findByText("2 months · a year of 60 days")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add month" }));
    await user.clear(screen.getByLabelText("Month 3 length in days"));
    await user.type(screen.getByLabelText("Month 3 length in days"), "28");
    await waitFor(() => expect(calendar.set).toHaveBeenCalled(), { timeout: 3000 });
    expect(calendar.check).toHaveBeenCalled();
    expect(lastSaved().months).toEqual([
      { name: "Hammer", days: 30 },
      { name: "Alturiak", days: 30 },
      { name: "Month 3", days: 28 }
    ]);
    // The GM's date rides along unchanged.
    expect(lastSaved().currentDate).toEqual(SAVED.currentDate);
    expect(screen.getByText("3 months · a year of 88 days")).toBeInTheDocument();
  });

  it("edits the eras, the weekdays and the year suffix, each saved as you go", async () => {
    const user = userEvent.setup();
    const { view } = renderPage("eras");
    await user.click(await screen.findByRole("button", { name: "Add era" }));
    await user.type(screen.getByLabelText("Era 2 name"), "Fourth Age");
    await waitFor(() => expect(lastSaved()?.eras).toHaveLength(2), { timeout: 3000 });
    expect(lastSaved().eras?.[1]).toMatchObject({ name: "Fourth Age", startYear: 1492 });
    view.unmount();

    calendar.set.mockClear();
    const weekdays = renderPage("weekdays");
    await user.click(await screen.findByRole("button", { name: "Remove weekday 2" }));
    await waitFor(() => expect(lastSaved()?.weekdays).toEqual(["Sul"]), { timeout: 3000 });
    weekdays.view.unmount();

    calendar.set.mockClear();
    renderPage("suffix");
    const suffix = await screen.findByRole("textbox", { name: "Year suffix" });
    await user.clear(suffix);
    await user.type(suffix, "AE");
    await waitFor(() => expect(lastSaved()?.yearName).toBe("AE"), { timeout: 3000 });
  });

  it("waits under the rows when dates players can see would move, naming them, and saves only when told", async () => {
    const user = userEvent.setup();
    const moves: CodexCalendarMove[] = [
      {
        kind: "journal",
        id: "j1",
        title: "The duke's tax falls due.",
        before: "Alturiak 2, 1492 DR",
        after: "Alturiak 4, 1492 DR",
        unpasses: false
      }
    ];
    calendar.check.mockResolvedValue(moves);
    renderPage("months");
    await user.clear(await screen.findByLabelText("Month 1 length in days"));
    await user.type(screen.getByLabelText("Month 1 length in days"), "28");
    const warning = await screen.findByText("This moves dates players can see", {}, { timeout: 3000 });
    const alert = within(warning.closest<HTMLElement>("[role='alert'], .nh-alert") ?? document.body);
    expect(alert.getByText("The duke's tax falls due.")).toBeInTheDocument();
    expect(alert.getByText(/moves from Alturiak 2, 1492 DR to Alturiak 4, 1492 DR/)).toBeInTheDocument();
    expect(calendar.set).not.toHaveBeenCalled();

    await user.click(alert.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(calendar.set).toHaveBeenCalledTimes(1));
    expect(lastSaved().months[0]).toEqual({ name: "Hammer", days: 28 });
  });

  it("puts the rows back when the change is undone", async () => {
    const user = userEvent.setup();
    calendar.check.mockResolvedValue([
      { kind: "journal", id: "j1", title: "The tax.", before: "a", after: "b", unpasses: false }
    ]);
    renderPage("months");
    await user.click(await screen.findByRole("button", { name: "Remove month 2" }));
    await user.click(await screen.findByRole("button", { name: "Undo the change" }, { timeout: 3000 }));
    expect(screen.getByLabelText("Month 2 name")).toHaveValue("Alturiak");
    expect(calendar.set).not.toHaveBeenCalled();
  });

  it("keeps your date in its small dialog, and publishes it from Players' date", async () => {
    const user = userEvent.setup();
    const { view } = renderPage("yours");
    expect(await screen.findByText(/Alturiak 2/)).toHaveClass("cal-date");
    await user.click(screen.getByRole("button", { name: "Change your date" }));
    expect(screen.getByRole("dialog", { name: "Your date" })).toBeInTheDocument();
    view.unmount();

    calendar.publish.mockResolvedValue({ ...SAVED, publishedDate: SAVED.currentDate });
    renderPage("players");
    expect(await screen.findByText("Not shared yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish your date" }));
    await waitFor(() => expect(calendar.publish).toHaveBeenCalledWith("gm"));
    expect(await screen.findByRole("button", { name: /Hide the date from players/ })).toBeInTheDocument();
  });

  it("shows the parts as chips on a phone", async () => {
    renderPage("months", true);
    const chips = within(await screen.findByRole("group", { name: "Calendar parts" }));
    expect(chips.getByRole("button", { name: /Months/ })).toHaveAttribute("aria-pressed", "true");
    expect(chips.getAllByRole("button")).toHaveLength(6);
  });
});

describe("Edit calendar in the date bar", () => {
  it("opens the calendar's page", async () => {
    goTo("/codex/story");
    render(
      <ToastProvider>
        <DateBar role="gm" token="gm" calendar={SAVED} onChanged={vi.fn()} />
      </ToastProvider>
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Edit calendar" }));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/calendar"));
  });
});
