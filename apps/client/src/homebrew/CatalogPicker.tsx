/**
 * Single-select over a catalog too big for a `<select>` — 339 spells, ~240 pieces of
 * equipment. A button showing the current value opens a modal holding the searchable
 * `ChoiceGrid` the builder already uses.
 *
 * **Not a primitive.** It composes `Button` + `Modal` + `ChoiceGrid` and adds no design
 * vocabulary of its own, so it does not belong in `@vtt/ui` — and every component that
 * stays out is a styleguide entry not owed.
 *
 * The facets appear only when both origins are present, and a badge is stamped only on
 * the minority side: badge the exception, not the rule. A grid where every card carries
 * the same badge has distinguished nothing and spent ~46px of every title row at 375px.
 */

import { useMemo, useState } from "react";
import { Badge, Button, ChoiceGrid, Modal, type ChoiceOption, type SegmentedOption } from "@vtt/ui";
import type { CatalogEntry } from "./schema";

export function CatalogPicker({
  entries,
  value,
  onChange,
  emptyLabel,
  title,
  searchPlaceholder,
  ariaLabel,
  id,
  disabled
}: Readonly<{
  entries: readonly CatalogEntry[];
  value: string | null;
  onChange: (next: string | null) => void;
  /** The button's label when nothing is chosen — "Choose a spell". */
  emptyLabel: string;
  title: string;
  searchPlaceholder: string;
  ariaLabel: string;
  id?: string;
  disabled?: boolean;
}>) {
  const [open, setOpen] = useState(false);

  const chosen = entries.find((entry) => entry.id === value) ?? null;

  const { options, facets } = useMemo(() => {
    const hasSrd = entries.some((entry) => entry.origin === "srd");
    const hasHomebrew = entries.some((entry) => entry.origin === "homebrew");
    const both = hasSrd && hasHomebrew;
    // The minority side is the one worth marking. With only one origin present,
    // nothing is marked at all.
    const minority: CatalogEntry["origin"] | null = both
      ? entries.filter((entry) => entry.origin === "homebrew").length <= entries.length / 2
        ? "homebrew"
        : "srd"
      : null;

    const list: ChoiceOption[] = entries.map((entry) => ({
      value: entry.id,
      title: entry.name,
      meta: entry.meta,
      keywords: entry.keywords,
      facet: entry.origin,
      badge:
        minority && entry.origin === minority ? (
          <Badge tone={entry.origin === "srd" ? "info" : "primary"}>{entry.origin === "srd" ? "SRD" : "Homebrew"}</Badge>
        ) : undefined
    }));

    const facetOptions: readonly SegmentedOption[] | undefined = both
      ? [
          { value: "all", label: "All" },
          { value: "srd", label: "SRD" },
          { value: "homebrew", label: "Homebrew" }
        ]
      : undefined;

    return { options: list, facets: facetOptions };
  }, [entries]);

  const [facet, setFacet] = useState("all");

  return (
    <>
      <Button
        variant="secondary"
        id={id}
        className="hb-catalog-trigger"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {chosen ? chosen.name : emptyLabel}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={title} size="md">
        <div className="hb-catalog-grid">
          <ChoiceGrid
            options={options}
            value={value}
            onChange={(next) => {
              onChange(next);
              setOpen(false);
            }}
            ariaLabel={ariaLabel}
            searchable
            searchPlaceholder={searchPlaceholder}
            searchDelay={160}
            facets={facets}
            facetValue={facet}
            onFacetChange={setFacet}
            facetAllValue="all"
            emptyTitle="Nothing matches."
          />
        </div>
        {chosen && (
          <div className="hb-catalog-foot">
            <Button variant="ghost" size="sm" onClick={() => { onChange(null); setOpen(false); }}>
              Clear the choice
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
