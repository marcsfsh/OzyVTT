/**
 * The `unarmored-defense.allowShield` rider row. On a feature the builder reads the flag, so the row
 * carries no "not read" note and the switch writes the key the server reads. On an item nothing reads
 * the rider (it is builder-baked from features and feats only), so the item scope keeps a note. Both
 * scopes are mounted.
 */

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RiderEditor } from "./RiderEditor";
import { EMPTY_CONTEXT, type Draft } from "./schema";

/** One authored Unarmored Defense rider, in the shape `FeatureModifierSchema` accepts. */
const body = (allowShield: boolean): Draft =>
  ({
    modifiers: [{ rowId: "row-1", type: "unarmored-defense", ability: "con", allowShield }]
  }) as unknown as Draft;

function mount(allowShield: boolean, scope: "feature" | "item" = "feature") {
  let latest: Draft = body(allowShield);
  function Riders() {
    const [draft, setDraft] = useState<Draft>(latest);
    return (
      <RiderEditor
        value={draft}
        onChange={(next) => {
          setDraft(next);
          latest = next;
        }}
        enabled={["modifiers", "uses", "tags", "actions", "effects"]}
        scope={scope}
        ctx={EMPTY_CONTEXT}
        idPrefix={`hb-${scope}`}
      />
    );
  }
  const view = render(<Riders />);
  return {
    container: view.container,
    /** A modifier row with more than two fields is collapsible, so open it first, as a GM would. */
    open: () =>
      userEvent.click(within(view.container).getByRole("button", { expanded: false, name: /Unarmoured defence/ })),
    shieldSwitch: () => within(view.container).getByRole("switch", { name: "A shield still counts" }),
    /** Every interactive target on the form (what a 375px tap audit walks). */
    controls: () => view.container.querySelectorAll("button, input, select, textarea, [role='switch']").length,
    stored: () => (latest as unknown as { modifiers: Array<Record<string, unknown>> }).modifiers[0]
  };
}

describe("the unarmored-defense rider row", () => {
  it("no longer carries the 'Not read yet.' note", async () => {
    const form = mount(true);
    await form.open();
    // The switch renders, so the absence below is real; checked against the whole form since `note`
    // shares the help slot.
    expect(form.shieldSwitch()).toBeTruthy();
    expect(form.container.textContent).not.toContain("Not read yet");
    // Nor the item-scope note: on a feature the reader is real.
    expect(form.container.textContent).not.toContain("Not read on an item");
  });

  /** On an item the reader does not exist (the rider moves AC by 0 either way), so the absence is
      named beside the help before the GM publishes. */
  it("names the absence on an item, where nothing reads the rider", async () => {
    const form = mount(true, "item");
    await form.open();
    expect(form.shieldSwitch()).toBeTruthy();
    expect(form.container.textContent).toContain("Not read on an item");
    // `FieldRenderer` composes help and note; the flag's meaning holds wherever it is authored.
    expect(form.container.textContent).toContain("On follows the Barbarian's rule");

    // The note is prose in the help slot, so it adds no tap target on either scope.
    const feature = mount(true, "feature");
    await feature.open();
    expect(form.controls()).toBe(feature.controls());
    expect(form.controls()).toBe(16); // a fixed count, so an empty render cannot pass the line above
  });

  it("writes the flag the engine reads", async () => {
    const form = mount(true);
    await form.open();
    expect(form.shieldSwitch().getAttribute("aria-checked")).toBe("true");
    await userEvent.click(form.shieldSwitch());
    // Off means a shield replaces the defence (the Monk's rule), as asserted server-side in
    // `unarmored-defense-shield.test.ts`.
    expect(form.stored().allowShield).toBe(false);
    expect(form.shieldSwitch().getAttribute("aria-checked")).toBe("false");
  });
});
