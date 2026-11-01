import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GmOnlyTag, Group, SaveState, cx } from "@vtt/ui";
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

/** How long a row says Saved after its write succeeds (settings rule 3.2). */
export const SAVED_FOR_MS = 1500;

type SavedFlash = Readonly<{ saved: string | null; touch: (id: string) => void; flashLast: () => void }>;
/** The row the GM last used and the row saying Saved: a table setting's write flashes the row it came from. */
export const SavedFlashContext = createContext<SavedFlash | null>(null);

/** The Saved flash for one section's rows: the last row used says Saved for a moment once its write succeeds. */
function useSavedFlash(): SavedFlash {
  const [saved, setSaved] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(null), SAVED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [saved]);
  const touch = useCallback((id: string) => {
    last.current = id;
  }, []);
  const flashLast = useCallback(() => setSaved(last.current), []);
  return useMemo(() => ({ saved, touch, flashLast }), [saved, touch, flashLast]);
}

/** The Saved flash for the section shown, around the section's component so its writes reach it. */
export function SavedFlashProvider({ children }: Readonly<{ children: ReactNode }>) {
  return <SavedFlashContext.Provider value={useSavedFlash()}>{children}</SavedFlashContext.Provider>;
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
  wide = false,
  grouped = false
}: Readonly<{
  id: SettingsSectionId;
  children: ReactNode;
  wide?: boolean;
  /** The rows come in groups of their own, each with its heading (Encounters' moments). */
  grouped?: boolean;
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
      {grouped ? children : <Group className="settings-panel">{children}</Group>}
    </section>
  );
}

/** One group of a section's rows under its heading in small capitals (Encounters' moments, settings spec 2.3). */
export function SettingsMoment({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="settings-moment-group" aria-label={title}>
      <h3 className="settings-moment">{title}</h3>
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
  hint,
  level = 3
}: Readonly<{
  setting: SettingEntry;
  /** Its heading's level: 4 under a group's own heading. */
  level?: 3 | 4;
  children?: ReactNode;
  stacked?: boolean;
  /** A GM row in a section players also see. */
  gmOnly?: boolean;
  /** In place of the setting's own hint, when the state changes what is true (the GM's reason, say). */
  hint?: string;
}>) {
  const flash = useContext(SavedFlashContext);
  const touch = () => flash?.touch(setting.id);
  const Label = level === 4 ? "h4" : "h3";
  return (
    <div id={settingAnchor(setting.id)} className={cx("setting-row", stacked && "is-stacked")} tabIndex={-1}>
      <div className="setting-text">
        <Label className="setting-label">
          {setting.label}
          {gmOnly && <GmOnlyTag />}
        </Label>
        <p className="setting-hint">{hint ?? setting.hint}</p>
      </div>
      {children !== undefined && (
        // A use of the control marks the row, so the write it sends says Saved here.
        <div className="setting-control" onClickCapture={touch} onChangeCapture={touch} onKeyDownCapture={touch}>
          {children}
          {flash?.saved === setting.id && <SaveState status="saved" className="setting-saved" />}
        </div>
      )}
    </div>
  );
}
