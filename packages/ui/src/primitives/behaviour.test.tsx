/**
 * Direct tests for `@vtt/ui` primitives whose contract is behavioural rather than visual.
 *
 * **Moved here from `apps/client/src/ui-primitives.test.tsx`**, unchanged assertion for assertion. It was
 * written in the client only because this package had no test script and no harness at all - only `check` -
 * so a primitive was otherwise exercised indirectly, through whichever feature happened to render it. That
 * is adequate for a Button and inadequate for a control whose defining property is something a feature test
 * would never assert. The package has its own suite now, so the tests live beside the code they describe.
 *
 * `Drawer` is exactly that case. The whole reason it is not built on `Modal` is that the session console
 * must stay usable *alongside* the Codex mode behind it: no top layer, no focus trap, no scroll lock, and
 * no swallowing of Escape meant for the surface still running. None of that is visible in a screenshot,
 * and all of it would be silently lost by a later "simplification" onto `<dialog>`. So it is asserted here.
 *
 * jsdom caveat (`test/setup.ts`): layout and pointer geometry are not real here, so the 44px tap floor is
 * NOT verifiable in this file and still wants a browser check.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Combobox } from "./Combobox";
import { Drawer } from "./Drawer";
import { MarkdownEditor, applyMarkdownFormat, wikiLinkContext } from "./MarkdownEditor";
import { TagInput } from "./TagInput";

describe("Drawer", () => {
  it("renders titled, closeable, non-modal, and inert while closed", async () => {
    const onClose = vi.fn();
    const { rerender, container } = render(
      <><button type="button">Outside</button><Drawer open={false} onClose={onClose} title="Session 14"><button type="button">Inside</button></Drawer></>
    );
    const panel = container.querySelector("aside")!;
    expect(panel.tagName).toBe("ASIDE");
    // Non-modal: never a <dialog>, so nothing can be in the top layer or focus-trapped.
    expect(container.querySelector("dialog")).toBeNull();
    expect(panel.className).not.toContain("is-open");
    // Closed but still mounted (so the slide plays both ways) - `inert` is what keeps its controls out of
    // the tab order and out of the accessibility tree while it is off-screen.
    expect(panel.hasAttribute("inert")).toBe(true);
    // …and `aria-hidden` says the same thing to engines that do not implement `inert` yet. Safe to pair
    // here precisely BECAUSE `inert` has already made the subtree unfocusable.
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    // Named by its own visible title without a caller-supplied label. Queried through the DOM rather
    // than by role, since the closed panel is (correctly) absent from the accessibility tree.
    expect(panel.getAttribute("aria-labelledby")).toBe(panel.querySelector("h2")!.id);

    rerender(<><button type="button">Outside</button><Drawer open onClose={onClose} title="Session 14"><button type="button">Inside</button></Drawer></>);
    expect(panel.className).toContain("is-open");
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(panel.hasAttribute("aria-hidden")).toBe(false);
    expect(screen.getByRole("heading", { name: "Session 14" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Escape closes, but only from inside. A global listener would eat Escape from the Codex mode still
    // running behind the drawer - which is the precise failure a non-modal panel invites.
    screen.getByRole("button", { name: "Inside" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    screen.getByRole("button", { name: "Outside" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("takes an explicit label and a side", () => {
    const { container } = render(
      <Drawer open onClose={() => {}} side="left" ariaLabel="Session console" title={<span>Session 14</span>}>body</Drawer>
    );
    const panel = container.querySelector("aside")!;
    expect(panel.className).toContain("nh-drawer--left");
    expect(panel.getAttribute("aria-label")).toBe("Session console");
    // An explicit label wins outright rather than being stacked with a generated one - two names on one
    // landmark is an ambiguity, not redundancy.
    expect(panel.hasAttribute("aria-labelledby")).toBe(false);
  });
});

/**
 * `MarkdownEditor` — **D13's headline capability, and it had no behavioural coverage of any kind.**
 *
 * "One editor everywhere" is what lets a GM's session prep link to their world: before D13 only the page
 * editor had the toolbar and the `[[` autocomplete, and typing `[[` in a session's prep did nothing at
 * all. The primitive is now mounted by every writing surface in the suite (page bodies, session prep and
 * recap, quest bodies, the journal composer, the downtime note) through one Codex wrapper — so a silent
 * regression here is a silent regression on all six at once, and until now nothing would have caught it.
 *
 * What is asserted is the autocomplete's whole loop (open on `[[`, filter as you type, keyboard and
 * mouse selection, the inserted text and its brackets, dismissal), the format helper's transformations,
 * and the Edit/View switch. What is NOT assertable here is caret POSITION after insertion — the component
 * restores it inside `requestAnimationFrame`, and jsdom's textarea has no layout — so the tests check the
 * resulting VALUE, which is the part a GM's document actually keeps.
 */
