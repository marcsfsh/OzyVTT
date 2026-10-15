import { Fragment, useState } from "react";
import type { ActorDefinition } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { newId } from "../lib/ids";
import { slugify } from "./format";
import type { SheetEdit } from "./useSheetEdit";

/**
 * One draft row per class the character has. `id` is sticky: retyping a loaded row's name edits
 * that class rather than minting another; a new row gets an id slugified from its name on save.
 * `hitDie` is carried untouched so the multiclass Hit Dice pool survives an identity edit.
 */
type ClassDraft = {
  key: string;
  id: string | null;
  name: string;
  subclass: string;
  level: number;
  hitDie?: "d4" | "d6" | "d8" | "d10" | "d12";
};
const blankClassDraft = (): ClassDraft => ({ key: newId(), id: null, name: "", subclass: "", level: 1 });

/** Light hand-edit of a character's classes, race and background (owner and GM, server-enforced). */
export function SheetIdentityEditor({
  actorId,
  definition,
  busy,
  edit,
  onEdited,
  onDone
}: Readonly<{
  actorId: string;
  definition: ActorDefinition;
  busy: boolean;
  edit: SheetEdit;
  /** Shows the edited definition before the server's broadcast arrives. */
  onEdited: (next: ActorDefinition) => void;
  onDone: () => void;
}>) {
  const character = definition.character;
  const [idDraft, setIdDraft] = useState<{ classes: ClassDraft[]; race: string; background: string }>(() => {
    const rows = (character?.classes ?? []).map((klass, index) => ({
      key: `${klass.id}-${index}`,
      id: klass.id,
      name: klass.name,
      subclass: klass.subclass?.name ?? "",
      level: klass.level,
      hitDie: klass.hitDie
    }));
    return {
      classes: rows.length > 0 ? rows : [blankClassDraft()],
      race: character?.race?.name ?? "",
      background: character?.background?.name ?? ""
    };
  });
  const editClassDraft = (key: string, patch: Partial<ClassDraft>) =>
    setIdDraft((draft) => ({
      ...draft,
      classes: draft.classes.map((row) => (row.key === key ? { ...row, ...patch } : row))
    }));
  const saveIdentity = () => {
    const classes = idDraft.classes
      .filter((row) => row.name.trim().length > 0)
      .map((row) => ({
        id: row.id ?? slugify(row.name),
        name: row.name.trim(),
        ...(row.subclass.trim() ? { subclass: { id: slugify(row.subclass), name: row.subclass.trim() } } : {}),
        level: row.level,
        ...(row.hitDie ? { hitDie: row.hitDie } : {})
        // The server merges rows by class id, so of two rows resolving to the same id only the first ships.
      }))
      .filter((row, index, rows) => rows.findIndex((other) => other.id === row.id) === index);
    const next = {
      classes,
      feats: character?.feats ? [...character.feats] : [],
      ...(idDraft.race.trim() ? { race: { id: slugify(idDraft.race), name: idDraft.race.trim() } } : {}),
      ...(idDraft.background.trim()
        ? { background: { id: slugify(idDraft.background), name: idDraft.background.trim() } }
        : {})
    };
    // Spread over the stored identity to mirror the server's carry-forward merge (the `choices` ledger stays).
    onEdited({ ...definition, character: { ...character, ...next } });
    void edit("character:set-identity", { actorId, character: next }).then((result) => {
      if (result.ok) onDone();
    });
  };
  return (
    <div className="sheet-editor sheet-id-editor">
      {/* Every class gets its own Class/Subclass/Level trio, so saving never drops a class the form
              did not render. */}
      {idDraft.classes.map((row, index) => {
        const n = idDraft.classes.length > 1 ? ` ${index + 1}` : "";
        return (
          <Fragment key={row.key}>
            <label>
              Class{n}
              <input
                type="text"
                value={row.name}
                maxLength={60}
                onChange={(event) => editClassDraft(row.key, { name: event.target.value })}
              />
            </label>
            <label>
              Subclass{n}
              <input
                type="text"
                value={row.subclass}
                maxLength={60}
                onChange={(event) => editClassDraft(row.key, { subclass: event.target.value })}
              />
            </label>
            <label>
              Level{n}
              <input
                type="number"
                min="1"
                max="20"
                value={row.level}
                onChange={(event) =>
                  editClassDraft(row.key, {
                    level: Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1)))
                  })
                }
              />
            </label>
          </Fragment>
        );
      })}
      {/* The schema allows up to four classes; removing one is a respec, which the builder owns. */}
      {idDraft.classes.length < 4 && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setIdDraft((draft) => ({ ...draft, classes: [...draft.classes, blankClassDraft()] }))}
        >
          Add a class
        </Button>
      )}
      <label>
        Race
        <input
          type="text"
          value={idDraft.race}
          maxLength={60}
          onChange={(event) => setIdDraft((draft) => ({ ...draft, race: event.target.value }))}
        />
      </label>
      <label>
        Background
        <input
          type="text"
          value={idDraft.background}
          maxLength={60}
          onChange={(event) => setIdDraft((draft) => ({ ...draft, background: event.target.value }))}
        />
      </label>
      <Button size="sm" disabled={busy} onClick={saveIdentity}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </div>
  );
}
