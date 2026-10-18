import { useEffect, useId, useMemo, useState } from "react";
import {
  Badge,
  Button,
  ChoiceGrid,
  Field,
  Input,
  Modal,
  SegmentedControl,
  Select,
  useToast,
  type ChoiceOption
} from "@vtt/ui";
import { withArticle } from "@vtt/domain";
import { homebrewApi } from "../homebrew/api";
import { blankDraft } from "../homebrew/defaults";
import { isHomebrewType } from "../homebrew/types";
import { useCompendium, type NewRecordOptions } from "./context";
import { refreshCompendium, useTable } from "./data";
import { KINDS, kindLabel, kindPlural, phoneFacts, type Kind } from "./kinds";
import { recordPath, withTableQuery } from "./routes";
import { useNames } from "./TablesView";

type Start = "blank" | "copy";

/**
 * New homebrew: the kind, where to start (blank, or a copy of an SRD record or one of the table's own) and the name,
 * which comes first so a record's address follows its real name. A copy keeps a link to its source for Compare, and a
 * class's copy brings its subclasses, which the copy's subclass choice names. The new record opens on Edit, a draft
 * only the GM sees.
 */
export function NewRecordDialog({ options, onClose }: Readonly<{ options: NewRecordOptions; onClose: () => void }>) {
  const { token, query, go } = useCompendium();
  const { toast } = useToast();
  const fixed = options.from ?? null;
  const [kind, setKind] = useState<Kind>(options.kind ?? "spell");
  const [start, setStart] = useState<Start>(fixed ? "copy" : "blank");
  const [sourceId, setSourceId] = useState<string | null>(fixed?.id ?? null);
  const [facet, setFacet] = useState("all");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const kindId = useId();
  const table = useTable(token, kind);
  const subclasses = useTable(token, "subclass", kind === "class");
  const names = useNames(token);

  // A pick made in one kind's table means nothing in another's.
  useEffect(() => {
    if (!fixed) setSourceId(null);
  }, [kind, fixed]);

  const rows = useMemo(() => (table.data ?? []).filter((row) => !row.archived), [table.data]);
  const source = rows.find((row) => row.id === sourceId) ?? null;
  const sourceName = fixed?.name ?? source?.name ?? null;
  const companions = useMemo(
    () =>
      kind === "class" && sourceId
        ? (subclasses.data ?? []).filter((row) => row.columns.classId === sourceId && !row.archived)
        : [],
    [kind, sourceId, subclasses.data]
  );
  const choices: ChoiceOption[] = useMemo(
    () =>
      rows.map((row) => ({
        value: row.id,
        title: row.name,
        facet: row.source,
        meta: phoneFacts(kind, row.columns, names) || undefined,
        badge: row.source === "homebrew" ? <Badge tone="primary">Homebrew</Badge> : undefined
      })),
    [rows, kind, names]
  );

  const trimmed = name.trim();
  const reason = !trimmed
    ? `Name the ${kindLabel(kind)} first.`
    : start === "copy" && !sourceId
      ? `Pick the ${kindLabel(kind)} to copy.`
      : null;

  const create = async () => {
    if (reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made =
        start === "copy" && sourceId
          ? await homebrewApi.duplicate(token, sourceId, trimmed)
          : await homebrewApi.create(token, { ...blankDraft(kind), type: kind, name: trimmed });
      const failed: string[] = [];
      for (const companion of companions) {
        try {
          const copy = await homebrewApi.duplicate(token, companion.id, companion.name);
          // The copy's subclass choice names the new class, so each subclass follows it there.
          await homebrewApi.update(token, copy.id, { ...copy.record, classId: made.id }, copy.rev);
        } catch {
          failed.push(companion.name);
        }
      }
      refreshCompendium();
      onClose();
      go(withTableQuery(recordPath(kind, made.id), query, { tab: "edit", new: "1" }));
      const copied = companions.length - failed.length;
      if (failed.length > 0)
        toast(
          `${trimmed} is made, but ${failed.join(" and ")} couldn't be copied. Add a subclass before you publish.`,
          {
            tone: "info"
          }
        );
      else
        toast(
          copied > 0
            ? `${trimmed} is made, with ${copied} ${copied === 1 ? "subclass" : "subclasses"}.`
            : `${trimmed} is made.`,
          {
            tone: "success"
          }
        );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't make that record.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={fixed ? "Make a homebrew copy" : "New homebrew"}
      className="cp-new"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void create()} disabled={!!reason || busy}>
            {busy ? "Making it" : fixed ? "Make the copy" : "Make it"}
          </Button>
        </>
      }
    >
      <form
        className="cp-new-body"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Field label="Name" htmlFor={nameId}>
          <Input
            id={nameId}
            value={name}
            maxLength={120}
            autoFocus
            placeholder={sourceName ? `A new name for your copy of ${sourceName}` : `The ${kindLabel(kind)}'s name`}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        {!fixed && (
          <>
            <Field label="Kind" htmlFor={kindId}>
              <Select
                id={kindId}
                value={kind}
                onChange={(event) => {
                  if (isHomebrewType(event.target.value)) setKind(event.target.value);
                }}
              >
                {KINDS.map((option) => (
                  <option key={option} value={option}>
                    {kindPlural(option)}
                  </option>
                ))}
              </Select>
            </Field>
            <SegmentedControl
              ariaLabel="Start from"
              value={start}
              onChange={(next) => setStart(next as Start)}
              options={[
                { value: "blank", label: "Blank" },
                { value: "copy", label: `A copy of ${withArticle(kindLabel(kind))}` }
              ]}
            />
            {start === "copy" && (
              <div className="cp-new-grid">
                <ChoiceGrid
                  ariaLabel={`The ${kindLabel(kind)} to copy`}
                  options={choices}
                  value={sourceId}
                  onChange={setSourceId}
                  searchable
                  bounded
                  searchPlaceholder={`Find ${kindPlural(kind).toLowerCase()}`}
                  facets={[
                    { value: "all", label: "All" },
                    { value: "srd", label: "SRD" },
                    { value: "homebrew", label: "Homebrew" }
                  ]}
                  facetValue={facet}
                  onFacetChange={setFacet}
                  facetLabel="Source"
                  facetAllValue="all"
                  emptyTitle="Nothing to copy"
                  emptyText={
                    table.data ? "No record matches. Change the search, or start blank." : "Reading the table."
                  }
                />
              </div>
            )}
          </>
        )}
        <ul className="cp-new-notes">
          <li>It starts as a draft only you can see.</li>
          {start === "copy" && sourceName && <li>It keeps a link to {sourceName}, for Compare.</li>}
          {companions.length > 0 && (
            <li>
              {sourceName}'s {companions.length === 1 ? "subclass is" : `${companions.length} subclasses are`} copied
              too, so the copy has one to offer at its subclass level.
            </li>
          )}
        </ul>
        {(error ?? reason) && (
          <p className={error ? "cp-blocked" : "cp-hint"} role={error ? "alert" : undefined}>
            {error ?? reason}
          </p>
        )}
      </form>
    </Modal>
  );
}
