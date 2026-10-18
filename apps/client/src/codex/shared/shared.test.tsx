import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { EVERYONE, HIDDEN, audienceLabel, revealedLabel, sinceLabel, toggleCharacter, type Audience } from "./audience";
import { AudienceChip, FieldAudienceToggle, WhoSeesItMenu, WhoSeesItSwitch } from "./WhoSeesIt";
import { HiddenBlock } from "./HiddenBlock";
import { RevealPanel } from "./RevealPanel";
import { FilterChips, FilterFlyout, FiltersButton } from "./FilterFlyout";
import { PagePicker } from "./PagePicker";

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
    expect(screen.getByText("Hidden")).toHaveClass("cx-aud", "is-hidden");
    expect(screen.getByText("Lyra Emberwise")).toHaveClass("cx-aud", "is-characters");
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

describe("The hidden block", () => {
  it("is labelled Hidden with Reveal in its corner", async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    render(
      <HiddenBlock title="The debt" value={HIDDEN} party={PARTY} onReveal={onReveal} onHide={vi.fn()}>
        <p>Ysolde owes the Tidebound.</p>
      </HiddenBlock>
    );
    const block = within(screen.getByRole("region", { name: "The debt · Hidden" }));
    expect(block.getByRole("heading", { name: "The debt" })).toBeInTheDocument();
    expect(block.getByText("Hidden")).toBeInTheDocument();
    expect(block.queryByRole("button", { name: /Hide/ })).not.toBeInTheDocument();
    await user.click(block.getByRole("button", { name: "Reveal The debt" }));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it("says who it is revealed to and since when, with Hide again", async () => {
    const user = userEvent.setup();
    const onHide = vi.fn();
    render(
      <HiddenBlock
        title="Lena's letters"
        value={LYRA}
        party={PARTY}
        since="Since Emberfall 13, session 5"
        onReveal={vi.fn()}
        onHide={onHide}
      >
        <p>Lena wrote it.</p>
      </HiddenBlock>
    );
    const block = within(screen.getByRole("region", { name: "Lena's letters · Revealed to Lyra Emberwise" }));
    expect(block.getByText("Revealed to Lyra Emberwise")).toBeInTheDocument();
    expect(block.getByText("Since Emberfall 13, session 5")).toBeInTheDocument();
    expect(block.queryByRole("button", { name: /Reveal/ })).not.toBeInTheDocument();
    await user.click(block.getByRole("button", { name: "Hide Lena's letters again" }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("puts the Who sees it control at the top of a phone's card", async () => {
    const user = userEvent.setup();
    const onAudienceChange = vi.fn();
    render(
      <HiddenBlock title="The debt" value={HIDDEN} party={PARTY} menu onAudienceChange={onAudienceChange}>
        <p>Ysolde owes the Tidebound.</p>
      </HiddenBlock>
    );
    await user.click(screen.getByLabelText("Who sees The debt: Hidden"));
    await user.click(screen.getByRole("menuitemradio", { name: "Everyone" }));
    expect(onAudienceChange).toHaveBeenCalledWith(EVERYONE);
  });

  it("offers no action on a block still being written", () => {
    render(
      <HiddenBlock title="New block" value={HIDDEN} party={PARTY} draft onReveal={vi.fn()}>
        <p>Nessa ran signals.</p>
      </HiddenBlock>
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("The Reveal panel", () => {
  it("reveals to everyone by default, after showing what they will read", async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    render(
      <RevealPanel
        title="The debt"
        party={PARTY}
        preview={<p>Ysolde owes the Tidebound.</p>}
        links="The links go to Tidebound, which everyone can already see."
        onCancel={vi.fn()}
        onReveal={onReveal}
      />
    );
    const dialog = within(screen.getByRole("dialog", { name: "Reveal The debt" }));
    expect(dialog.getByText("Ysolde owes the Tidebound.")).toBeInTheDocument();
    expect(dialog.getByText(/The links go to Tidebound/)).toBeInTheDocument();
    expect(dialog.getByRole("radio", { name: "Everyone" })).toBeChecked();
    // A character is chosen only once Chosen characters is.
    expect(dialog.getByRole("checkbox", { name: "Lyra Emberwise" })).toBeDisabled();
    await user.click(dialog.getByRole("button", { name: "Reveal to everyone" }));
    expect(onReveal).toHaveBeenCalledWith(EVERYONE);
  });

  it("reveals to the chosen characters, and names them on the button", async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    render(<RevealPanel title="The debt" party={PARTY} preview={<p>Text</p>} onCancel={vi.fn()} onReveal={onReveal} />);
    const dialog = within(screen.getByRole("dialog", { name: "Reveal The debt" }));
    await user.click(dialog.getByRole("radio", { name: "Chosen characters" }));
    // Nobody chosen yet, so there is nothing to reveal to.
    expect(dialog.getByRole("button", { name: "Reveal" })).toBeDisabled();
    await user.click(dialog.getByRole("checkbox", { name: "Lyra Emberwise" }));
    await user.click(dialog.getByRole("button", { name: "Reveal to Lyra Emberwise" }));
    expect(onReveal).toHaveBeenCalledWith({ audience: "characters", characterIds: ["lyra"] });
  });

  it("writes nothing on Cancel", async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    const onCancel = vi.fn();
    render(<RevealPanel title={null} party={PARTY} preview={<p>Text</p>} onCancel={onCancel} onReveal={onReveal} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onReveal).not.toHaveBeenCalled();
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

describe("The page picker", () => {
  const PAGES = [
    { id: "tide", title: "Tidebound", entityType: "faction" as const },
    { id: "order", title: "Lantern Order", entityType: "faction" as const },
    { id: "hill", title: "Lantern Hill", entityType: "location" as const }
  ];

  it("names its choice, and finds a page by name with its kind beside it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PagePicker label="Centre on" pages={PAGES} value="tide" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Centre on: Tidebound" }));
    await user.type(screen.getByRole("combobox", { name: "Find a page" }), "lan");
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Lantern HillLocation", "Lantern OrderFaction"]);
    await user.click(screen.getByRole("option", { name: /Lantern Order/ }));
    expect(onChange).toHaveBeenCalledWith("order");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("picks with the keyboard and closes on Escape", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PagePicker label="Centre on" pages={PAGES} value={null} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Centre on: Choose a page" }));
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("order");
    await user.click(screen.getByRole("button", { name: /Centre on/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
