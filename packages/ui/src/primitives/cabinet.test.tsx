import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { avatarUrl } from "../avatars";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { Lamp, MoveLamp, StatusLamp } from "./Lamp";
import { LifeBar } from "./LifeBar";
import { Picture, Portrait } from "./Portrait";
import { SegmentedControl } from "./SegmentedControl";
import { Switch } from "./Switch";
import { Tag } from "./Tag";
import { ToastProvider, useToast } from "./Toast";
import { VcrCounter } from "./VcrCounter";

// The arcade cabinet's primitives (DESIGN.md, Components): what each says to assistive technology, which values it
// shows and never invents, and the structure that gives a small face its 44px hit area. jsdom does no layout, so the
// smoke suite measures the hit areas themselves.

describe("Tag", () => {
  it("prints its words in the tone's class", () => {
    render(<Tag tone="next">Next</Tag>);
    expect(screen.getByText("Next")).toHaveClass("nh-tag", "nh-tag--next");
  });
});

describe("Lamp", () => {
  it("shows a lit lamp's value and names its state", () => {
    render(<Lamp kind="action" lit label="Action" value="1 LEFT" />);
    const lamp = screen.getByRole("group", { name: "Action: 1 LEFT" });
    expect(lamp).toHaveClass("nh-lamp--action", "is-lit");
    expect(lamp).toHaveTextContent("1 LEFT");
  });

  it("shows -- unlit, with the reason in its name", () => {
    render(<Lamp kind="reaction" lit={false} label="Reaction" value="READY" unavailableReason="Used this round" />);
    const lamp = screen.getByRole("group", { name: "Reaction: Used this round" });
    expect(lamp).not.toHaveClass("is-lit");
    expect(lamp).toHaveTextContent("--");
    expect(lamp).not.toHaveTextContent("READY");
  });

  it("gauges movement one square per 5 ft, and keeps the feet exact past twelve squares", () => {
    const { container, rerender } = render(<MoveLamp feetLeft={15} speedFeet={30} />);
    expect(screen.getByRole("group", { name: "Move: 15 of 30 feet left" })).toHaveTextContent("15 FT");
    expect(container.querySelectorAll(".nh-lamp-square")).toHaveLength(6);
    expect(container.querySelectorAll(".nh-lamp-square.is-lit")).toHaveLength(3);
    rerender(<MoveLamp feetLeft={120} speedFeet={120} />);
    expect(container.querySelectorAll(".nh-lamp-square")).toHaveLength(12);
    expect(screen.getByRole("group", { name: "Move: 120 of 120 feet left" })).toHaveTextContent("120 FT");
    rerender(<MoveLamp feetLeft={0} speedFeet={30} />);
    expect(screen.getByRole("group", { name: "Move: 0 of 30 feet left" })).toHaveTextContent("--");
  });

  it("draws a status lamp as decoration, for the words beside it to name", () => {
    const { container } = render(<StatusLamp lit />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("LifeBar", () => {
  const segmentsOf = (container: HTMLElement) =>
    Number((container.querySelector(".nh-lifebar-well") as HTMLElement).style.getPropertyValue("--nh-segments"));

  it("announces exact hit points once, temporary hit points apart, with the segments hidden", () => {
    const { container } = render(<LifeBar hp={{ current: 14, maximum: 21, temporary: 5 }} />);
    const bar = screen.getByRole("img", { name: "14 of 21 hit points, 5 temporary" });
    expect(bar).toHaveTextContent("14/21 +5");
    expect(container.querySelector(".nh-lifebar-well")).toHaveAttribute("aria-hidden", "true");
    expect(segmentsOf(container)).toBe(11);
    expect((container.querySelector(".nh-lifebar-left") as HTMLElement).style.clipPath).toMatch(/inset\(0 33\.3/);
  });

  it("caps the segments at 22, keeps one, and survives a maximum of zero", () => {
    const { container, rerender } = render(<LifeBar hp={{ current: 90, maximum: 120 }} />);
    expect(segmentsOf(container)).toBe(22);
    rerender(<LifeBar hp={{ current: 1, maximum: 1 }} />);
    expect(segmentsOf(container)).toBe(1);
    rerender(<LifeBar hp={{ current: 0, maximum: 0 }} />);
    expect(screen.getByRole("img", { name: "0 of 0 hit points" })).toBeInTheDocument();
    expect((container.querySelector(".nh-lifebar-left") as HTMLElement).style.clipPath).toBe("inset(0 100% 0 0)");
  });

  it("shows a band's word and no numbers or segments", () => {
    const { container } = render(<LifeBar band={{ label: "Bloodied", band: "bloodied" }} />);
    expect(screen.getByText("Bloodied")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/\d/);
    expect(container.querySelector(".nh-lifebar-well")).toBeNull();
  });

  it("flashes the lost segments once when damage lands, and not when healed", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const { container, rerender } = render(<LifeBar hp={{ current: 20, maximum: 20 }} />);
    rerender(<LifeBar hp={{ current: 12, maximum: 20 }} />);
    expect(container.querySelector(".nh-lifebar")).toHaveClass("is-hit");
    act(() => vi.advanceTimersToNextFrame());
    act(() => vi.advanceTimersToNextFrame());
    expect(container.querySelector(".nh-lifebar")).not.toHaveClass("is-hit");
    rerender(<LifeBar hp={{ current: 18, maximum: 20 }} />);
    expect(container.querySelector(".nh-lifebar")).not.toHaveClass("is-hit");
    vi.useRealTimers();
  });
});

describe("VcrCounter", () => {
  it("reads PLAY and the round in a fight, STOP and dashes between fights", () => {
    const { rerender } = render(<VcrCounter round={3} />);
    expect(screen.getByRole("img", { name: "Round 3" })).toHaveTextContent("PLAYRND 03");
    rerender(<VcrCounter round={null} />);
    expect(screen.getByRole("img", { name: "No fight running" })).toHaveTextContent("STOPRND --");
  });
});

describe("Picture and Portrait", () => {
  it("shows the default avatar until the art loads, then the art", () => {
    const { container } = render(<Picture picture={{ src: "/art.png", fallback: "palm" }} />);
    const images = () => [...container.querySelectorAll("img")].map((image) => image.getAttribute("src"));
    expect(images()).toEqual([avatarUrl("palm"), "/art.png"]);
    fireEvent.load(container.querySelector(".nh-picture-art")!);
    expect(images()).toEqual(["/art.png"]);
  });

  it("keeps the default avatar when the art fails, with no broken image", () => {
    const { container } = render(<Picture picture={{ src: "/missing.png", fallback: "orbit" }} />);
    fireEvent.error(container.querySelector(".nh-picture-art")!);
    expect([...container.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual([
      avatarUrl("orbit")
    ]);
  });

  it("frames the side, wears the sun frame when acting, and names itself only when asked", () => {
    const { container, rerender } = render(<Portrait picture={{ fallback: "gem" }} frame="hostile" badge="GW2" />);
    const portrait = container.querySelector(".nh-portrait")!;
    expect(portrait).toHaveClass("nh-portrait--hostile");
    expect(portrait).toHaveAttribute("aria-hidden", "true");
    expect(portrait).toHaveTextContent("GW2");
    rerender(<Portrait picture={{ fallback: "gem" }} frame="hidden" now name="Goblin Boss" />);
    expect(screen.getByRole("img", { name: "Goblin Boss" })).toHaveClass("nh-portrait--hidden", "is-now");
  });
});

describe("Button", () => {
  it("offers the link variant as a button with its words", () => {
    render(<Button variant="link">Open map</Button>);
    expect(screen.getByRole("button", { name: "Open map" })).toHaveClass("nh-btn--link");
  });

  it("gives the section bar's 42px primary the hit-area layer", () => {
    render(
      <Button variant="primary" size="sm">
        Make live
      </Button>
    );
    expect(screen.getByRole("button", { name: "Make live" })).toHaveClass(
      "nh-btn--primary",
      "nh-btn--sm",
      "tap-target"
    );
  });
});

describe("Switch, SegmentedControl and Chip", () => {
  it("toggles a switch from the keyboard and says its state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Players roll their own initiative" />);
    const control = screen.getByRole("switch", { name: "Players roll their own initiative" });
    expect(control).toHaveAttribute("aria-checked", "false");
    control.focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("presses one segmented option at a time, each with the hit-area layer", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Initiative"
        value="each"
        onChange={onChange}
        options={[
          { value: "each", label: "Each rolls" },
          { value: "group", label: "One per group" }
        ]}
      />
    );
    const options = screen.getAllByRole("button");
    expect(options.map((option) => option.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    for (const option of options) expect(option).toHaveClass("tap-target");
    await user.click(screen.getByRole("button", { name: "One per group" }));
    expect(onChange).toHaveBeenCalledWith("group");
  });

  it("gives a pressable chip and a chip's remove control the hit-area layer", () => {
    render(
      <>
        <Chip pressed={false} onClick={() => {}}>
          Surprised
        </Chip>
        <Chip onRemove={() => {}} removeLabel="Remove the Undead filter">
          Undead
        </Chip>
      </>
    );
    expect(screen.getByRole("button", { name: "Surprised" })).toHaveClass("tap-target");
    expect(screen.getByRole("button", { name: "Remove the Undead filter" })).toHaveClass("tap-target");
  });
});

describe("Toast", () => {
  function Trigger({ undo }: Readonly<{ undo?: () => void }>) {
    const { toast } = useToast();
    return (
      <button type="button" onClick={() => toast("Scene saved", { tone: "success", undo })}>
        Save
      </button>
    );
  }

  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("says what happened under its kind's tag, politely, and goes after 5 seconds", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(screen.getByRole("status")).toHaveTextContent("DONEScene saved");
    act(() => vi.advanceTimersByTime(4900));
    expect(region).toHaveTextContent("Scene saved");
    act(() => vi.advanceTimersByTime(200));
    expect(region).not.toHaveTextContent("Scene saved");
  });

  it("holds still while the pointer or focus is on it", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const toast = screen.getByText("Scene saved").closest(".nh-toast")!;
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.pointerEnter(toast);
    act(() => vi.advanceTimersByTime(10_000));
    expect(toast).toBeInTheDocument();
    fireEvent.pointerLeave(toast);
    act(() => vi.advanceTimersByTime(1900));
    expect(screen.getByText("Scene saved")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("Scene saved")).toBeNull();
  });

  it("offers Undo when the action can be undone, and closes on it", () => {
    const undo = vi.fn();
    render(
      <ToastProvider>
        <Trigger undo={undo} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Scene saved")).toBeNull();
  });
});

describe("the hit-area floor in the stylesheets", () => {
  const css = ["Switch", "SegmentedControl", "Chip", "Button"]
    .map((name) => readFileSync(`${process.cwd()}/src/primitives/${name}.css`, "utf8"))
    .join("\n");

  it("makes the switch at least 44px tall around its 46 by 26 track", () => {
    expect(css).toMatch(/\.nh-switch \{\s*min-height: var\(--tap-min\);\s*min-width: 46px;/);
    expect(css).toMatch(/\.nh-switch-track \{[^}]*width: 46px;[^}]*height: 26px;/);
  });

  it("paints 44px options and chips on a touch screen", () => {
    expect(css).toMatch(/@media \(any-pointer: coarse\) \{\s*\.nh-segmented-option \{\s*min-height: var\(--tap-min\);/);
    expect(css).toMatch(
      /@media \(any-pointer: coarse\) \{\s*\.nh-chip--pressable,[^{]*\{\s*min-height: var\(--tap-min\);/
    );
  });

  it("makes a full-size icon button 44 by 44", () => {
    expect(css).toMatch(/\.nh-iconbtn \{[^}]*width: var\(--tap-min\);\s*height: var\(--tap-min\);/);
  });
});
