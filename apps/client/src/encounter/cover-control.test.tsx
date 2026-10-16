import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GmActor } from "@vtt/domain";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args) }));

import { CoverControl } from "./CoverControl";

const ACTOR = "10000000-0000-4000-8000-000000000002";
const marked = (tag: string) => [{ id: "marker", name: "Half Cover", tags: [tag] }] as unknown as GmActor["effects"];

describe("the GM's cover marker", () => {
  it("marks a creature with the cover picked", async () => {
    render(<CoverControl actor={{ id: ACTOR, effects: [] }} onFeedback={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Three-quarters" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("effect:add", {
        actorId: ACTOR,
        name: "Three-quarters Cover",
        tags: ["cover-three-quarters"]
      })
    );
  });

  it("clears the old marker before setting another, and None just clears it", async () => {
    command.mockClear();
    render(<CoverControl actor={{ id: ACTOR, effects: marked("cover-half") }} onFeedback={() => {}} />);
    expect(screen.getByRole("button", { name: "Half" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    await waitFor(() => expect(command).toHaveBeenCalledWith("effect:end", { actorId: ACTOR, effectId: "marker" }));
    expect(command).not.toHaveBeenCalledWith("effect:add", expect.anything());
  });
});
