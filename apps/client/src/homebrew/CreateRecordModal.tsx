/** New homebrew: pick a type, then start blank or duplicate an existing record. Both starting
    points get equal weight (for a class, duplicating is the practical route), and picking
    Duplicate reveals its catalog inline, with no extra wizard step. */

import { useEffect, useId, useMemo, useState } from "react";
import { Badge, Button, ChoiceCard, ChoiceGrid, Field, FieldGrid, Modal, Select, type ChoiceOption } from "@vtt/ui";
import type { HomebrewRecordSummary } from "./api";
import { useDuplicateSources } from "./sources";
import { HOMEBREW_TYPES, isHomebrewType, typeLabel, typePlural, type HomebrewType } from "./types";
import { withArticle } from "@vtt/domain";

type StartingPoint = "blank" | "duplicate";

export type CreateRequest =
  | Readonly<{ mode: "blank"; type: HomebrewType }>
  /** `origin` lets a failure be explained in the right words. `companions` is exactly what the
      note below the grid told the GM would be copied. */
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
  useEffect(() => {
    setSourceId(null);
    setFacet("all");
  }, [type]);

  // Reopening starts clean.
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
    // Badge only the minority origin (info = SRD, primary = Homebrew).
    const minority = !bothPresent ? null : srdCount <= homebrewCount ? "srd" : "homebrew";
    const list: ChoiceOption[] = sources.map((source) => ({
      value: source.id,
      title: source.name,
      facet: source.origin,
      ...(source.meta ? { meta: source.meta } : {}),
      ...(source.keywords ? { keywords: source.keywords } : {}),
      ...(source.origin === minority
        ? {
            badge: (
              <Badge tone={minority === "srd" ? "info" : "primary"}>{minority === "srd" ? "SRD" : "Homebrew"}</Badge>
            )
          }
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

  // One imperative sentence naming the next thing to do.
  const blockedReason =
    start === null
      ? "Choose a starting point."
      : start === "duplicate" && !sourceId
        ? `Choose ${withArticle(typeLabel(type))} to duplicate.`
        : null;

  const chosen = sourceId === null ? undefined : sources.find((candidate) => candidate.id === sourceId);
  /** Shown before the GM commits: a duplicated class's subclass pick points at a family only
      the copy owns, so its subclasses are copied too. */
  const companions = chosen?.companions ?? [];

  const submit = () => {
    if (blockedReason || busy) return;
    if (start === "blank") {
      onCreate({ mode: "blank", type });
      return;
    }
    if (!chosen) return;
    onCreate({
      mode: "duplicate",
      type,
      sourceId: chosen.id,
      sourceName: chosen.name,
      origin: chosen.origin,
      companions
    });
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
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!!blockedReason || busy}
            aria-describedby={blockedReason ? reasonId : undefined}
          >
            {busy ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      <div className="hb-create-body">
        <Field label="Record type" htmlFor={typeFieldId}>
          <Select
            id={typeFieldId}
            value={type}
            onChange={(event) => {
              if (isHomebrewType(event.target.value)) setType(event.target.value);
            }}
          >
            {HOMEBREW_TYPES.map((option) => (
              <option key={option} value={option}>
                {typePlural(option)}
              </option>
            ))}
          </Select>
        </Field>

        {/* A radiogroup, or a screen reader announces "radio, 1 of 1" twice. */}
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
              ariaLabel={`Choose ${withArticle(typeLabel(type))} to duplicate`}
              options={options}
              value={sourceId}
              onChange={setSourceId}
              searchable
              searchPlaceholder={`Search ${typePlural(type).toLowerCase()}…`}
              {...(facets
                ? { facets, facetValue: facet, onFacetChange: setFacet, facetLabel: "Source", facetAllValue: "all" }
                : {})}
              emptyTitle="Nothing to duplicate"
              emptyText={
                type === "spell-list"
                  ? "There's no list to copy from yet. Start from blank, then fill the new list from the SRD lists."
                  : "No SRD or homebrew record matches. Try a different search, or start from blank."
              }
            />
          </div>
        )}

        {companions.length > 0 && (
          <p className="hb-create-note">
            {chosen!.name}'s {companions.length} {companions.length === 1 ? "subclass is" : "subclasses are"} copied
            too, so the copy has something to offer at its subclass level and can be published straight away.
          </p>
        )}

        {blockedReason && (
          <p className="hb-blocked" id={reasonId}>
            {blockedReason}
          </p>
        )}
      </div>
    </Modal>
  );
}
