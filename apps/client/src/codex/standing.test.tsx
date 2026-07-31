import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const setStanding = vi.fn();
const revealStanding = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    standingApi: { ...actual.standingApi, set: (...a: unknown[]) => setStanding(...a), reveal: (...a: unknown[]) => revealStanding(...a) }
  };
});

import { CampaignHome, type CampaignStanding } from "./CampaignHome";
import { StandingAdjuster } from "./StandingAdjuster";
import {
  CHRONICLE_KIND_META, STANDING_MAX, STANDING_METER_MAX, STANDING_MIN, STANDING_TIERS,
  clampStanding, milestoneOf, milestoneSummaryLabel, standingChangeLabel, standingLabel,
  standingMeterValue, standingOf, standingTier, standingValueLabel, downtimeOf, chronicleRowSummary } from "./chronicle";
import { CODEX_ICONS } from "./icons";
import type { CodexChronicleRecord, CodexStanding } from "./api";

/**
 * M12 / CT-6 — faction standing on the client, plus the two new chronicle kinds M12 adds beside it.
 *
 * What each group here is actually for, stated so a later reader does not soften it:
 *  - **The tier ladder** is a READING RULE with seven bands and hard edges, which is the class of code
 *    that goes wrong by one at a boundary. So the boundaries are asserted by value, not by sampling the
 *    middle of each band, and the whole −100…+100 range is walked to prove the bands are exhaustive and
 *    non-overlapping — a rule that silently left a gap would otherwise pass every spot check.
 *  - **F-6** is the constraint the whole card is built around: `Meter` clamps to 0…1 and cannot draw a
 *    negative. The mapping is asserted at both ends and in the middle, and the primitive's own
 *    `value/max` readout is asserted ABSENT — passing a `label` would put "140/200" on a GM's screen.
 *  - **R2** — the tier reads by WORD. The colour assertion is the accessibility rule and the one a
 *    "tidy-up" would break by dropping the badge as redundant; the icon-registry test is its quiet half,
 *    because `iconChildren` falls back to `pin` for an unknown id and nothing would ever say so.
 *  - **The reason is the record.** A standing that moved without the chronicle saying why is the state
 *    CT-6 exists to prevent, so the control refuses to arm without one.
 */

const STANDING = (value: number, revealed = false): CodexStanding => ({
  id: "s1", factionPageId: "f1", value, revealedToPlayers: revealed,
  createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z"
});

const CARD = (value: number, name = "The Zhentarim"): CampaignStanding => ({ factionPageId: "f1", name, value });

const renderCard = (standing: readonly CampaignStanding[], onAdjustStanding?: (id: string) => void) =>
  render(<CampaignHome pages={[]} standing={standing} onAdjustStanding={onAdjustStanding}
    onPickType={vi.fn()} onPickTag={vi.fn()} onOpenPage={vi.fn()} onOpenEntry={vi.fn()} onOpenMap={vi.fn()} />);

const meterWidth = () => (document.querySelector(".nh-meter-fill") as HTMLElement).style.width;

describe("The seven tiers are a reading rule with hard edges (CT-6 / M12-B)", () => {
  it("every tier is reachable, and each named boundary lands on the side it should", () => {
    // The owner's ladder, worst to best. If a tier here became unreachable the campaign would simply
    // never be able to say that word, and no boundary test alone would notice.
    expect(STANDING_TIERS.map((tier) => tier.label))
      .toEqual(["Hunted", "Hostile", "Unfriendly", "Uninvested", "Friendly", "Allied", "Exalted"]);
    expect(new Set(STANDING_TIERS.map((tier) => standingTier(tier.min))).size).toBe(7);

    // The edges, by value. Off-by-one at a band edge is the defect this class of code actually has, so
    // each pair straddles one boundary and both halves are asserted.
    expect(standingLabel(-100)).toBe("Hunted");
    expect(standingLabel(-75)).toBe("Hunted");
    expect(standingLabel(-74)).toBe("Hostile");
    expect(standingLabel(-45)).toBe("Hostile");
    expect(standingLabel(-44)).toBe("Unfriendly");
    expect(standingLabel(-15)).toBe("Unfriendly");
    expect(standingLabel(-14)).toBe("Uninvested");
    expect(standingLabel(0)).toBe("Uninvested");
    expect(standingLabel(14)).toBe("Uninvested");
    expect(standingLabel(15)).toBe("Friendly");
    expect(standingLabel(44)).toBe("Friendly");
    expect(standingLabel(45)).toBe("Allied");
    expect(standingLabel(74)).toBe("Allied");
    expect(standingLabel(75)).toBe("Exalted");
    expect(standingLabel(100)).toBe("Exalted");
  });

  it("the bands are exhaustive and non-overlapping across the whole scale", () => {
    // Every integer in range maps to exactly one word, and to the SAME word the displayed table claims.
    // Two sources of the ranges is how a card ends up labelled differently from the badge beside it.
    for (let value = STANDING_MIN; value <= STANDING_MAX; value += 1) {
      const matches = STANDING_TIERS.filter((tier) => value >= tier.min && value <= tier.max);
      expect(matches, `${value} should sit in exactly one band`).toHaveLength(1);
      expect(standingTier(value), `${value} disagrees with the tier table`).toBe(matches[0].id);
    }
    // The ladder is symmetric about zero: −n is exactly as far the wrong way as +n is the right way.
    for (let value = 1; value <= STANDING_MAX; value += 1) {
      const negative = STANDING_TIERS.findIndex((tier) => tier.id === standingTier(-value));
      const positive = STANDING_TIERS.findIndex((tier) => tier.id === standingTier(value));
      expect(negative + positive, `${value} and -${value} are not mirror tiers`).toBe(STANDING_TIERS.length - 1);
    }
  });

  it("clamps out-of-range and non-finite values rather than propagating them", () => {
    expect(clampStanding(9999)).toBe(STANDING_MAX);
    expect(clampStanding(-9999)).toBe(STANDING_MIN);
    expect(clampStanding(Number.NaN)).toBe(0);
    expect(clampStanding(12.9)).toBe(12);
    expect(standingValueLabel(40)).toBe("+40");
    expect(standingValueLabel(-15)).toBe("-15");
    expect(standingValueLabel(0)).toBe("0");
  });
});

