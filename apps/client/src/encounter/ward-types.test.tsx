import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ContentActionSummary } from "@vtt/domain";

vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: vi.fn(async () => ({ ok: false }))
}));

import { ShapeChoices } from "./ShapeChoices";
import { beginTargeting, clearTargeting, shapeChoicePayload, toggleWardType, useTargeting } from "./targeting";

// SRD 5.2.1 Magic Circle: "Choose one or more of the following types of creatures". The cast's aim lists the types its
// barrier may ward as touch-sized checkboxes, and sends the ones picked; with none picked it wards them all.

const WIZARD = "10000000-0000-4000-8000-000000000001";
const MAGIC_CIRCLE = {
  id: "spell-magic-circle",
  name: "Magic Circle",
  activation: "action",
  description: "You create a Cylinder of magical energy.",
  attackBonus: null,
  damage: [],
  area: { shape: "cylinder", sizeFeet: 10, widthFeet: null, heightFeet: 20 },
  options: [
    { id: "facing-out", name: "Keeps them out, wards those inside" },
    { id: "reversed", name: "Holds them in, wards those outside" }
  ],
  wardTypes: ["celestial", "elemental", "fey", "fiend", "undead"]
} as unknown as ContentActionSummary;

afterEach(() => clearTargeting());

describe("the creature types a barrier wards", () => {
  it("lists each type the spell names, saying all of them are warded until some are picked", () => {
    render(
      <ShapeChoices
        action={MAGIC_CIRCLE}
        choice={{}}
        targets={[]}
        onForm={() => {}}
        onGear={() => {}}
        onOption={() => {}}
        onWardType={() => {}}
      />
    );
    expect(screen.getByText("Wards against every type below")).toBeTruthy();
    for (const name of ["Celestials", "Elementals", "Fey", "Fiends", "Undead"])
      expect(screen.getByLabelText(name)).toBeTruthy();
  });

  it("sends the types picked with the cast", () => {
    beginTargeting(MAGIC_CIRCLE, WIZARD, 3);
    toggleWardType("fiend");
    toggleWardType("undead");
    toggleWardType("undead");
    const session = renderHook(() => useTargeting()).result.current!;
    expect(shapeChoicePayload(session, [])).toMatchObject({ creatureTypes: ["fiend"] });
  });

  it("calls back with the type tapped", () => {
    const picked = vi.fn();
    render(
      <ShapeChoices
        action={MAGIC_CIRCLE}
        choice={{ creatureTypes: ["fiend"] }}
        targets={[]}
        onForm={() => {}}
        onGear={() => {}}
        onOption={() => {}}
        onWardType={picked}
      />
    );
    expect(screen.queryByText("Wards against every type below")).toBeNull();
    fireEvent.click(screen.getByLabelText("Fey"));
    expect(picked).toHaveBeenCalledWith("fey");
  });
});
