import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { d20s, natural, rollLands } from "../dice/rollLight";
import { WaitNote } from "../encounter/WaitNote";
import { announceAttack, takeCritical, useAttackLight } from "./attackLight";
import { useDamageNumbers, type SeenHealth } from "./damageNumbers";

/** jsdom has no Web Animations API; this records which elements were animated, so the light runs. */
function stubAnimate(): Element[] {
  const animated: Element[] = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element) {
      animated.push(this);
      const finished = new Promise<Animation>(() => {});
      return { finished, cancel: () => {} } as unknown as Animation;
    }
  });
  return animated;
}

/** jsdom lays nothing out: each token is a 50px square, the second 200px to the right of the first. */
function giveBoxes() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const left = this.getAttribute("data-token-id") === "b" ? 300 : this.hasAttribute("data-token-id") ? 100 : 0;
    const size = this.hasAttribute("data-token-id") ? 50 : 600;
    return {
      left,
      top: 100,
      right: left + size,
      bottom: 100 + size,
      width: size,
      height: size,
      x: left,
      y: 100
    } as DOMRect;
  });
}

afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
  vi.restoreAllMocks();
});

const parts = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
/** Damage waits a beat for the attack that dealt it before it rises. */
const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 80)));

function Stage({ health }: Readonly<{ health: ReadonlyMap<string, SeenHealth> }>) {
  const stage = useRef<HTMLDivElement>(null);
  useAttackLight(stage);
  useDamageNumbers(stage, health);
  return (
    <div ref={stage}>
      <svg>
        <g data-token-id="a" />
        <g data-token-id="b" />
      </svg>
    </div>
  );
}

const exact = (points: number): SeenHealth => ({ kind: "exact", points });
const band = (value: "healthy" | "bloodied" | "down"): SeenHealth => ({ kind: "band", band: value });

describe("damage on the map", () => {
  beforeEach(() => {
    stubAnimate();
    giveBoxes();
  });

  it("raises the hit points lost from a token whose exact hit points this viewer holds", async () => {
    const { rerender } = render(<Stage health={new Map([["b", exact(30)]])} />);
    rerender(<Stage health={new Map([["b", exact(21)]])} />);
    await settle();
    expect(parts(".lr-damage").map((part) => part.textContent)).toEqual(["9"]);
    expect(parts(".lr-pop.lr-red")).toHaveLength(1);
  });

  it("bursts with no number on a creature this viewer sees only as a band", async () => {
    const { rerender } = render(<Stage health={new Map([["b", band("healthy")]])} />);
    rerender(<Stage health={new Map([["b", band("bloodied")]])} />);
    await settle();
    expect(parts(".lr-damage")).toHaveLength(0);
    expect(parts(".lr-pop.lr-red")).toHaveLength(1);
  });

  it("shows nothing for healing", async () => {
    const { rerender } = render(<Stage health={new Map([["b", exact(10)]])} />);
    rerender(<Stage health={new Map([["b", exact(16)]])} />);
    await settle();
    expect(parts(".lr-part")).toHaveLength(0);
  });

  it("lands the number larger after a critical hit this device saw, after its burst", async () => {
    const { rerender } = render(<Stage health={new Map([["b", exact(30)]])} />);
    rerender(<Stage health={new Map([["b", exact(12)]])} />);
    announceAttack({}, { attackerId: "a", targetId: "b", outcome: "crit" });
    await settle();
    expect(parts(".lr-damage.is-critical")).toHaveLength(1);
    // The attack's own gold pop is the burst: the damage adds no red one of its own.
    expect(parts(".lr-pop.lr-red")).toHaveLength(0);
    expect(takeCritical("b")).toBe(false);
  });
});

describe("an attack on the map", () => {
  beforeEach(() => {
    stubAnimate();
    giveBoxes();
  });

  it("runs from the attacker to the target and bursts there on a hit", () => {
    render(<Stage health={new Map()} />);
    announceAttack({}, { attackerId: "a", targetId: "b", outcome: "hit" });
    expect(parts(".lr-track > .lr-comet")).toHaveLength(1);
    expect(parts(".lr-pop")).toHaveLength(1);
  });

  it("runs out short and shows MISS on a miss", () => {
    render(<Stage health={new Map()} />);
    announceAttack({}, { attackerId: "a", targetId: "b", outcome: "miss" });
    expect(parts(".lr-miss").map((part) => part.textContent)).toEqual(["MISS"]);
    expect(parts(".lr-pop")).toHaveLength(0);
  });

  it("lights each result once", () => {
    render(<Stage health={new Map()} />);
    const result = {};
    expect(announceAttack(result, { attackerId: "a", targetId: "b", outcome: "hit" })).toBe(true);
    expect(announceAttack(result, { attackerId: "a", targetId: "b", outcome: "hit" })).toBe(false);
  });
});

describe("a roll landing", () => {
  const card = () => {
    document.body.innerHTML = `<article class="card"><span class="die">20</span><span class="die">7</span>
      <strong class="total">25</strong><span class="nat">NAT 20</span></article>`;
    return document.querySelector<HTMLElement>(".card")!;
  };
  const PARTS = { dice: ".die", total: ".total", nat: ".nat" };

  it("reads the kept and the dropped d20, and the natural", () => {
    const dice = [
      { sides: 20, face: 20, kept: true },
      { sides: 20, face: 7, kept: false }
    ];
    expect(d20s(dice)).toEqual({ kept: 0, dropped: 1 });
    expect(natural(dice)).toBe("NAT 20");
    expect(natural([{ sides: 6, face: 1, kept: true }])).toBeNull();
  });

  it("flashes and lands gold on a natural 20", () => {
    stubAnimate();
    rollLands(card(), [{ sides: 20, face: 20, kept: true }], 25, PARTS);
    expect(parts(".lr-flash")).toHaveLength(1);
    expect(parts(".lr-burst.lr-gold")).toHaveLength(1);
  });

  it("sends the light back to the die on a natural 1", () => {
    stubAnimate();
    rollLands(card(), [{ sides: 20, face: 1, kept: true }], 6, PARTS);
    expect(parts(".lr-comet.lr-red")).toHaveLength(1);
    expect(parts(".lr-flash")).toHaveLength(0);
  });

  it("runs from the dropped die to the kept one with two d20s", () => {
    const animated = stubAnimate();
    rollLands(
      card(),
      [
        { sides: 20, face: 7, kept: false },
        { sides: 20, face: 15, kept: true }
      ],
      20,
      PARTS
    );
    expect(animated).toContain(document.querySelectorAll(".die")[0]);
  });
});

describe("a wait", () => {
  it("sits still while it waits, then lights and reads Done", () => {
    const animated = stubAnimate();
    const { rerender, container } = render(
      <WaitNote waiting done="Answered.">
        Waiting.
      </WaitNote>
    );
    expect(animated).toHaveLength(0);
    expect(container.textContent).toContain("Wait");
    rerender(
      <WaitNote waiting={false} done="Answered.">
        Waiting.
      </WaitNote>
    );
    expect(container.textContent).toContain("Done");
    expect(container.querySelectorAll(".lr-comet")).toHaveLength(1);
  });
});
