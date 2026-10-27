import type { ContentActionSummary } from "@vtt/domain";
import { Select } from "@vtt/ui";
import type { ShapeChoice } from "./targeting";

type FormOption = NonNullable<ContentActionSummary["forms"]>["options"][number];

/** A Challenge Rating as the stat blocks print it: 1/8, 1/4, 1/2, then whole numbers. */
export function challengeWords(rating: number): string {
  if (rating === 0.125) return "1/8";
  if (rating === 0.25) return "1/4";
  if (rating === 0.5) return "1/2";
  return String(rating);
}

/** A creature type as a picker names the creatures of it ("Fiends", "Undead"). */
export function typePlural(type: string): string {
  const titled = type.charAt(0).toUpperCase() + type.slice(1);
  if (type === "undead" || type === "fey") return titled;
  return type.endsWith("y") ? `${titled.slice(0, -1)}ies` : `${titled}s`;
}

/** One form as a picker lists it: its name, Challenge Rating and size, and whether it flies. */
export function formLabel(option: FormOption): string {
  const size = option.size.charAt(0).toUpperCase() + option.size.slice(1);
  return [
    option.name,
    ...(option.challengeRating !== null ? [`CR ${challengeWords(option.challengeRating)}`] : []),
    size,
    ...(option.fly ? ["flies"] : [])
  ].join(" · ");
}

/**
 * What a shape-shifting use asks before it goes: the form it takes (Wild Shape's Beast, a werewolf's hybrid), or a form
 * for each target when each takes its own (Animal Shapes); whether the user's gear melds into the form or is worn
 * (Wild Shape, Shapechange); and which of its effects it takes (Enlarge or Reduce). The server checks every pick.
 */
export function ShapeChoices({
  action,
  choice,
  targets,
  onForm,
  onGear,
  onOption,
  onWardType
}: Readonly<{
  action: ContentActionSummary;
  choice: ShapeChoice;
  /** The chosen targets, for a form each. */
  targets: ReadonlyArray<Readonly<{ id: string; label: string }>>;
  onForm: (form: string, targetId?: string) => void;
  onGear: (gear: "merged" | "worn") => void;
  onOption: (option: string) => void;
  /** Adds or takes away a creature type a barrier wards. */
  onWardType?: (type: string) => void;
}>) {
  const forms = action.forms;
  const options = action.options ?? [];
  const wardTypes = onWardType ? (action.wardTypes ?? []) : [];
  if (!forms && options.length === 0 && wardTypes.length === 0) return null;
  const formSelect = (value: string | undefined, label: string, targetId?: string) => (
    <label className="action-damage-type" key={targetId ?? "form"}>
      <span>{label}</span>
      <Select value={value ?? ""} onChange={(event) => onForm(event.target.value, targetId)}>
        {value === undefined && <option value="">Choose a form</option>}
        {forms!.options.map((option) => (
          <option key={option.id} value={option.id}>
            {formLabel(option)}
          </option>
        ))}
      </Select>
    </label>
  );
  return (
    <>
      {forms && forms.options.length === 0 && (
        <p className="action-targeting-hint">
          {forms.learnable ? "Choose its known forms on the Features tab first." : "No form fits it now."}
        </p>
      )}
      {forms &&
        forms.options.length > 0 &&
        (forms.perTarget
          ? targets.length === 0
            ? [
                <p key="first" className="action-targeting-hint">
                  Choose the targets first, then a form for each.
                </p>
              ]
            : targets.map((target) =>
                formSelect(choice.targetForms?.[target.id], `Form for ${target.label}`, target.id)
              )
          : formSelect(choice.form, "Form"))}
      {forms?.gearChoice && (
        <label className="action-damage-type">
          <span>Gear</span>
          <Select value={choice.gear ?? "merged"} onChange={(event) => onGear(event.target.value as "merged" | "worn")}>
            <option value="merged">Melds into the form</option>
            <option value="worn">Stays worn and works</option>
          </Select>
        </label>
      )}
      {wardTypes.length > 0 && (
        <fieldset className="action-condition-picks">
          <legend>Wards against{(choice.creatureTypes ?? []).length === 0 ? " every type below" : ""}</legend>
          <ul className="action-target-list">
            {wardTypes.map((type) => {
              const picked = choice.creatureTypes?.includes(type) ?? false;
              return (
                <li key={type}>
                  <label className={`action-target${picked ? " is-picked" : ""}`}>
                    <input type="checkbox" checked={picked} onChange={() => onWardType!(type)} />
                    <span>{typePlural(type)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      {options.length > 0 && (
        <label className="action-damage-type">
          <span>Effect</span>
          <Select value={choice.option ?? options[0]!.id} onChange={(event) => onOption(event.target.value)}>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </label>
      )}
    </>
  );
}
