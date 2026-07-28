/**
 * New homebrew — two questions on one surface, not a wizard.
 *
 *   1. What are you making?  (a `Select` over the nine types — the SAME control as the
 *      rail's type filter, because it is the same concept: type is a field.)
 *   2. Where does it start from?  (two EQUALLY weighted `ChoiceCard`s.)
 *
 * The two starting points get equal visual weight, equal copy length and the same
 * control, because duplicating an SRD record is not a lesser route — for a class it is
 * the only tractable one. Picking Duplicate reveals its catalog inline, below, rather
 * than pushing a second step: a two-step wizard for two questions is ceremony.
 *
 * `size="md"` on purpose. At 375px that is a 343px sheet holding a select, two stacked
 * cards, a search box and a scrolling card list — a normal mobile sheet. `size="full"`
 * would cap at 72rem on a laptop and need a narrow inner column inside wide chrome,
 * which reads as a mistake.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { Badge, Button, ChoiceCard, ChoiceGrid, Field, FieldGrid, Modal, Select, type ChoiceOption } from "@vtt/ui";
import type { HomebrewRecordSummary } from "./api";
import { useDuplicateSources } from "./sources";
import { HOMEBREW_TYPES, isHomebrewType, typeLabel, typePlural, type HomebrewType } from "./types";

type StartingPoint = "blank" | "duplicate";

export type CreateRequest =
  | Readonly<{ mode: "blank"; type: HomebrewType }>
  /** `origin` is carried so a failure can be explained in the right words: copying a
      bundled SRD record and copying your own are the same call to the same endpoint.
      `companions` is what the sentence below the grid PROMISES — the modal computes it,
      says it, and sends it, so the thing the GM was told is the thing that happens. */
  | Readonly<{
      mode: "duplicate";
      type: HomebrewType;
      sourceId: string;
      sourceName: string;
      origin: "srd" | "homebrew";
      companions: ReadonlyArray<Readonly<{ id: string; name: string }>>;
    }>;

