import { useState } from "react";
import type { ContentActionSummary } from "@vtt/domain";
import { Button, useToast } from "@vtt/ui";
import { formLabel } from "../encounter/ShapeChoices";
import { command } from "../lib/command";

type Forms = NonNullable<ContentActionSummary["forms"]>;

/**
 * The Beasts a Druid knows for Wild Shape: the forms it has, and the ones it may learn at its level, picked up to the
 * number its level allows. After a Long Rest it may replace one; the GM may change any of them. The server checks the
 * picks and says why one is refused. Keyed by the forms known, so a change from the server starts the picks afresh.
 */
export function KnownForms({
  actorId,
  role,
  name,
  forms,
  known
}: Readonly<{
  actorId: string;
  role: "gm" | "player";
  /** The action's name ("Wild Shape"). */
  name: string;
  forms: Forms;
  /** The ids of the forms it knows now. */
  known: readonly string[];
}>) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<readonly string[]>(known);
  const [busy, setBusy] = useState(false);
  const limit = forms.knownLimit ?? known.length;
  const learnable = forms.learnable ?? [];
  const byId = new Map([...learnable, ...forms.options].map((option) => [option.id, option]));
  const full = picked.length >= limit;
  const flip = (id: string) =>
    setPicked((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
  const save = () => {
    setBusy(true);
    void command("character:set-known-forms", { actorId, formIds: [...picked] }).then((response) => {
      setBusy(false);
      if (!response.ok) toast(response.message ?? "The forms could not be saved.", { tone: "error" });
      else setEditing(false);
    });
  };
  const hint =
    role === "gm"
      ? "As the GM you may change any of them."
      : known.length < limit
        ? `Choose ${limit - known.length} more.`
        : forms.swapOpen
          ? "After this Long Rest you may replace one."
          : "You may replace one after a Long Rest.";
  return (
    <section className="cs-group cs-known-forms" aria-label={`${name} forms`}>
      <span className="cs-eyebrow">
        {name} forms · {known.length} of {limit} known
      </span>
      {known.length > 0 ? (
        <ul className="cs-known-forms-list">
          {known.map((id) => (
            <li key={id}>{byId.has(id) ? formLabel(byId.get(id)!) : id}</li>
          ))}
        </ul>
      ) : (
        <p className="cs-note">No forms known yet. Choose them before using {name}.</p>
      )}
      {editing ? (
        <>
          <p className="cs-note">{hint}</p>
          <ul className="cs-known-forms-pick scroll-y" aria-label="Forms to learn">
            {learnable.map((option) => (
              <li key={option.id}>
                <label className={`cs-known-form${picked.includes(option.id) ? " is-picked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={picked.includes(option.id)}
                    disabled={busy || (full && !picked.includes(option.id))}
                    onChange={() => flip(option.id)}
                  />
                  <span>{formLabel(option)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="cs-known-forms-buttons">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPicked(known);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button disabled={busy || picked.length === 0} onClick={save}>
              Save forms
            </Button>
          </div>
        </>
      ) : (
        <Button variant="secondary" onClick={() => setEditing(true)}>
          {known.length === 0 ? "Choose forms" : "Change forms"}
        </Button>
      )}
    </section>
  );
}