describe("A signed scale on an unsigned bar (F-6)", () => {
  it("maps −100…+100 onto Meter's 0…max without ever asking it for a negative", () => {
    // `Meter` clamps `value/max` to 0…1 and CANNOT render a negative, and it is shared with token health
    // — so the mapping has to happen here. Asserted at both ends and the middle: the failure this catches
    // is passing the raw value, which would clamp every hostile faction to an empty bar and make Hunted
    // and Uninvested look identical.
    expect(standingMeterValue(-100)).toBe(0);
    expect(standingMeterValue(0)).toBe(STANDING_METER_MAX / 2);
    expect(standingMeterValue(100)).toBe(STANDING_METER_MAX);
    for (let value = STANDING_MIN; value <= STANDING_MAX; value += 1) {
      expect(standingMeterValue(value)).toBeGreaterThanOrEqual(0);
      expect(standingMeterValue(value)).toBeLessThanOrEqual(STANDING_METER_MAX);
    }
  });

  it("renders the bar at the mapped fraction, and never shows Meter's own value/max readout", () => {
    renderCard([CARD(-100)]);
    expect(meterWidth()).toBe("0%");

    renderCard([CARD(0)]);
    expect(document.querySelectorAll(".nh-meter-fill")[1].getAttribute("style")).toContain("50%");

    // The primitive prints "value/max" whenever it is given a `label`. On this mapping that reads
    // "140/200" — numbers that exist only inside the transform. No standing call site passes one.
    expect(screen.queryByText(/\/\s*200/)).not.toBeInTheDocument();
    expect(document.querySelector(".nh-meter-value")).toBeNull();
  });
});

describe("The card says where you stand, in words (CT-6 / R2)", () => {
  it("names the faction, the tier and the signed value, with no colour at all", () => {
    renderCard([CARD(-80, "The Zhentarim"), CARD(50, "Harpers")]);

    // Colour lives entirely in CSS classes, so the proof is that the TEXT distinguishes them: strip
    // every stylesheet and a reader still knows which faction is which and where the party stands.
    const card = screen.getByRole("heading", { name: "Faction standing" }).closest("section")!;
    expect(within(card).getByText("The Zhentarim")).toBeInTheDocument();
    expect(within(card).getByText("Hunted")).toBeInTheDocument();
    expect(within(card).getByText("-80")).toBeInTheDocument();
    expect(within(card).getByText("Harpers")).toBeInTheDocument();
    expect(within(card).getByText("Allied")).toBeInTheDocument();
    expect(within(card).getByText("+50")).toBeInTheDocument();
  });

  it("offers Adjust only to a caller that can write — a player's card has nothing to tap", () => {
    // A CAPABILITY FLAG, never a role check: `CampaignHome` is rendered by the player's Codex too, and
    // the guarantee is that the component cannot tell which audience it is drawing for.
    const { unmount } = renderCard([CARD(20)], vi.fn());
    expect(screen.getByRole("button", { name: "Adjust" })).toBeInTheDocument();
    unmount();

    renderCard([CARD(20)]);
    expect(screen.queryByRole("button", { name: "Adjust" })).not.toBeInTheDocument();
  });

  it("lists the factions that have taken a side first, either side", () => {
    renderCard([CARD(0, "Neutral guild"), CARD(-90, "The hunters"), CARD(30, "The friends")]);
    const names = [...document.querySelectorAll(".codex-campaign-standingname .codex-list-title")].map((node) => node.textContent);
    expect(names).toEqual(["The hunters", "The friends", "Neutral guild"]);
  });
});

