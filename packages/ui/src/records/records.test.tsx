import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { EVERYONE, HIDDEN, audienceLabel, revealedLabel, sinceLabel, toggleCharacter, type Audience } from "./audience";
import { AudienceChip, FieldAudienceToggle, WhoSeesItMenu, WhoSeesItSwitch } from "./WhoSeesIt";
import { FilterChips, FilterFlyout, FiltersButton } from "./FilterFlyout";
import { Dropdown } from "./Dropdown";

// The record surfaces' pieces: who sees a record, and a list's filters and dropdowns.

const PARTY = [
  { id: "lyra", name: "Lyra Emberwise" },
  { id: "borin", name: "Borin Stoneguard" },
  { id: "mirena", name: "Mirena Dawnbright" }
];
const LYRA: Audience = { audience: "characters", characterIds: ["lyra"] };

describe("The audience words", () => {
  it("names Everyone, Hidden and the chosen characters", () => {
    expect(audienceLabel(EVERYONE, PARTY)).toBe("Everyone");
    expect(audienceLabel(HIDDEN, PARTY)).toBe("Hidden");
    expect(audienceLabel(LYRA, PARTY)).toBe("Lyra Emberwise");
    expect(audienceLabel({ audience: "characters", characterIds: ["lyra", "borin"] }, PARTY)).toBe(
      "Lyra Emberwise and Borin Stoneguard"
    );
    expect(audienceLabel({ audience: "characters", characterIds: ["lyra", "borin", "mirena"] }, PARTY)).toBe(
      "3 characters"
    );
  });

  it("says who a revealed thing is revealed to", () => {
    expect(revealedLabel(EVERYONE, PARTY)).toBe("Revealed to everyone");
    expect(revealedLabel(LYRA, PARTY)).toBe("Revealed to Lyra Emberwise");
    expect(revealedLabel(HIDDEN, PARTY)).toBe("Hidden");
  });

  it("adds a character, then hides the thing again once the last is removed", () => {
    const one = toggleCharacter(HIDDEN, "lyra");
    expect(one).toEqual(LYRA);
    expect(toggleCharacter(one, "borin")).toEqual({ audience: "characters", characterIds: ["lyra", "borin"] });
    expect(toggleCharacter(one, "lyra")).toEqual(HIDDEN);
    // From Everyone, a character narrows it to that character.
    expect(toggleCharacter(EVERYONE, "borin")).toEqual({ audience: "characters", characterIds: ["borin"] });
  });

  it("writes a stamp with the players' date and the session", () => {
    expect(sinceLabel({ inWorldLabel: "Emberfall 14", sessionNumber: 6, at: "2026-10-17T20:00:00.000Z" })).toBe(
      "Since Emberfall 14, session 6"
    );
    expect(sinceLabel({ inWorldLabel: null, sessionNumber: 6, at: "2026-10-17T20:00:00.000Z" })).toBe(
      "Since session 6"
    );
    expect(sinceLabel(null)).toBeNull();
  });
});

