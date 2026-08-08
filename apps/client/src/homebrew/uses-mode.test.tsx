/**
 * **`3b`(a) — "the 'Uses are' dropdown will not hold a value."**
 *
 * Correct as reported, and the diagnosis is narrower than the report could be. The chosen shape was
 * **saving correctly all along**: `usesField`'s `write` reshapes `uses` exactly as it always did, and
 * the body a GM published carried `scaling: { type: "by-level", … }` or a flat `limit` faithfully.
 * What was missing is the other half of the same idea. The field's own comment says
 *
 * > `mode` is NOT stored — it is read back out of the shape
 *
 * and **it never was read back**. With no `read`, `FieldRenderer` falls through to
 * `getAt(value, "mode")` — a key the write path deliberately never persists — so `raw` was
 * `undefined` on every pass, `asString` turned it into `""`, and `""` selects
 * `<option value="">Not set</option>`. The control forgot the answer the instant it was given, on
 * every render, not only after a reload.
 *
 * Not a controlled-input bug, not `defaults.ts`, not `useAutosave.ts` — a missing `read`. Five lines.
 *
 * ## What these tests drive
 *
 * The real `RiderEditor`, mounted the way `RecordDetail` mounts it (one value, one `onChange`), at
 * **both scopes**: `usesField` is one component that items and features both mount, so the defect and
 * its fix are shared and the test says so rather than assuming it.
 *
 * The loop asserted is the exact one the report describes: render from a stored body → the select
 * reads back → change it → the body changes → **mount again from that body** → the answer survived.
 * The last step is the reload, and it is the one no re-render can fake.
 */

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
      onChange={(next) => { setDraft(next); onBody(next); }}
      enabled={scope === "item" ? ITEM_RIDERS : ["modifiers", "uses", "tags", "actions", "effects"]}
      scope={scope}
      ctx={EMPTY_CONTEXT}
      idPrefix={`hb-${scope}`}
    />
  );
}

function mount(body: Draft, scope: "feature" | "item" = "item") {
  let latest: Draft = body;
  const view = render(<Riders body={body} scope={scope} onBody={(next) => { latest = next; }} />);
  // Scoped to THIS mount's own container: several of these tests stand two forms up side by side
  // (the reload case mounts a second one), and `screen` would see both.
  return {
    /** The label is the sentence the option finishes — "Uses are… A flat number". */
    select: () => within(view.container).getByRole("combobox", { name: "Uses are" }) as HTMLSelectElement,
    /** The body `useAutosave` would send, so `emptyValue`/`undefined` handling is included. */
    body: () => forStorage(latest),
    unmount: () => view.unmount()
  };
}

/** The four shapes the select is the readback of — schema literals, not a mapping table. */
const FLAT: Draft = { uses: { limit: 3, per: "short-rest" } };
const ABILITY: Draft = { uses: { scaling: { type: "ability-modifier", ability: "con", minimum: 1 }, per: "long-rest" } };
const BY_LEVEL: Draft = { uses: { scaling: { type: "by-level", table: [{ level: 1, limit: 2 }] }, per: "long-rest" } };
const PROFICIENCY: Draft = { uses: { scaling: { type: "proficiency-bonus" }, per: "long-rest" } };

describe("3b(a) — “Uses are” reads its answer back out of the shape", () => {
  it("a stored body renders as the mode it stores, not as “Not set”", () => {
    // The headline. Every one of these used to render `""`.
    expect(mount(FLAT).select().value).toBe("flat");
    expect(mount(ABILITY).select().value).toBe("ability-modifier");
    expect(mount(BY_LEVEL).select().value).toBe("by-level");
    expect(mount(PROFICIENCY).select().value).toBe("proficiency-bonus");
  });

  it("a record with no uses block still reads as “Not set” — absence is the only empty", () => {
    const form = mount({ name: "Plain Mace" });
    expect(form.select().value).toBe("");
    // And nothing was invented on the way in: reading must not write.
    expect(form.body()).toEqual({ name: "Plain Mace" });
  });

  it("THE REPORTED LOOP: read → change → the body changes → mount again → it survived", async () => {
    const user = userEvent.setup();
    const form = mount(FLAT);
    expect(form.select().value).toBe("flat");

    await user.selectOptions(form.select(), "by-level");
    expect(form.select().value).toBe("by-level");

    // The write half, which was never broken — asserted so the fix cannot be mistaken for one.
    const stored = form.body() as { uses: { limit?: number; scaling?: { type: string; table: unknown[] } } };
    expect(stored.uses.scaling).toEqual({ type: "by-level", table: [{ level: 1, limit: 1 }] });
    expect(stored.uses.limit).toBeUndefined();

    // THE RELOAD. A fresh mount from the body the server would have given back — the step the
    // report is actually about, and the one a re-render of a live component cannot stand in for.
    form.unmount();
    expect(mount(stored as Draft).select().value).toBe("by-level");
  });

  it("the same control on a FEATURE, because it is the same control", async () => {
    // `usesField` is mounted once by items ("Charges") and once by features ("Limited uses"), so a
    // fix in one is a fix in both — and a regression in one is a regression in both.
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