describe("Adjusting standing writes the reason with it (CT-6)", () => {
  const renderAdjuster = (standing: CodexStanding | null, onSaved = vi.fn()) => {
    render(<StandingAdjuster gmToken="gm" factionPageId="f1" factionName="The Zhentarim" standing={standing}
      onSaved={onSaved} onClose={vi.fn()} />);
    return onSaved;
  };

  it("sends the new value and the reason, and re-reads rather than trusting the echo", async () => {
    setStanding.mockResolvedValue(STANDING(-40));
    const onSaved = renderAdjuster(STANDING(10));
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("Standing"));
    await user.type(screen.getByLabelText("Standing"), "-40");
    await user.type(screen.getByLabelText("Why it moved"), "Burned their caravan");
    await user.click(screen.getByRole("button", { name: "Record change" }));

    await waitFor(() => expect(setStanding).toHaveBeenCalled());
    expect(setStanding.mock.calls.at(-1)).toEqual(["gm", "f1", -40, "Burned their caravan"]);
    expect(onSaved).toHaveBeenCalled();
  });

  /**
   * A reason is INVITED, not required — and this assertion is the inverse of what it first said.
   *
   * It used to require one, while `StandingSetSchema` on the server makes `reason` optional and states the
   * reason: "the GM adjusting a standing mid-session should not be blocked on typing a sentence." The client
   * quietly overruled that and the button just sat inert, with the value-must-change rule stated nowhere.
   * Found by the final QA pass. The field help still asks for a sentence, which is the right amount of
   * pressure for something worth having but not worth blocking on.
   */
  it("arms as soon as the value moves, reason or not — the server does not require one", async () => {
    renderAdjuster(STANDING(10));
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("Standing"));
    await user.type(screen.getByLabelText("Standing"), "40");
    expect(screen.getByRole("button", { name: "Record change" })).toBeEnabled();

    // A reason still travels when given — that is the record's whole value.
    await user.type(screen.getByLabelText("Why it moved"), "Returned the signet");
    expect(screen.getByRole("button", { name: "Record change" })).toBeEnabled();
  });

  /**
   * A standing change reads on the DASHBOARD the way it reads on the timeline.
   *
   * `setStanding` writes an empty player text on purpose, so the dashboard's feed — which summarised a row
   * as `text || gmText` — rendered five end-of-session standing adjustments as five identical
   * "Untitled entry" rows, pushing every real entry out of a list sliced to five. The Journal rendered the
   * same records correctly from the shared helpers the whole time; the dashboard never called them.
   * Found by the final QA pass.
   */
  it("summarises a standing change and a milestone from their payload, not from empty prose", () => {
    expect(chronicleRowSummary({ kind: "standing", text: "", gmText: null, payload: { factionPageId: "f1", delta: -80, reason: "Stole the Crown from under them." } }))
      .toContain("Stole the Crown from under them.");
    expect(chronicleRowSummary({ kind: "milestone", text: "", gmText: null, payload: { level: 5, reason: "Survived the drow city." } }))
      .toContain("Survived the drow city.");
    // A record that DOES have prose still reads as its prose — the payload is the fallback, not the winner.
    expect(chronicleRowSummary({ kind: "entry", text: "The party crossed the mists.", gmText: null, payload: null }))
      .toBe("The party crossed the mists.");
    // And nothing invents a summary for a record that genuinely has none.
    expect(chronicleRowSummary({ kind: "entry", text: "", gmText: null, payload: null })).toBe("");
  });

  /** A disabled control must say why. Nothing said this before; the deadline composer's hint is the model. */
  it("explains why it will not arm when nothing has moved", async () => {
    renderAdjuster(STANDING(10));
    expect(screen.getByRole("button", { name: "Record change" })).toBeDisabled();
    expect(screen.getByText(/a change of zero would say nothing happened/)).toBeInTheDocument();
  });

  it("will not arm when nothing actually moved", async () => {
    // A chronicle row saying "unchanged, because…" records the GM having opened a dialog, not an event.
    renderAdjuster(STANDING(10));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Why it moved"), "No change at all");
    expect(screen.getByRole("button", { name: "Record change" })).toBeDisabled();
  });

  it("clamps what it sends to the signed bounds", async () => {
    setStanding.mockResolvedValue(STANDING(100));
    renderAdjuster(STANDING(0));
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("Standing"));
    await user.type(screen.getByLabelText("Standing"), "5000");
    await user.type(screen.getByLabelText("Why it moved"), "Saved the city");
    await user.click(screen.getByRole("button", { name: "Record change" }));

    await waitFor(() => expect(setStanding).toHaveBeenCalled());
    expect(setStanding.mock.calls.at(-1)![2]).toBe(STANDING_MAX);
  });

  it("has nothing to reveal until a standing exists, and reveals through the shared route once it does", async () => {
    const { unmount } = render(<StandingAdjuster gmToken="gm" factionPageId="f1" factionName="The Zhentarim"
      standing={null} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Show this standing to players")).not.toBeInTheDocument();
    unmount();

    revealStanding.mockResolvedValue(STANDING(10, true));
    render(<StandingAdjuster gmToken="gm" factionPageId="f1" factionName="The Zhentarim"
      standing={STANDING(10)} onSaved={vi.fn()} onClose={vi.fn()} />);
    await userEvent.setup().click(screen.getByLabelText("Show this standing to players"));

    await waitFor(() => expect(revealStanding).toHaveBeenCalledWith("gm", "f1", true));
    // Revealing is not an edit: it carries no reason and writes no chronicle record.
    expect(setStanding).not.toHaveBeenCalled();
  });
});

