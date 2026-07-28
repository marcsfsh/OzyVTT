/**
 * A spell list's membership, as spells ON or OFF.
 *
 * **The GM never sees `basedOn` / `add` / `remove`.** Same discipline as the
 * auto-generated ids: the mechanism is not the interface. This component resolves
 * `union(basedOn) ∪ add \ remove` live and writes back to whichever field is correct —
 * turning off a spell that came from `basedOn` writes `remove`; turning on a spell that
 * did not writes `add`; turning either back reverses exactly that write rather than
 * leaving a redundant entry behind.
 *
 * **The trap this closes.** A spell can join a list two ways: the list adds it, or the
 * *spell* names the list in its own `classes` field. The overlay unions both, so
 * `remove` cannot remove a self-tagged spell — turning it off would appear to work and
 * then not. Such a spell therefore renders **on, with its toggle disabled and the reason
 * in place**. Annotated, never dropped from the list (rule 1), and an unfixable "I
 * turned it off and it's still there" bug becomes unauthorable.
 */

import { useMemo, useState } from "react";
import { Badge, ChoiceGrid, type ChoiceOption } from "@vtt/ui";
import type { Draft, SchemaContext } from "./schema";

export type SpellMembership = Readonly<{ id: string; name: string; level: number; classes: readonly string[] }>;

export function SpellListContents({
  draft,
  onDraft,
  ctx,
  listId,
  spells
}: Readonly<{
  draft: Draft;
  onDraft: (next: Draft) => void;
  ctx: SchemaContext;
  listId: string;
  spells: readonly SpellMembership[];
}>) {
  const basedOn = useMemo(() => (Array.isArray(draft.basedOn) ? (draft.basedOn as string[]) : []), [draft.basedOn]);
  const add = useMemo(() => (Array.isArray(draft.add) ? (draft.add as string[]) : []), [draft.add]);
  const remove = useMemo(() => (Array.isArray(draft.remove) ? (draft.remove as string[]) : []), [draft.remove]);

  const [facet, setFacet] = useState("in");

  const resolved = useMemo(() => {
    const inherited = new Set<string>();
    const selfTagged = new Set<string>();
    for (const spell of spells) {
      if (spell.classes.includes(listId)) selfTagged.add(spell.id);
      if (basedOn.some((source) => spell.classes.includes(source))) inherited.add(spell.id);
    }
    const on = new Set<string>();
    for (const id of inherited) if (!remove.includes(id)) on.add(id);
    for (const id of add) on.add(id);
    // A self-tagged spell is on no matter what `remove` says — so it is shown that way.
    for (const id of selfTagged) on.add(id);
    return { inherited, selfTagged, on };
  }, [spells, basedOn, add, remove, listId]);

  const options = useMemo<readonly ChoiceOption[]>(
    () =>
      spells.map((spell) => {
        const selfTagged = resolved.selfTagged.has(spell.id);
        return {
          value: spell.id,
          title: spell.name,
          meta: spell.level === 0 ? "Cantrip" : `Level ${spell.level}`,
          keywords: spell.classes.join(" "),
          facet: resolved.on.has(spell.id) ? "in" : "out",
          disabled: selfTagged,
          disabledReason: selfTagged ? "This spell names this list itself — edit the spell to change it." : undefined,
          badge: selfTagged ? <Badge tone="info">From the spell</Badge> : undefined
        };
      }),
    [spells, resolved]
  );

  const toggle = (id: string, next: boolean) => {
    const inherited = resolved.inherited.has(id);
    let nextAdd = add;
    let nextRemove = remove;
    if (next) {
      nextRemove = remove.filter((entry) => entry !== id);
      if (!inherited && !add.includes(id)) nextAdd = [...add, id];
    } else {
      nextAdd = add.filter((entry) => entry !== id);
      if (inherited && !remove.includes(id)) nextRemove = [...remove, id];
    }
    onDraft({ ...draft, add: nextAdd, remove: nextRemove });
  };

  const inheritedCount = [...resolved.inherited].filter((id) => !remove.includes(id)).length;

  return (
    <div className="hb-field">
      <span className="nh-field-label">Spells</span>
      {/* Derived, stated once, and it makes the overlay legible without naming its fields. */}
      <p className="nh-field-help">
        <strong className="tabular">{resolved.on.size}</strong> {resolved.on.size === 1 ? "spell" : "spells"} —{" "}
        {inheritedCount} from {basedOn.length === 0 ? "no other list" : basedOn.length === 1 ? "one list" : `${basedOn.length} lists`}, {add.length} added, {remove.length} removed.
      </p>
      <ChoiceGrid
        options={options}
        value={null}
        onChange={() => {}}
        selection="multiple"
        values={[...resolved.on]}
        onToggle={toggle}
        ariaLabel="Spells on this list"
        searchable
        searchPlaceholder="Search spells…"
        searchDelay={160}
        /* Arrives faceted to "In this list", so the opening state is the small current
           membership rather than several hundred cards. */
        facets={[
          { value: "in", label: "In this list" },
          { value: "out", label: "Everything else" },
          { value: "all", label: "All" }
        ]}
        facetValue={facet}
        onFacetChange={setFacet}
        facetAllValue="all"
        emptyTitle="No spells on this list yet."
        emptyText="Search for spells to add — SRD spells are fair game, and homebrew spells can name this list themselves."
      />
      {ctx.spells.length === 0 && <p className="nh-field-help">The spell catalog hasn&rsquo;t loaded yet.</p>}
    </div>
  );
}
