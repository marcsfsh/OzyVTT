import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SchemaForm } from "./SchemaForm";
import { SCHEMAS } from "./schemas";
import { EMPTY_CONTEXT, referenceName, type SchemaContext } from "./schema";

const wand = {
  name: "Wand of Saltfire",
  isMagic: true,
  casts: [{ rowId: "cast-1", spellId: "hb-brine-burst-a1b2c3", uses: { limit: 7, per: "long-rest" } }]
};

describe("a spell an item casts", () => {
  it("is named by the record the server says the id names", () => {
    const ctx: SchemaContext = {
      ...EMPTY_CONTEXT,
      references: { "hb-brine-burst-a1b2c3": { name: "Brine Burst" } }
    };
    render(<SchemaForm schema={SCHEMAS.equipment} draft={wand} onDraft={() => {}} ctx={ctx} />);
    expect(screen.getByText("Brine Burst · 7 per Long Rest")).toBeInTheDocument();
    expect(screen.queryByText(/Hb brine burst/i)).toBeNull();
  });

  it("is named from the catalog when the server has not read it yet, and spelled out only when nothing knows it", () => {
    const ctx: SchemaContext = {
      ...EMPTY_CONTEXT,
      spells: [{ id: "fireball", name: "Fireball", origin: "srd" }]
    };
    expect(referenceName(ctx, "fireball")).toBe("Fireball");
    expect(referenceName(ctx, "hb-gone-spell-0f0f0f")).toBe("Gone spell 0f0f0f");
  });
});