describe("M12's two new chronicle kinds read by icon AND word (R2)", () => {
  it("both name an icon the registry actually has, and neither is the silent `pin` fallback", () => {
    // `iconChildren` falls back to `pin` rather than throwing, so an invented id is silent at runtime:
    // every milestone row in the campaign would draw a map pin and nothing would ever say so.
    for (const kind of ["milestone", "standing"] as const) {
      const meta = CHRONICLE_KIND_META[kind];
      expect(CODEX_ICONS[meta.iconId], `${kind} names an icon that does not exist: ${meta.iconId}`).toBeDefined();
      expect(meta.label.trim()).not.toBe("");
    }
    // Still distinct across ALL kinds — two sharing a word would leave colour as the only difference.
    const labels = Object.values(CHRONICLE_KIND_META).map((meta) => meta.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("a payload is only ever read as the kind it actually is", () => {
    // The kind gate, on its own. A record whose payload is opened without it renders a standing change's
    // `delta` as a level, or a milestone's `level` as a faction's id — silently, and in a sentence.
    const record = (over: Partial<CodexChronicleRecord>): CodexChronicleRecord => ({
      kind: "entry", id: "x", title: null, text: "", gmText: null, revealedToPlayers: false,
      sessionId: null, sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
      tags: [], attachPageId: null, attachMarkerId: null, sourceEncounterId: null, payload: null,
      fired: false, proposedDate: null, createdAt: "", updatedAt: "", ...over
    });
    const milestone = record({ kind: "milestone", payload: { level: 5, reason: "Cleared the citadel" } });
    const standing = record({ kind: "standing", payload: { factionPageId: "f1", delta: -20, reason: "Burned the caravan" } });

    expect(milestoneOf(milestone)).toEqual({ level: 5, reason: "Cleared the citadel" });
    expect(standingOf(standing)).toEqual({ factionPageId: "f1", delta: -20, reason: "Burned the caravan" });
    // Each gate refuses the other's record, and both refuse a downtime.
    expect(standingOf(milestone)).toBeNull();
    expect(milestoneOf(standing)).toBeNull();
    expect(downtimeOf(milestone)).toBeNull();
    expect(downtimeOf(standing)).toBeNull();
    // A payload carried on the WRONG kind is refused too — the gate is the kind, not the shape.
    expect(milestoneOf(record({ kind: "entry", payload: { level: 5, reason: "x" } }))).toBeNull();
  });

  it("says what each record was, in one line", () => {
    expect(milestoneSummaryLabel({ level: 5, reason: "Cleared the citadel" })).toBe("Reached level 5 — Cleared the citadel");
    expect(milestoneSummaryLabel({ level: 5, reason: "  " })).toBe("Reached level 5");
    expect(standingChangeLabel({ factionPageId: "f1", delta: -20, reason: "Burned the caravan" }, "The Zhentarim"))
      .toBe("The Zhentarim — down 20 · Burned the caravan");
    expect(standingChangeLabel({ factionPageId: "f1", delta: 15, reason: "" }, "Harpers")).toBe("Harpers — up 15");
    // A faction the reader cannot name is never given an invented one.
    expect(standingChangeLabel({ factionPageId: "f1", delta: 15, reason: "" }, null)).toBe("A faction — up 15");
  });
});
