/** The "Uses are" select reads its value back from the stored shape (`mode` is not stored; without a
    `read` the renderer showed "Not set" on every render). Drives the real `RiderEditor` at both scopes
    through the full loop: render from a stored body, change it, then remount from the new body. */

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forStorage } from "./defaults";
import { ITEM_RIDERS, RiderEditor } from "./RiderEditor";
import { EMPTY_CONTEXT, type Draft } from "./schema";

/** The rider form, driven the way `RecordDetail` drives it: one draft, one `onChange`. */
function Riders({ body, scope, onBody }: { body: Draft; scope: "feature" | "item"; onBody: (next: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>(body);
  return (
    <RiderEditor
      value={draft}
      onChange={(next) => {
        setDraft(next);
        onBody(next);
      }}
      enabled={scope === "item" ? ITEM_RIDERS : ["modifiers", "uses", "tags", "actions", "effects"]}
      scope={scope}
      ctx={EMPTY_CONTEXT}
      idPrefix={`hb-${scope}`}
    />
  );
}

function mount(body: Draft, scope: "feature" | "item" = "item") {
  let latest: Draft = body;
  const view = render(
    <Riders
      body={body}
      scope={scope}
      onBody={(next) => {
        latest = next;
      }}
    />
  );
  // Scoped to this mount's container: some tests mount two forms at once.
  return {
    /** The label is the phrase each option completes ("Uses are… A flat number"). */
    select: () => within(view.container).getByRole("combobox", { name: "Uses are" }) as HTMLSelectElement,
    /** The body `useAutosave` would send, including `emptyValue`/`undefined` handling. */
    body: () => forStorage(latest),
    unmount: () => view.unmount()
  };
}

/** The four shapes the select reads back, as schema literals. */
const FLAT: Draft = { uses: { limit: 3, per: "short-rest" } };
const ABILITY: Draft = {
  uses: { scaling: { type: "ability-modifier", ability: "con", minimum: 1 }, per: "long-rest" }
};
const BY_LEVEL: Draft = { uses: { scaling: { type: "by-level", table: [{ level: 1, limit: 2 }] }, per: "long-rest" } };
const PROFICIENCY: Draft = { uses: { scaling: { type: "proficiency-bonus" }, per: "long-rest" } };

describe("3b(a) — “Uses are” reads its answer back out of the shape", () => {
  it("a stored body renders as the mode it stores, not as “Not set”", () => {
    expect(mount(FLAT).select().value).toBe("flat");
    expect(mount(ABILITY).select().value).toBe("ability-modifier");
    expect(mount(BY_LEVEL).select().value).toBe("by-level");
    expect(mount(PROFICIENCY).select().value).toBe("proficiency-bonus");
  });

  it("a record with no uses block still reads as “Not set” — absence is the only empty", () => {
    const form = mount({ name: "Plain Mace" });
    expect(form.select().value).toBe("");
    // Reading must not write.
    expect(form.body()).toEqual({ name: "Plain Mace" });
  });

  it("THE REPORTED LOOP: read → change → the body changes → mount again → it survived", async () => {
    const user = userEvent.setup();
    const form = mount(FLAT);
    expect(form.select().value).toBe("flat");

    await user.selectOptions(form.select(), "by-level");
    expect(form.select().value).toBe("by-level");

    // The write half.
    const stored = form.body() as { uses: { limit?: number; scaling?: { type: string; table: unknown[] } } };
    expect(stored.uses.scaling).toEqual({ type: "by-level", table: [{ level: 1, limit: 1 }] });
    expect(stored.uses.limit).toBeUndefined();

    // Remount from the stored body: the step a re-render can't stand in for.
    form.unmount();
    expect(mount(stored as Draft).select().value).toBe("by-level");
  });

  it("the same control on a FEATURE, because it is the same control", async () => {
    // `usesField` is shared by items ("Charges") and features ("Limited uses").
    const user = userEvent.setup();
    const form = mount(ABILITY, "feature");
    expect(form.select().value).toBe("ability-modifier");

    await user.selectOptions(form.select(), "flat");
    const stored = form.body() as { uses: { limit?: number; scaling?: unknown } };
    expect(stored.uses.scaling).toBeUndefined();
    expect(stored.uses.limit).toBe(1);

    form.unmount();
    expect(mount(stored as Draft, "feature").select().value).toBe("flat");
  });
});