describe("Who sees it", () => {
  it("shows a chip in words, with Hidden marked apart", () => {
    render(
      <>
        <AudienceChip value={HIDDEN} party={PARTY} />
        <AudienceChip value={LYRA} party={PARTY} />
      </>
    );
    expect(screen.getByText("Hidden")).toHaveClass("nh-aud", "is-hidden");
    expect(screen.getByText("Lyra Emberwise")).toHaveClass("nh-aud", "is-characters");
  });

  it("offers Everyone, Hidden and each character, and hands back the new audience", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WhoSeesItMenu value={HIDDEN} party={PARTY} onChange={onChange} what="The debt" />);
    await user.click(screen.getByLabelText("Who sees The debt: Hidden"));
    const items = [...screen.getByRole("menu").querySelectorAll("[role^='menuitem']")].map((item) => item.textContent);
    expect(items).toEqual(["Everyone", "Hidden", "Lyra Emberwise", "Borin Stoneguard", "Mirena Dawnbright"]);
    expect(screen.getByRole("menuitemradio", { name: "Hidden" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("menuitemcheckbox", { name: "Borin Stoneguard" }));
    expect(onChange).toHaveBeenLastCalledWith({ audience: "characters", characterIds: ["borin"] });
  });

  it("does not write when the choice is the one already set", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WhoSeesItMenu value={EVERYONE} party={PARTY} onChange={onChange} what="The debt" />);
    await user.click(screen.getByLabelText("Who sees The debt: Everyone"));
    await user.click(screen.getByRole("menuitemradio", { name: "Everyone" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sets a whole record's audience inline, with who it reaches said under the switch", async () => {
    const user = userEvent.setup();
    function Record() {
      const [value, setValue] = useState<Audience>(HIDDEN);
      return <WhoSeesItSwitch value={value} party={PARTY} onChange={setValue} what="Brine Burst" />;
    }
    render(<Record />);
    const group = within(screen.getByRole("group", { name: "Who sees Brine Burst" }));
    expect(group.getByRole("button", { name: "Hidden" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Hidden");
    await user.click(group.getByLabelText("Who sees Brine Burst: choose characters"));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Lyra Emberwise" }));
    expect(screen.getByRole("status")).toHaveTextContent("Revealed to Lyra Emberwise");
    await user.click(group.getByRole("button", { name: "Everyone" }));
    expect(screen.getByRole("status")).toHaveTextContent("Revealed to everyone");
  });

  it("keeps a record that cannot be shown at its audience, and says why under the switch", () => {
    render(
      <WhoSeesItSwitch
        value={HIDDEN}
        party={PARTY}
        onChange={vi.fn()}
        what="Lantern Bearer"
        disabledReason="Publish it before you share it."
      />
    );
    const group = within(screen.getByRole("group", { name: "Who sees Lantern Bearer" }));
    for (const name of ["Hidden", "Everyone", "Characters"]) expect(group.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Publish it before you share it.");
  });

  it("toggles a field between Everyone and Hidden, with the word under the switch", async () => {
    const user = userEvent.setup();
    function Field() {
      const [hidden, setHidden] = useState(false);
      return <FieldAudienceToggle hidden={hidden} onChange={setHidden} field="True owner" />;
    }
    render(<Field />);
    const toggle = screen.getByRole("switch", { name: "Who sees True owner: Everyone" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Everyone")).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByRole("switch", { name: "Who sees True owner: Hidden" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });
});

describe("The filter flyout", () => {
  function Quests() {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<readonly string[]>(["active"]);
    return (
      <div style={{ position: "relative" }}>
        <FiltersButton open={open} onToggle={() => setOpen((value) => !value)} controls="quest-filters" />
        <FilterFlyout id="quest-filters" open={open} title="Quests" onClose={() => setOpen(false)}>
          <FilterChips
            label="Status"
            options={[
              { value: "active", label: "Active" },
              { value: "done", label: "Done" }
            ]}
            selected={status}
            onChange={setStatus}
          />
        </FilterFlyout>
      </div>
    );
  }

  it("names its Close button after what it holds", () => {
    render(
      <FilterFlyout id="spells" open title="Spells" closeLabel="Close the table" onClose={vi.fn()}>
        <p>Rows</p>
      </FilterFlyout>
    );
    expect(screen.getByRole("button", { name: "Close the table" })).toBeInTheDocument();
  });

  it("opens from Filters and closes with Close, out of the way", async () => {
    const user = userEvent.setup();
    render(<Quests />);
    expect(screen.queryByRole("complementary", { name: "Quests" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "true");
    const flyout = within(screen.getByRole("complementary", { name: "Quests" }));
    expect(flyout.getByRole("heading", { name: "Quests" })).toBeInTheDocument();
    await user.click(flyout.getByRole("button", { name: "Close filters" }));
    expect(screen.queryByRole("complementary", { name: "Quests" })).not.toBeInTheDocument();
  });

  it("closes on Escape and hands focus back to Filters", async () => {
    const user = userEvent.setup();
    render(<Quests />);
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Quests" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters" })).toHaveFocus();
  });

  it("switches each chip on and off on its own", async () => {
    const user = userEvent.setup();
    render(<Quests />);
    await user.click(screen.getByRole("button", { name: "Filters" }));
    const status = within(screen.getByRole("group", { name: "Status" }));
    expect(status.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");
    await user.click(status.getByRole("button", { name: "Done" }));
    await user.click(status.getByRole("button", { name: "Active" }));
    expect(status.getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "true");
    expect(status.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "false");
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
