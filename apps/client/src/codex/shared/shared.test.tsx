import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EVERYONE, HIDDEN, type Audience } from "@vtt/ui";
import { HiddenBlock } from "./HiddenBlock";
import { RevealPanel } from "./RevealPanel";
import { PagePicker } from "./PagePicker";

const PARTY = [
  { id: "lyra", name: "Lyra Emberwise" },
  { id: "borin", name: "Borin Stoneguard" },
  { id: "mirena", name: "Mirena Dawnbright" }
];
const LYRA: Audience = { audience: "characters", characterIds: ["lyra"] };

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
