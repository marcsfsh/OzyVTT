import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmActor, GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
const command = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ ok: true })));
// Reference reads (spells, classes) never answer here; nothing under test waits on them.
vi.mock("../lib/command", () => ({ command, read: () => new Promise(() => {}) }));

import { PartyRosterTab, neverPlayed } from "./PartyRosterTab";

const pc = (over: Partial<GmActor> & Pick<GmActor, "id" | "name">): GmActor =>
  ({
    kind: "player-character",
    visibility: "public",
    hp: { current: 20, maximum: 20, temporary: 0 },
    effects: [],
    conditions: [],
    presence: null,
    size: "medium",
    sizeCells: 1,
    ownerSessionId: null,
    archived: false,
    ...over
  }) as unknown as GmActor;

const view = (actors: GmActor[]) => ({ revision: 4, actors, pendingImports: [], definitions: [] }) as unknown as GmView;

const roster = (actors: GmActor[]) =>
  render(
    <ToastProvider>
      <PartyRosterTab state={view(actors)} token="gm" />
    </ToastProvider>
  );

const card = (name: string) => screen.getByRole("heading", { name }).closest("li")!;

beforeEach(() => {
  // The join address isn't under test here; a failed fetch leaves it out.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("the Roster", () => {
  it("marks a character played at the table, and keeps a claimed one on its player's device", async () => {
    const user = userEvent.setup();
    command.mockClear();
    roster([
      pc({ id: "a", name: "Lyra" }),
      pc({ id: "b", name: "Borin", ownerSessionId: "s1" }),
      pc({ id: "c", name: "Mirena", playedAtTable: true })
    ]);
    // Played at the table lives in each band's More menu (characters rule 4).
    const more = async (name: string) => {
      await user.click(within(card(name)).getByLabelText(`More for ${name}`));
      return within(card(name)).getByRole("menuitemcheckbox", { name: "Played at the table" });
    };
    await user.click(await more("Lyra"));
    expect(command).toHaveBeenCalledWith("actor:set-played-at-table", { actorId: "a", playedAtTable: true });
    expect(await more("Borin")).toBeDisabled();
    expect(await more("Mirena")).toHaveAttribute("aria-checked", "true");
    // Who plays, with its lamp, in the roster's words.
    expect(card("Mirena")).toHaveTextContent("At the table");
    expect(card("Borin")).toHaveTextContent("On a player's device");
    expect(card("Lyra")).toHaveTextContent("Open to claim");
  });

  it("tells a character nobody has played from one that has been", () => {
    expect(neverPlayed(pc({ id: "a", name: "New" }))).toBe(true);
    expect(neverPlayed(pc({ id: "b", name: "Claimed once", firstClaimedAt: 1 }))).toBe(false);
    expect(neverPlayed(pc({ id: "c", name: "Fought", lastUsedAt: 1 }))).toBe(false);
    expect(neverPlayed(pc({ id: "d", name: "Held", ownerSessionId: "s1" }))).toBe(false);
  });

  it("deletes a never-played character outright and archives one that has been played", () => {
    roster([pc({ id: "a", name: "Fresh" }), pc({ id: "b", name: "Veteran", firstClaimedAt: 1 })]);
    expect(within(card("Fresh")).getByRole("menuitem", { name: "Delete", hidden: true })).toBeInTheDocument();
    expect(within(card("Fresh")).queryByRole("menuitem", { name: "Archive", hidden: true })).toBeNull();
    expect(within(card("Veteran")).getByRole("menuitem", { name: "Archive", hidden: true })).toBeInTheDocument();
    expect(within(card("Veteran")).queryByRole("menuitem", { name: "Delete", hidden: true })).toBeNull();
  });

  it("has a toolbar with the count, Roll a random character and Import, and no join address", async () => {
    const user = userEvent.setup();
    roster([pc({ id: "a", name: "Lyra" }), pc({ id: "b", name: "Borin" })]);
    expect(screen.getByRole("status")).toHaveTextContent("2 characters");
    expect(screen.getByRole("button", { name: "Roll a random character" })).toBeInTheDocument();
    await user.click(screen.getByText("Import"));
    expect(screen.getByRole("menuitem", { name: "From a D&D Beyond PDF" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "From a JSON file" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Join address" })).toBeNull();
  });

  it("shows each band's AC, hit points and Speed", () => {
    roster([pc({ id: "a", name: "Lyra" })]);
    const plate = within(card("Lyra"));
    expect(plate.getByText("AC")).toBeInTheDocument();
    expect(plate.getByText("Hit points")).toBeInTheDocument();
    expect(plate.getByText("Speed")).toBeInTheDocument();
  });

  it("badges the samples and removes them all on request", async () => {
    const user = userEvent.setup();
    roster([
      pc({ id: "s1", name: "Borin", sample: true }),
      pc({ id: "s2", name: "Lyra", sample: true }),
      pc({ id: "m", name: "Mine" })
    ]);
    expect(within(card("Borin")).getByText("Sample")).toBeInTheDocument();
    expect(within(card("Mine")).queryByText("Sample")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("Borin and Lyra are sample characters");

    await user.click(screen.getByRole("button", { name: "Remove sample characters" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove samples" }));
    // One command: the server decides which samples may go.
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    expect(command).toHaveBeenCalledWith("actor:remove-samples", {});
    expect(await screen.findByText("The sample characters are gone.")).toBeInTheDocument();
  });

  it("names each sample the server kept, with its reason", async () => {
    const user = userEvent.setup();
    command.mockResolvedValueOnce({
      ok: true,
      removed: ["Borin"],
      kept: [{ name: "Lyra", reason: "Release that character's claim before removing it." }]
    } as never);
    roster([pc({ id: "s1", name: "Borin", sample: true }), pc({ id: "s2", name: "Lyra", sample: true })]);
    await user.click(screen.getByRole("button", { name: "Remove sample characters" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove samples" }));
    expect(
      await screen.findByText("Some samples stayed. Lyra: Release that character's claim before removing it.")
    ).toBeInTheDocument();
  });

  it("asks again before releasing a character mid-encounter", async () => {
    const user = userEvent.setup();
    command.mockResolvedValueOnce({
      ok: false,
      code: "in_encounter",
      message: "Borin is in the encounter. Releasing Borin takes the player's turn controls away."
    } as never);
    roster([pc({ id: "b", name: "Borin", ownerSessionId: "s1", firstClaimedAt: 1 })]);
    await user.click(screen.getByLabelText("More for Borin"));
    await user.click(screen.getByRole("menuitem", { name: "Release" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Release Borin?" })).getByRole("button", { name: "Release" })
    );
    const again = await screen.findByRole("dialog", { name: "Release Borin mid-encounter?" });
    expect(again).toHaveTextContent("takes the player's turn controls away");
    await user.click(within(again).getByRole("button", { name: "Release anyway" }));
    await vi.waitFor(() =>
      expect(command).toHaveBeenLastCalledWith("character:force-release", { actorId: "b", inFight: true })
    );
    expect(command).toHaveBeenCalledWith("character:force-release", { actorId: "b" });
  });
});
