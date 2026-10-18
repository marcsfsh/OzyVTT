import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GmOnlyTag, cx } from "@vtt/ui";
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

/**
 * One section: its heading and one-sentence hint over a panel of rows. A GM section is edged in violet with the GM
 * only tag beside its heading, so the GM can tell at a glance that players never see it.
 */
export function SettingsSection({
  id,
  gmOnly,
  children,
  wide = false
}: Readonly<{ id: SettingsSectionId; gmOnly: boolean; children: ReactNode; wide?: boolean }>) {
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === id)!;
  return (
    <section
      className={cx("settings-section", `settings-section--${id}`, wide && "is-wide")}
      aria-labelledby={`settings-${id}-title`}
    >
      <header className="settings-section-head">
        <h2 id={`settings-${id}-title`}>{section.label}</h2>
        {gmOnly && <GmOnlyTag />}
        <p>{section.hint}</p>
      </header>
      <div className={cx("settings-panel", gmOnly && "rim-gm")}>{children}</div>
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