describe("MarkdownEditor — the [[ ]] autocomplete", () => {
  /**
   * `userEvent.type` reads `[` and `{` as the start of a key descriptor (`[Enter]`), so a literal
   * bracket has to be doubled. Doubling them here keeps every test below written in the text a GM
   * actually types — `[[val` — instead of in the escaping.
   */
  const typeText = (element: HTMLElement, text: string) =>
    userEvent.setup().type(element, text.replace(/[[{]/g, "$&$&"));

  const PAGES = [
    { id: "p1", label: "Vallaki" },
    { id: "p2", label: "Van Richten" },
    { id: "p3", label: "Castle Ravenloft" }
  ];
  const suggest = (query: string) =>
    PAGES.filter((page) => page.label.toLowerCase().includes(query.trim().toLowerCase()));

  /** A controlled host, because the editor is controlled — a stub `onChange` would freeze the value. */
  function Host({ initial = "", onValue }: Readonly<{ initial?: string; onValue?: (next: string) => void }>) {
    const [value, setValue] = useState(initial);
    return (
      <MarkdownEditor value={value} onChange={(next) => { setValue(next); onValue?.(next); }}
        ariaLabel="Prep for this session" suggest={suggest} placeholder="Beats, encounters…" />
    );
  }

  it("opens on [[, filters as you type, and Enter inserts a closed wiki-link", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const box = screen.getByLabelText("Prep for this session");

    // Nothing offered until the brackets are actually open.
    await user.type(box, "The party reaches ");
    expect(screen.queryByRole("listbox", { name: "Link to page" })).toBeNull();

    await typeText(box, "[[");
    const list = await screen.findByRole("listbox", { name: "Link to page" });
    expect(within(list).getAllByRole("option")).toHaveLength(3);

    await user.type(box, "val");
    await waitFor(() => expect(within(screen.getByRole("listbox", { name: "Link to page" })).getAllByRole("option")).toHaveLength(1));
    expect(screen.getByRole("option", { name: "Vallaki" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    // The typed fragment is REPLACED by the page's real title, and the link is closed — a half-open
    // `[[Vallaki` would persist as literal text and link nothing.
    expect(box).toHaveValue("The party reaches [[Vallaki]]");
    expect(screen.queryByRole("listbox", { name: "Link to page" })).toBeNull();
  });

  it("moves the selection with the arrow keys and inserts the highlighted page", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const box = screen.getByLabelText("Prep for this session");

    await typeText(box, "[[Va");
    await screen.findByRole("listbox", { name: "Link to page" });
    // Two match "Va"; the second is reached with one press down, and Tab commits like Enter.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "Van Richten" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("option", { name: "Vallaki" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}{Tab}");

    expect(box).toHaveValue("[[Van Richten]]");
  });

  it("inserts by click too, and never doubles an existing closing bracket", async () => {
    const user = userEvent.setup();
    render(<Host initial="[[]]" />);
    const box = screen.getByLabelText("Prep for this session") as HTMLTextAreaElement;

    // Caret between the pairs — what the toolbar's own wiki-link button leaves behind. Placed with the
    // DOM API and announced with `fireEvent`, because `userEvent.click` moves the caret itself and the
    // position is the whole input to this behaviour.
    box.focus();
    box.setSelectionRange(2, 2);
    fireEvent.click(box);
    await screen.findByRole("listbox", { name: "Link to page" });
    /**
     * The clickable element is the BUTTON inside the row: this list puts `role="option"` on the `<li>`
     * and the handler on a button within it, where `Combobox` puts the role on the button itself. Worth
     * knowing when reading the two side by side — clicking the row's `option` element does nothing.
     * `fireEvent` rather than `userEvent`, because userEvent moves focus off the textarea despite the
     * mousedown `preventDefault` the component uses precisely to keep it (a jsdom fidelity gap), and the
     * caret it would take with it is what decides where the link lands.
     */
    fireEvent.click(within(screen.getByRole("option", { name: "Castle Ravenloft" })).getByRole("button"));

    expect(box).toHaveValue("[[Castle Ravenloft]]");
  });

  it("closes on Escape without inserting, and stays closed once the brackets are broken", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const box = screen.getByLabelText("Prep for this session");

    await typeText(box, "[[val");
    await screen.findByRole("listbox", { name: "Link to page" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Link to page" })).toBeNull();
    expect(box).toHaveValue("[[val");

    // A newline inside the brackets is not a link in progress — the suggestion must not come back.
    await user.type(box, "{Enter}more");
    expect(screen.queryByRole("listbox", { name: "Link to page" })).toBeNull();
  });

  it("offers nothing when the caller supplies no suggester — the autocomplete is opt-in", async () => {
    const user = userEvent.setup();
    function Bare() {
      const [value, setValue] = useState("");
      return <MarkdownEditor value={value} onChange={setValue} ariaLabel="Recap" />;
    }
    render(<Bare />);

    await typeText(screen.getByLabelText("Recap"), "[[val");
    expect(screen.queryByRole("listbox", { name: "Link to page" })).toBeNull();
  });
});

describe("MarkdownEditor — the toolbar and the Edit/View switch", () => {
  it("wraps the selection, prefixes the line, and opens a wiki-link from the toolbar", async () => {
    const user = userEvent.setup();
    function Host() {
      const [value, setValue] = useState("hello world");
      return <MarkdownEditor value={value} onChange={setValue} ariaLabel="Body" />;
    }
    render(<Host />);
    const box = screen.getByLabelText("Body") as HTMLTextAreaElement;
    /**
     * The editor restores the caret inside `requestAnimationFrame`, so a selection set straight after a
     * click is overwritten a frame later. Each step waits for that frame before placing the next
     * selection — otherwise the test measures the race rather than the format.
     */
    const settle = () => act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });

    box.setSelectionRange(0, 5);
    await user.click(screen.getByRole("button", { name: "Bold" }));
    await settle();
    expect(box).toHaveValue("**hello** world");

    box.setSelectionRange(0, 0);
    await user.click(screen.getByRole("button", { name: "Heading" }));
    await settle();
    expect(box).toHaveValue("## **hello** world");

    box.setSelectionRange(3, 3);
    await user.click(screen.getByRole("button", { name: "Link to another page" }));
    await settle();
    expect(box).toHaveValue("## [[]]**hello** world");
  });

  it("is markdown-agnostic: the reader is the caller's, and there is no switch without one", async () => {
    const user = userEvent.setup();
    const renderPreview = vi.fn((markdown: string) => <p data-testid="reader">read: {markdown}</p>);
    function Host() {
      const [value, setValue] = useState("**bold**");
      return <MarkdownEditor value={value} onChange={setValue} ariaLabel="Body" renderPreview={renderPreview} />;
    }
    const view = render(<Host />);

    await user.click(screen.getByRole("button", { name: "View" }));
    // The primitive renders no markdown itself — that is what keeps the Codex's viewer-safe redlink
    // renderer and its GM-layer chrome out of the design system.
    expect(screen.getByTestId("reader")).toHaveTextContent("read: **bold**");
    expect(renderPreview).toHaveBeenCalledWith("**bold**");
    // Reading is not editing: the formatting toolbar is gone while the reader is up.
    expect(screen.queryByRole("toolbar", { name: "Formatting" })).toBeNull();

    view.unmount();
    function Bare() {
      const [value, setValue] = useState("");
      return <MarkdownEditor value={value} onChange={setValue} ariaLabel="Body" />;
    }
    render(<Bare />);
    // An editor with no reader offers no switch, rather than a switch onto a blank panel.
    expect(screen.queryByRole("group", { name: "Edit or read" })).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
  });

  it("shows the image control only when the caller can accept an upload", () => {
    const view = render(<MarkdownEditor value="" onChange={() => {}} ariaLabel="Body" />);
    expect(screen.queryByRole("button", { name: "Insert image" })).toBeNull();
    view.unmount();

    render(<MarkdownEditor value="" onChange={() => {}} ariaLabel="Body" onUploadImage={async () => "![x](codex-asset:1)"} />);
    expect(screen.getByRole("button", { name: "Insert image" })).toBeInTheDocument();
  });
});

describe("MarkdownEditor — the two pure helpers", () => {
  it("applyMarkdownFormat wraps, prefixes and inserts", () => {
    expect(applyMarkdownFormat("hello", 0, 5, "bold").value).toBe("**hello**");
    expect(applyMarkdownFormat("hello", 0, 5, "italic").value).toBe("*hello*");
    expect(applyMarkdownFormat("hello", 0, 5, "strike").value).toBe("~~hello~~");
    expect(applyMarkdownFormat("hello", 0, 5, "code").value).toBe("`hello`");
    // Line prefixes go to the start of the caret's OWN line, not the start of the document.
    expect(applyMarkdownFormat("one\ntwo", 5, 5, "bullet").value).toBe("one\n- two");
    expect(applyMarkdownFormat("one\ntwo", 5, 5, "quote").value).toBe("one\n> two");
    expect(applyMarkdownFormat("one\ntwo", 5, 5, "numbered").value).toBe("one\n1. two");
    expect(applyMarkdownFormat("ab", 1, 1, "rule").value).toBe("a\n---\nb");
    expect(applyMarkdownFormat("see X", 4, 5, "wikilink").value).toBe("see [[X]]");
    // An unknown mark changes nothing — a toolbar typo must not eat the document.
    expect(applyMarkdownFormat("hello", 0, 5, "nonsense").value).toBe("hello");
  });

  it("wikiLinkContext finds an OPEN [[ and refuses everything else", () => {
    expect(wikiLinkContext("go to [[val", 11)).toEqual({ start: 6, query: "val" });
    expect(wikiLinkContext("[[", 2)).toEqual({ start: 0, query: "" });
    // Already closed, so the caret is not inside a link in progress.
    expect(wikiLinkContext("[[Vallaki]] and more", 20)).toBeNull();
    // A newline ends the attempt, and a nested bracket is not a query.
    expect(wikiLinkContext("[[val\nmore", 10)).toBeNull();
    expect(wikiLinkContext("[[a[b", 5)).toBeNull();
    expect(wikiLinkContext("no brackets", 5)).toBeNull();
    // Only the text BEFORE the caret counts: typing in front of an old link opens nothing.
    expect(wikiLinkContext("[[Vallaki]]", 3)).toEqual({ start: 0, query: "V" });
  });
});

/**
 * `Combobox` — 8 call sites, zero behavioural coverage.
 *
 * It was promoted (D25) from two bespoke listboxes that had drifted into different keyboard behaviour and
 * different row heights, which is exactly the failure a shared primitive is supposed to end. It now
 * carries the Codex's tag filters, the downtime "who", the connection label and the character link — and
 * `allowFreeText` is the mode the downtime field depends on, where the id handed back is the raw text.
 */
describe("Combobox", () => {
  const OPTIONS = [
    { id: "p1", label: "Ireena", meta: "Character" },
    { id: "p2", label: "Ismark", meta: "Character" },
    { id: "p3", label: "Vallaki", meta: "Location" }
  ];

  it("filters as you type and returns the option's id, not its label", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Combobox options={OPTIONS} value={null} onChange={onChange} ariaLabel="Who spent the time" />);

    const input = screen.getByRole("combobox", { name: "Who spent the time" });
    await user.click(input);
    expect(screen.getAllByRole("option")).toHaveLength(3);

    await user.type(input, "ire");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    await user.click(screen.getByRole("option", { name: /Ireena/ }));

    expect(onChange).toHaveBeenCalledWith("p1");
  });

  it("keyboard-drives, and Enter takes the highlighted row", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Combobox options={OPTIONS} value={null} onChange={onChange} ariaLabel="Link to a character page" />);

    const input = screen.getByRole("combobox", { name: "Link to a character page" });
    await user.click(input);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("option", { name: /Vallaki/ })).toHaveAttribute("aria-selected", "true");
    // The walk stops at the ends rather than wrapping — a picker that wraps steals the last row.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Vallaki/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("p3");
  });

  it("renders a chosen value as a removable chip, and clearing hands back null", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Combobox options={OPTIONS} value="p2" onChange={onChange} ariaLabel="Who spent the time" />);

    // A chosen value is a CHIP, not typed text sitting in the box — the state is unambiguous.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Ismark")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear Ismark" }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("allowFreeText: text that matches no option comes back as itself, and renders as a chip", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(<Combobox options={OPTIONS} value={null} onChange={onChange} allowFreeText ariaLabel="Who spent the time" />);

    await user.type(screen.getByRole("combobox", { name: "Who spent the time" }), "Vex the Bold{Enter}");
    // D12's "who" is either a character page or a name the GM typed; this is the second case, and the
    // raw text is what the caller stores.
    expect(onChange).toHaveBeenCalledWith("Vex the Bold");

    view.rerender(<Combobox options={OPTIONS} value="Vex the Bold" onChange={onChange} allowFreeText ariaLabel="Who spent the time" />);
    expect(screen.getByText("Vex the Bold")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Vex the Bold" })).toBeInTheDocument();
  });

  it("allowFreeText: leaving the box keeps what was typed, and an exact label commits the id", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <>
        <Combobox options={OPTIONS} value={null} onChange={onChange} allowFreeText ariaLabel="Rarity" />
        <button type="button">elsewhere</button>
      </>
    );

    // The gesture people actually make: type, then move to the next field. Enter was the ONLY way to
    // commit, so an open-slug field rendered through this control silently kept nothing — with no
    // error, because nothing went wrong. That is worse than the bare text box it replaced.
    await user.type(screen.getByRole("combobox", { name: "Rarity" }), "unique");
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(onChange).toHaveBeenCalledWith("unique");

    // ...and text that IS an option's label commits the OPTION, so a picker in free-text mode cannot
    // store "Ireena" where `p1` belongs.
    onChange.mockClear();
    await user.type(screen.getByRole("combobox", { name: "Rarity" }), "ireena");
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(onChange).toHaveBeenCalledWith("p1");
  });

  it("without allowFreeText, unmatched text is not a value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Combobox options={OPTIONS} value={null} onChange={onChange} ariaLabel="Filter by tag" />);

    await user.type(screen.getByRole("combobox", { name: "Filter by tag" }), "nothing matches{Enter}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("caps the rows it shows — a picker is a picker, not a list view", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 20 }, (_, index) => ({ id: `t${index}`, label: `tag-${index}` }));
    render(<Combobox options={many} value={null} onChange={vi.fn()} ariaLabel="Filter by tag" limit={3} />);

    await user.click(screen.getByRole("combobox", { name: "Filter by tag" }));
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("closes on Escape and reports its expanded state honestly", async () => {
    const user = userEvent.setup();
    render(<Combobox options={OPTIONS} value={null} onChange={vi.fn()} ariaLabel="Filter by tag" />);

    const input = screen.getByRole("combobox", { name: "Filter by tag" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says nothing is expanded when nothing matches, rather than claiming an empty list", async () => {
    const user = userEvent.setup();
    render(<Combobox options={OPTIONS} value={null} onChange={vi.fn()} ariaLabel="Filter by tag" />);

    const input = screen.getByRole("combobox", { name: "Filter by tag" });
    await user.type(input, "zzz");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("reopens on a tap even when it never lost focus — the multi-value case", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Combobox options={OPTIONS} value={null} onChange={onChange} ariaLabel="Filter by tag" />);

    const input = screen.getByRole("combobox", { name: "Filter by tag" });
    await user.click(input);
    await user.click(screen.getByRole("option", { name: /Ireena/ }));
    expect(onChange).toHaveBeenCalledWith("p1");
    expect(input).toHaveAttribute("aria-expanded", "false");

    // The option's `onMouseDown` preventDefault deliberately leaves focus on the input, so `onFocus`
    // can never fire again — and a caller that keeps `value` at null (a `TagInput` collecting several)
    // stays mounted on this very input. Without the click handler the next tap did nothing at all,
    // which is precisely the "there is no list here" defect the visible list exists to end.
    await user.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
  });
});

/**
 * `TagInput` in `pick` mode — the multi-value half of the client's `3a`/`3d` report.
 *
 * The single-value repair (`Combobox` behind `FieldDef.pick`) landed first and covered one field.
 * Six of the nine damage-type sites are LISTS, and a list rendered its vocabulary into a `<datalist>`:
 * no arrow, no cue, and nothing at all on iOS Safari. So the same chooser became this control's entry
 * box, opt-in, because `suggestions` means two different things at two kinds of call site — a
 * canonical vocabulary a GM should be choosing from, versus a corpus of tags that already exist, where
 * the normal act is to type a new one and a menu of prior tags would be a wall.
 */
describe("TagInput", () => {
  const TYPES = ["acid", "cold", "fire", "lightning"];

  it("without `pick` it is the datalist it always was — no listbox, no menu", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<TagInput values={[]} onChange={onChange} suggestions={TYPES} ariaLabel="Damage resistances" />);

    // The Codex's tag fields are this call, and they must stay this call: their suggestions are every
    // tag the campaign already uses, which is a hint, not a set to choose from.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(container.querySelector("datalist")).not.toBeNull();
    await user.type(screen.getByLabelText("Damage resistances"), "fire{Enter}");
    expect(onChange).toHaveBeenCalledWith(["fire"]);
  });

  it("with `pick` the whole list is on screen, by its printed name, before anything is typed", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TagInput values={[]} onChange={vi.fn()} suggestions={TYPES} pick optionLabel={(value) => value.toUpperCase()} ariaLabel="Damage resistances" />
    );

    await user.click(screen.getByRole("combobox", { name: "Damage resistances" }));
    expect(within(screen.getByRole("listbox", { name: "Damage resistances" })).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["ACID", "COLD", "FIRE", "LIGHTNING"]);
    // The invisible half is GONE rather than merely supplemented — two lists over one field is two
    // things to keep in step.
    expect(container.querySelector("datalist")).toBeNull();
  });

  it("with `pick` it still takes a word the list has never heard of, normalised the same way", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput values={["fire"]} onChange={onChange} suggestions={TYPES} pick ariaLabel="Damage resistances" />);

    // The open half. `slugify` is the primitive's own normalizer and it runs on the picked path and
    // the typed path alike, so "Void Fire" cannot become a second spelling of anything.
    await user.type(screen.getByRole("combobox", { name: "Damage resistances" }), "Void Fire{Enter}");
    expect(onChange).toHaveBeenCalledWith(["fire", "void-fire"]);
  });

  it("with `pick`, what is already chosen leaves the menu — and the chip keeps its ✕", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput values={["fire"]} onChange={onChange} suggestions={TYPES} pick ariaLabel="Damage resistances" />);

    await user.click(screen.getByRole("combobox", { name: "Damage resistances" }));
    const shown = within(screen.getByRole("listbox", { name: "Damage resistances" })).getAllByRole("option").map((option) => option.textContent);
    expect(shown).toEqual(["acid", "cold", "lightning"]);

    // Removal is the chip's ✕ in both modes, which matters because `pick` gives up Backspace-on-empty:
    // the entry box is `Combobox`'s and its keyboard belongs to the listbox.
    await user.click(screen.getByRole("button", { name: "Remove fire" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("`pick` with no list falls back to the plain box rather than a chooser over nothing", () => {
    render(<TagInput values={[]} onChange={vi.fn()} suggestions={[]} pick ariaLabel="Which languages" />);

    // "Show the list when there is one" — the sentence a caller that sets `pick` for a whole control
    // (`GrantsEditor`, where the vocabulary changes with the row's kind) needs to stay true.
    expect(screen.queryByRole("combobox", { name: "Which languages" })).toBeNull();
    expect(screen.getByLabelText("Which languages")).toBeInTheDocument();
  });
});
