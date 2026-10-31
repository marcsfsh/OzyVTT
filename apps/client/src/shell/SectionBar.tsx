import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Tabs } from "@vtt/ui";
import { useMediaQuery } from "../lib/useMediaQuery";
import "./section-bar.css";

/** Where a page puts its section's primary (or another control of the bar's end) from inside the page. */
const SectionBarEnd = createContext<HTMLElement | null>(null);

/** Puts what a page passes at the right end of its section's bar, or in the phone's header row. */
export function SectionBarSlot({ children }: Readonly<{ children: ReactNode }>) {
  const target = useContext(SectionBarEnd);
  return target ? createPortal(children, target) : null;
}

export type SectionPage = Readonly<{ id: string; label: string }>;

/**
 * The Titled section bar (theme spec 2.1, ADR-0048), one for every section with pages: Prep, the Codex, the
 * Compendium and Settings. On a laptop: the section's name, a divider, its pages as words with the horizon ink on the
 * bar's line, then its search and its primary at the right end. On a phone: a header row with the name and up to two
 * icons, then the pages as one strip of words that scrolls sideways with a fade. No icons on the pages. A page passes
 * its primary into the end through `SectionBarSlot`.
 */
export function SectionBar({
  name,
  pages,
  activeId,
  onChange,
  navLabel,
  pagesLabel,
  search,
  end,
  phoneIcons,
  phoneHead,
  panel,
  phoneHidden = false,
  children
}: Readonly<{
  name: string;
  pages: readonly SectionPage[];
  /** The page lit, or "" when the place shown is none of the pages (a record's own page). */
  activeId: string;
  onChange: (id: string) => void;
  /** The landmark's name ("Codex sections"). */
  navLabel: string;
  /** The tab list's name ("Codex pages"); the landmark's name when absent. */
  pagesLabel?: string;
  /** The section's search, at the right end on a laptop. */
  search?: ReactNode;
  /** Controls at the bar's end after the search: the primary, the Rules button. */
  end?: ReactNode;
  /** Up to two icon buttons in the phone's header row (search, and the primary as an icon). */
  phoneIcons?: ReactNode;
  /** In place of the phone header's name and icons: a section whose pages fill the header themselves (a record's
   *  Back). */
  phoneHead?: ReactNode;
  /** What the chosen page shows, for the tabs' fade on a change. */
  panel?: () => Element | null | undefined;
  /** A record on a phone, whose own header is Back and where it goes, with no strip (rule 12). */
  phoneHidden?: boolean;
  /** The page, which can reach the bar's end through `SectionBarSlot`. */
  children: ReactNode;
}>) {
  // The phone shell's width (`PHONE_SHELL_QUERY` in AppBar.tsx): the bottom tabs below it, the bar above.
  const phone = useMediaQuery("(max-width: 760px)");
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const tabs = (
    <nav className="secbar-nav" aria-label={navLabel}>
      <Tabs
        className="secbar-tabs"
        ariaLabel={pagesLabel ?? navLabel}
        activeId={activeId}
        onChange={onChange}
        tabs={pages.map((page) => ({ id: page.id, label: page.label }))}
        {...(panel ? { panel } : {})}
      />
    </nav>
  );
  return (
    <SectionBarEnd.Provider value={slot}>
      {phone && phoneHidden ? null : phone ? (
        <div className="secbar-phone">
          <header className="secbar-head" data-horizon="">
            {phoneHead ?? (
              <>
                <h1 className="secbar-name">{name}</h1>
                <span className="secbar-icons">
                  <span className="secbar-slot" ref={setSlot} />
                  {phoneIcons}
                </span>
              </>
            )}
          </header>
          {tabs}
        </div>
      ) : (
        <div className="secbar">
          <h1 className="secbar-name">{name}</h1>
          <span className="secbar-divider" aria-hidden="true" />
          {tabs}
          <span className="secbar-grow" />
          {search}
          {end}
          <span className="secbar-slot" ref={setSlot} />
        </div>
      )}
      {children}
    </SectionBarEnd.Provider>
  );
}

/**
 * A phone's header row for a page with no bar of its own (frame spec 2.2, T rule 12): its title at 18px and up to two
 * icons, the page's own. Nothing on a laptop, where the top bar and the section bar stand above the page.
 */
export function PhoneHeader({ title, icons }: Readonly<{ title: string; icons?: ReactNode }>) {
  const phone = useMediaQuery("(max-width: 760px)");
  if (!phone) return null;
  return (
    <header className="secbar-head phone-head" data-horizon="">
      <h1 className="secbar-name">{title}</h1>
      {icons && <span className="secbar-icons">{icons}</span>}
    </header>
  );
}
