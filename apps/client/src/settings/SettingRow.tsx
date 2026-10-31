import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GmOnlyTag, Group, cx } from "@vtt/ui";
import { SETTINGS_SECTIONS, settingAnchor, type SettingEntry, type SettingsSectionId } from "./sections";

/**
 * The bar's slot for the view's one primary action. A section renders `SettingsPrimary` and its button lands at the
 * right end of the section bar on a laptop, or in the phone's top bar, so the primary is always in the same place.
 */
export const PrimarySlot = createContext<HTMLElement | null>(null);

export function SettingsPrimary({ children }: Readonly<{ children: ReactNode }>) {
  const slot = useContext(PrimarySlot);
  return slot ? createPortal(children, slot) : null;
}

/** What the section shown holds now ("Enforce · six checks · hits applied by the GM"), for its head (ADR-0071). */
export const SectionLine = createContext<string | undefined>(undefined);

/**
 * One section: its head (the name in display capitals, its one-sentence hint and what it holds now) over its rows in
 * one Cradle group (ADR-0048). A player never sees a GM section, so a GM section's head carries no GM only tag
 * (settings rule 3.3); a GM row inside a section players see keeps it.
 */
export function SettingsSection({
  id,
  children,
  wide = false
}: Readonly<{
  id: SettingsSectionId;
  children: ReactNode;
  wide?: boolean;
}>) {
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === id)!;
  const line = useContext(SectionLine);
  return (
    <section
      className={cx("settings-section", `settings-section--${id}`, wide && "is-wide")}
      aria-labelledby={`settings-${id}-title`}
    >
      <header className="settings-head">
        <h2 id={`settings-${id}-title`} className="settings-head-title">
          {section.label}
        </h2>
        <p className="settings-section-line">{section.hint}</p>
        {line && <p className="settings-head-now">{line}</p>}
      </header>
      <Group className="settings-panel">{children}</Group>
    </section>
  );
}

/**
 * One setting: its plain label and a sentence of hint, from `sections.ts`, and its control at the right (under the
 * words on a phone). `stacked` puts a control that needs the width under the words at every size. The row carries
 * the setting's anchor, so the search can bring it into view.
 */
export function SettingRow({
  setting,
  children,
  stacked = false,
  gmOnly = false,
  hint
}: Readonly<{
  setting: SettingEntry;
  children?: ReactNode;
  stacked?: boolean;
  /** A GM row in a section players also see. */
  gmOnly?: boolean;
  /** In place of the setting's own hint, when the state changes what is true (the GM's reason, say). */
  hint?: string;
}>) {
  return (
    <div id={settingAnchor(setting.id)} className={cx("setting-row", stacked && "is-stacked")} tabIndex={-1}>
      <div className="setting-text">
        <h3 className="setting-label">
          {setting.label}
          {gmOnly && <GmOnlyTag />}
        </h3>
        <p className="setting-hint">{hint ?? setting.hint}</p>
      </div>
      {children !== undefined && <div className="setting-control">{children}</div>}
    </div>
  );
}