export function CreateRecordModal({
  open,
  onClose,
  onCreate,
  records,
  busy
}: Readonly<{
  open: boolean;
  onClose: () => void;
  onCreate: (request: CreateRequest) => void;
  records: readonly HomebrewRecordSummary[];
  busy: boolean;
}>) {
  const [type, setType] = useState<HomebrewType>("spell");
  const [start, setStart] = useState<StartingPoint | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [facet, setFacet] = useState("all");
  const typeFieldId = useId();
  const reasonId = useId();

  const sources = useDuplicateSources(start === "duplicate" ? type : null, records);

  // Changing the type invalidates a pick made against the previous type's catalog.
  // Derived, not stored: nothing to reconcile later.
  useEffect(() => {
    setSourceId(null);
    setFacet("all");
  }, [type]);

  // Reopening starts clean. A modal that remembers the last half-finished answer is
  // the "did I already pick that?" bug.
  useEffect(() => {
    if (!open) return;
    setStart(null);
    setSourceId(null);
    setFacet("all");
  }, [open]);

  const { options, facets } = useMemo(() => {
    const srdCount = sources.filter((source) => source.origin === "srd").length;
    const homebrewCount = sources.length - srdCount;
    const bothPresent = srdCount > 0 && homebrewCount > 0;
    // Badge the EXCEPTION, not the rule: a badge every card carries distinguishes
    // nothing and costs ~46px out of the title row at 375px. Only the minority side
    // is marked, and the tones are the fixed pair (info = SRD, primary = Homebrew).
    const minority = !bothPresent ? null : srdCount <= homebrewCount ? "srd" : "homebrew";
    const list: ChoiceOption[] = sources.map((source) => ({
      value: source.id,
      title: source.name,
      facet: source.origin,
      ...(source.meta ? { meta: source.meta } : {}),
      ...(source.keywords ? { keywords: source.keywords } : {}),
      ...(source.origin === minority
        ? { badge: <Badge tone={minority === "srd" ? "info" : "primary"}>{minority === "srd" ? "SRD" : "Homebrew"}</Badge> }
        : {})
    }));
    return {
      options: list,
      facets: bothPresent
        ? ([
            { value: "all", label: "All" },
            { value: "srd", label: "SRD" },
            { value: "homebrew", label: "Homebrew" }
          ] as const)
        : null
    };
  }, [sources]);

  // ONE sentence slot, the same shape as a publish blocker: an imperative naming the
  // next thing to do, never a boolean and never a list.
  const blockedReason =
    start === null
      ? "Choose a starting point."
      : start === "duplicate" && !sourceId
        ? `Choose a ${typeLabel(type)} to duplicate.`
        : null;

  const chosen = sourceId === null ? undefined : sources.find((candidate) => candidate.id === sourceId);
  /**
   * The consequence of THIS pick, stated before the GM commits rather than as an error
   * afterwards. A duplicated class's subclass pick points at a family only the copy owns,
   * which matches nothing until a subclass names the copy — so the copy takes them.
   * Rendered only when there is something to say; a class with no subclasses says nothing.
   */
  const companions = chosen?.companions ?? [];

  const submit = () => {
    if (blockedReason || busy) return;
    if (start === "blank") {
      onCreate({ mode: "blank", type });
      return;
    }
    if (!chosen) return;
    onCreate({ mode: "duplicate", type, sourceId: chosen.id, sourceName: chosen.name, origin: chosen.origin, companions });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="New homebrew"
      ariaLabel="New homebrew"
      className="hb-create"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!!blockedReason || busy} aria-describedby={blockedReason ? reasonId : undefined}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      <div className="hb-create-body">
        <Field label="What are you making?" htmlFor={typeFieldId}>
          <Select
            id={typeFieldId}
            value={type}
            onChange={(event) => {
              if (isHomebrewType(event.target.value)) setType(event.target.value);
            }}
          >
            {HOMEBREW_TYPES.map((option) => (
              <option key={option} value={option}>{typePlural(option)}</option>
            ))}
          </Select>
        </Field>

        {/* Two loose radios need a group, or a screen reader gets "radio, 1 of 1" twice. */}
        <div role="radiogroup" aria-label="Starting point">
          <FieldGrid min="16rem">
            <ChoiceCard
              selected={start === "blank"}
              onSelect={() => setStart("blank")}
              selectionRole="radio"
              title="Start from blank"
              description={`An empty ${typeLabel(type)} you fill in yourself.`}
            />
            <ChoiceCard
              selected={start === "duplicate"}
              onSelect={() => setStart("duplicate")}
              selectionRole="radio"
              title={`Duplicate an existing ${typeLabel(type)}`}
              description={`Copy an SRD or homebrew ${typeLabel(type)} and change what you need.`}
            />
          </FieldGrid>
        </div>

        {start === "duplicate" && (
          <div className="hb-create-grid">
            <ChoiceGrid
              ariaLabel={`Choose a ${typeLabel(type)} to duplicate`}
              options={options}
              value={sourceId}
              onChange={setSourceId}
              searchable
              searchPlaceholder={`Search ${typePlural(type).toLowerCase()}…`}
              {...(facets ? { facets, facetValue: facet, onFacetChange: setFacet, facetLabel: "Source", facetAllValue: "all" } : {})}
              emptyTitle="Nothing to duplicate"
              emptyText={
                type === "spell-list"
                  ? "There's no list to copy from yet. Start from blank — you can build a list from the SRD lists once it exists."
                  : "No SRD or homebrew record matches. Try a different search, or start from blank."
              }
            />
          </div>
        )}

        {/* Not a warning and not an error — a fact about what Create is about to do, in
            the quiet note register, sitting directly under the grid it is about. */}
        {companions.length > 0 && (
          <p className="hb-create-note">
            {chosen!.name}&rsquo;s {companions.length} {companions.length === 1 ? "subclass is" : "subclasses are"} copied too, so the
            copy has something to offer at its subclass level and can be published straight away.
          </p>
        )}

        {/* The reason lives in exactly ONE place: beside the action it blocks. */}
        {blockedReason && <p className="hb-blocked" id={reasonId}>{blockedReason}</p>}
      </div>
    </Modal>
  );
}
