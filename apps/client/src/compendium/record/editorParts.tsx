import { FeatureEditor } from "../../homebrew/FeatureEditor";
import type { CustomRenderer } from "../../homebrew/FieldRenderer";
import { LevelTableEditor } from "../../homebrew/LevelTableEditor";
import { ITEM_RIDERS, RiderEditor } from "../../homebrew/RiderEditor";
import { SpellListContents, type SpellMembership } from "../../homebrew/SpellListContents";
import type { HomebrewType } from "../../homebrew/types";

/**
 * The editor's bespoke parts, which the schema names by key and every other field leaves to data: a class's level
 * table, a list of features, the riders an item or a monster carries, and a spell list's contents.
 */
export function editorParts(
  type: HomebrewType,
  recordId: string,
  spells: readonly SpellMembership[]
): Readonly<Record<string, CustomRenderer>> {
  return {
    levelTable: ({ draft, onDraft }) => <LevelTableEditor draft={draft} onDraft={onDraft} classId={recordId} />,
    features: ({ field, draft, onDraft, ctx }) => (
      <FeatureEditor
        draft={draft}
        onDraft={onDraft}
        ctx={ctx}
        featuresKey={field.key}
        // Only class and subclass place a feature at a level.
        levelAware={type === "class" || type === "subclass"}
        // A feat is one `FeatureRecord` under a singular `feature` key.
        single={type === "feat"}
        singular={type === "species" ? "trait" : "feature"}
        idPrefix={`hb-${type}`}
      />
    ),
    riders: ({ draft, onDraft, ctx }) => (
      <RiderEditor
        value={draft}
        onChange={onDraft}
        // An item gets every rider but `choice` (items never prompt at character creation), a monster its actions.
        enabled={type === "equipment" ? ITEM_RIDERS : type === "monster" ? ["actions", "tags"] : undefined}
        // A monster attack takes a flat bonus where a feature names an ability.
        scope={type === "equipment" ? "item" : type === "monster" ? "statblock" : "feature"}
        ctx={ctx}
        idPrefix={`hb-${type}`}
      />
    ),
    spellListContents: ({ draft, onDraft, ctx }) => (
      <SpellListContents draft={draft} onDraft={onDraft} ctx={ctx} listId={recordId} spells={spells} />
    )
  };
}
