import { useMemo } from "react";
import { IconEyeOff } from "@vtt/ui";
import type { CodexPrepSection } from "@vtt/domain";
import { CodexMarkdown } from "../CodexMarkdown";
import { CodexIcon, EntityIcon } from "../icons";
import { QUEST_STATUS_LABEL } from "../quests";
import { linkLine, type PrepContext } from "./PrepEditor";

/**
 * A session's prep read through on a phone: each section under its title, the text as written, the scenes as cards
 * with their places, and the clues as a checklist to tick. Editing stays one menu item away.
 */
export function PrepReader({
  sections,
  context,
  onTick
}: Readonly<{
  sections: readonly CodexPrepSection[];
  context: PrepContext;
  /** Ticks or unticks one clue in the draft. */
  onTick: (sectionId: string, itemId: string, done: boolean) => void;
}>) {
  const known = useMemo(() => new Set(context.pages.map((page) => page.title.trim().toLowerCase())), [context.pages]);
  if (sections.length === 0)
    return <p className="story-hint">This session has no prep sections yet. Re-apply a template to add some.</p>;
  return (
    <div className="prep-read">
      {sections.map((section) => (
        <section key={section.id} className="prep-read-section" aria-label={section.title}>
          <h3 className="story-eyebrow">{section.title}</h3>
          <SectionRead section={section} context={context} known={known} onTick={onTick} />
        </section>
      ))}
    </div>
  );
}

function Nothing() {
  return <p className="story-hint">Nothing here yet.</p>;
}

function SectionRead({
  section,
  context,
  known,
  onTick
}: Readonly<{
  section: CodexPrepSection;
  context: PrepContext;
  known: ReadonlySet<string>;
  onTick: (sectionId: string, itemId: string, done: boolean) => void;
}>) {
  switch (section.type) {
    case "text":
      return section.text.trim() ? (
        <div className="prep-read-text">
          <CodexMarkdown
            text={section.text}
            token={context.token}
            onNavigate={context.onFollow ?? (() => undefined)}
            knownTitles={known}
          />
        </div>
      ) : (
        <Nothing />
      );
    case "scenes":
      return section.scenes.length === 0 ? (
        <Nothing />
      ) : (
        <ol className="prep-read-scenes">
          {section.scenes.map((scene, index) => {
            const place = context.pages.find((page) => page.id === scene.placePageId)?.title ?? null;
            return (
              <li key={scene.id} className="prep-read-scene">
                <span className="story-eyebrow">Scene {index + 1}</span>
                <span className="prep-row-title">{scene.title || "Untitled scene"}</span>
                {place && (
                  <span className="prep-row-line">
                    <CodexIcon iconId="pin" className="prep-icon" /> {place}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      );
    case "checklist":
      return section.items.length === 0 ? (
        <Nothing />
      ) : (
        <ul className="prep-read-list">
          {section.items.map((item) => (
            <li key={item.id}>
              <label className={`prep-read-check${item.done ? " is-done" : ""}`}>
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={(event) => onTick(section.id, item.id, event.target.checked)}
                />
                <span className="prep-row-text">
                  <span className="prep-row-title">{item.text}</span>
                  {item.link && <span className="prep-row-line">{linkLine(item.link, context)}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      );
    case "pages": {
      const pages = section.pageIds.map((id) => ({ id, page: context.pages.find((each) => each.id === id) }));
      return pages.length === 0 ? (
        <Nothing />
      ) : (
        <ul className="prep-read-list">
          {pages.map(({ id, page }) => (
            <li key={id} className="prep-read-row">
              {page ? <EntityIcon type={page.entityType} /> : <CodexIcon iconId="scroll" className="prep-icon" />}
              <span className="prep-row-title">{page?.title ?? "A deleted page"}</span>
              {page?.revealedToPlayers === false && (
                <span className="story-hiddenword">
                  <IconEyeOff /> Hidden
                </span>
              )}
            </li>
          ))}
        </ul>
      );
    }
    case "clocks":
      return section.deadlineIds.length === 0 ? (
        <Nothing />
      ) : (
        <ul className="prep-read-list">
          {section.deadlineIds.map((id) => {
            const clock = context.deadlines.find((each) => each.id === id);
            return (
              <li key={id} className="prep-read-row">
                <CodexIcon iconId="hourglass" className="prep-icon" />
                <span className="prep-row-text">
                  <span className="prep-row-title">{clock?.text ?? "A deleted deadline"}</span>
                  {clock?.inWorldLabel && <span className="prep-row-line">{clock.inWorldLabel}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      );
    case "quests":
      return section.questIds.length === 0 ? (
        <Nothing />
      ) : (
        <ul className="prep-read-list">
          {section.questIds.map((id) => {
            const quest = context.quests.find((each) => each.id === id);
            return (
              <li key={id} className="prep-read-row">
                <CodexIcon iconId="quest" className="prep-icon" />
                <span className="prep-row-text">
                  <span className="prep-row-title">{quest?.title ?? "A deleted quest"}</span>
                  {quest && <span className="prep-row-line">{QUEST_STATUS_LABEL[quest.status]}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      );
    case "encounters":
      return section.sceneIds.length === 0 ? (
        <Nothing />
      ) : (
        <ul className="prep-read-list">
          {section.sceneIds.map((id) => (
            <li key={id} className="prep-read-row">
              <CodexIcon iconId="battle" className="prep-icon" />
              <span className="prep-row-title">
                {context.scenes.find((scene) => scene.id === id)?.name ?? "A scene no longer at the table"}
              </span>
            </li>
          ))}
        </ul>
      );
  }
}
