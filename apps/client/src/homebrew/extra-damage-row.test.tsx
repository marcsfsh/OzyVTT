/**
 * The `extra-damage` rider row with no damage type: it follows the attack's own type (Empowered
 * Evocation follows the spell), so the row must publish without one and say what it does.
 */

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModifierSchema } from "@vtt/schemas";
import { RiderEditor } from "./RiderEditor";
import { EMPTY_CONTEXT, type Draft } from "./schema";

function mount() {
  let latest = { modifiers: [] } as unknown as Draft;
  function Riders() {
    const [draft, setDraft] = useState<Draft>(latest);
    return (
      <RiderEditor
        value={draft}
        onChange={(next) => {
          setDraft(next);
          latest = next;
        }}
        enabled={["modifiers"]}
        scope="feature"
        ctx={EMPTY_CONTEXT}
        idPrefix="hb-feature"
      />
    );
  }
  const view = render(<Riders />);
  return {
    container: view.container,
    stored: () => (latest as unknown as { modifiers: Array<Record<string, unknown>> }).modifiers[0]
  };
}

describe("an extra-damage rider row", () => {
  it("starts with no damage type, reads as the attack's own, and parses as published", async () => {
    const form = mount();
    await userEvent.click(within(form.container).getByRole("button", { name: "Add a modifier" }));
    const kind = within(form.container).getAllByRole("combobox")[0];
    await userEvent.selectOptions(kind, "extra-damage");

    const { rowId: _rowId, ...modifier } = form.stored();
    expect(modifier).not.toHaveProperty("damageType");
    expect(ModifierSchema.safeParse(modifier).success).toBe(true);
    expect(form.container.textContent).toContain("Same as the attack");
  });
});
