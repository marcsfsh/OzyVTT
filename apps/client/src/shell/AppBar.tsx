import { useRef, type ReactNode } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import {
  IconButton,
  ThemeSwitch,
  IconCog,
  IconDie,
  IconList,
  IconLog,
  IconPage,
  IconScene,
  IconUser,
  Tabs,
  Wordmark,
  cx,
  useOnChange,
  StatusLamp
} from "@vtt/ui";
import { useMediaQuery } from "../lib/useMediaQuery";
import {
  GM_SECTIONS,
  PLAYER_LOG_PATH,
  PREP_PAGES,
  lastLocationForSection,
  lastLocationForTab,
  litGmSection,
  litPlayerSection,
  navigate,
  pathForGmTab,
  prepPageFor,
  useRoute,
  type GmSection,
  type PlayerSection
} from "../router";
import { LiveScenePicker } from "../table/LiveScenePicker";
import { PlayerIdentity } from "../table/PlayerIdentity";
import { TvControl } from "../table/TvControl";
import { pageLight } from "./pageLight";
import { tabTrip } from "./tabLight";
import { SearchLauncher } from "./SearchLauncher";
import { FrameMenu } from "./FrameMenu";
import { LiveChip, myTurnNow } from "./LiveChip";
import { SectionBar, SectionBarSlot } from "./SectionBar";
import "./app-bar.css";

/** The phone layout's width, from the breakpoint ladder: bottom tabs below it, the top bar's sections above. */
export const PHONE_SHELL_QUERY = "(max-width: 760px)";
export const usePhoneShell = () => useMediaQuery(PHONE_SHELL_QUERY);

const GM_SECTION_ICONS: Readonly<Record<GmSection, ReactNode>> = {
  play: <IconDie />,
  prep: <IconScene />,
  codex: <IconPage />,
  compendium: <IconList />
};

/** Goes to a GM section: a tap on the current one goes to its front page, another returns to where the GM was in it. */
function openGmSection(section: GmSection, current: GmSection | null) {
  const home = GM_SECTIONS.find((entry) => entry.id === section)!.path;
  if (section === current) {
    void navigate(home);
    return;
  }
  void navigate(lastLocationForSection(section) ?? home);
}

/**
 * The sections as a tab bar: the top bar's on a laptop, the bottom tabs on a phone. One name, so each is "the" bar.
 * A change of section runs its light along the horizon (`pageLight`); a phone's bottom tabs carry their ink on top.
 */
function SectionTabs({
  ariaLabel,
  tabs,
  activeId,
  onChange,
  bottom
}: Readonly<{
  ariaLabel: string;
  tabs: ReadonlyArray<Readonly<{ id: string; label: string; icon?: ReactNode; live?: "live" | "mine" }>>;
  activeId: string | null;
  onChange: (id: string) => void;
  bottom: boolean;
}>) {
  return (
    <Tabs
      className={bottom ? "app-bottom-tabs" : "app-sections"}
      ariaLabel={ariaLabel}
      // No tab lights for a utility page (Settings, the table screen controls): `activeId` names none of them.
      activeId={activeId ?? ""}
      onChange={onChange}
      inkEdge={bottom ? "top" : "bottom"}
      onTravel={pageLight}
      onHorizon={!bottom}
      tabs={tabs.map((tab) => ({
        id: tab.id,
        label: bottom ? (
          <span className="app-bottom-tab">
            <span className="app-bottom-tab-icon" aria-hidden="true">
              {tab.icon}
              {tab.live && <StatusLamp lit className={cx("app-bottom-tab-lamp", tab.live === "mine" && "is-mine")} />}
            </span>
            {tab.label}
            {tab.live && <span className="nh-sr-only">{tab.live === "mine" ? ", your turn" : ", live"}</span>}
          </span>
        ) : (
          tab.label
        )
      }))}
    />
  );
}

/**
 * New Codex pages for a player (ADR-0045, group 7): when the count of new ones rises, light runs along the section
 * strip from the section showing to Codex and bursts there. `strip` names the strip's class: the laptop's top bar or
 * the phone's bottom tabs.
 */
function useCodexNews(unread: number, strip: "app-sections" | "app-bottom-tabs") {
  useOnChange(unread, (before, now) => {
    if (now <= before) return;
    const bar = document.querySelector<HTMLElement>(`.${strip}`);
    const tabs = bar ? [...bar.querySelectorAll<HTMLElement>("[role='tab']")] : [];
    const codex = tabs.find((tab) => tab.textContent?.trim().startsWith("Codex"));
    if (!bar || !codex) return;
    const from = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ?? null;
    tabTrip(bar, from, codex, strip === "app-bottom-tabs" ? "top" : "bottom");
  });
}

/** The top bar's frame: the wordmark, what goes in it, and the horizon line along its bottom edge. */
function TopBar({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <header className={cx("app-bar", className)} data-horizon="">
      <Wordmark variant="cabinet" className="app-bar-mark" />
      {children}
    </header>
  );
}

function SettingsButton() {
  return (
    <IconButton label="Settings" className="app-bar-icon" onClick={() => void navigate("/settings")}>
      <IconCog />
    </IconButton>
  );
}

/**
 * The GM's top bar (frame spec 2.1). On a laptop: the wordmark, Play, Prep, Codex and Compendium, then search and the
 * one menu, which holds who is here, the table screen, the theme, Settings and Sign out. On a phone the sections are
 * the bottom tabs, so the bar keeps the utilities alone until More takes them.
 */
export function GmTopBar({
  state,
  token,
  onSignOut
}: Readonly<{ state: GmView; token: string; onSignOut: () => void }>) {
  const route = useRoute();
  const phone = usePhoneShell();
  const section = litGmSection(route.path);
  // On a phone the top bar belongs to the page on screen, and Play's strip is its own header.
  if (phone && section === "play") return null;
  return (
    <TopBar className="app-bar--gm">
      {!phone && (
        <SectionTabs
          ariaLabel="GM sections"
          tabs={GM_SECTIONS}
          activeId={section}
          onChange={(id) => openGmSection(id as GmSection, section)}
          bottom={false}
        />
      )}
      {!phone && (section === "play" ? <LiveScenePicker state={state} chip /> : <LiveChip role="gm" state={state} />)}
      <span className="app-bar-grow" />
      {phone && <TvControl gmToken={token} state={state} compact />}
      <SearchLauncher
        role="gm"
        route={route}
        sections={[
          ...GM_SECTIONS.map((entry) => ({ label: entry.label, path: entry.path })),
          ...PREP_PAGES.filter((page) => page.id !== "scenes").map((page) => ({
            label: `Prep · ${page.label}`,
            path: page.path
          })),
          { label: "Table screen", path: pathForGmTab("viewer") },
          { label: "Settings", path: "/settings" }
        ]}
      />
      {phone ? (
        <>
          <ThemeSwitch className="app-bar-theme" />
          <SettingsButton />
        </>
      ) : (
        <FrameMenu role="gm" state={state} token={token} onSignOut={onSignOut} />
      )}
    </TopBar>
  );
}

/** The GM's sections as the phone's bottom tabs. */
export function GmBottomTabs({ state }: Readonly<{ state?: GmView }>) {
  const route = useRoute();
  const section = litGmSection(route.path);
  // While a fight runs, Play carries a lit lamp (frame rule 3.2).
  const fighting = state?.combat.active === true;
  return (
    <SectionTabs
      ariaLabel="GM sections"
      tabs={GM_SECTIONS.map((entry) => ({
        ...entry,
        icon: GM_SECTION_ICONS[entry.id],
        ...(entry.id === "play" && fighting ? { live: "live" as const } : {})
      }))}
      activeId={section}
      onChange={(id) => openGmSection(id as GmSection, section)}
      bottom
    />
  );
}

const PLAYER_SECTIONS: ReadonlyArray<Readonly<{ id: PlayerSection; label: string; path: string; icon: ReactNode }>> = [
  { id: "table", label: "Table", path: "/table", icon: <IconDie /> },
  { id: "sheet", label: "Sheet", path: "/me", icon: <IconUser /> },
  { id: "codex", label: "Codex", path: "/codex", icon: <IconPage /> },
  { id: "log", label: "Log", path: PLAYER_LOG_PATH, icon: <IconLog /> }
];

/** Goes to a player section; the Codex reopens the page they were reading. */
function openPlayerSection(section: PlayerSection, current: PlayerSection | null, onCodex?: () => void) {
  const entry = PLAYER_SECTIONS.find((candidate) => candidate.id === section)!;
  if (section === "codex") {
    onCodex?.();
    void navigate(section === current ? entry.path : (lastLocationForTab("player", "codex") ?? entry.path));
    return;
  }
  void navigate(entry.path);
}

/**
 * A player's top bar (frame spec 2.1). On a laptop: the wordmark, Table, Sheet and Codex, then search and the one
 * menu, whose face is the character they play. On a phone the sections, with Log, are the bottom tabs.
 */
export function PlayerTopBar({
  state,
  token,
  codexUnread,
  onCodexSeen,
  onLeave
}: Readonly<{
  state: PlayerView;
  token?: string;
  codexUnread: number;
  onCodexSeen: () => void;
  onLeave: () => void;
}>) {
  const route = useRoute();
  const phone = usePhoneShell();
  const section = litPlayerSection(route);
  useCodexNews(codexUnread, "app-sections");
  // On a phone the table and its log head with the character being played, as the top bar belongs to the page.
  const claimed = state.actors.some((actor) => actor.kind === "player-character" && actor.claimStatus === "mine");
  if (phone && token && claimed && (section === "table" || section === "log"))
    return <PlayerIdentity state={state} token={token} />;
  return (
    <TopBar className="app-bar--player">
      {!phone && (
        <SectionTabs
          ariaLabel="Player sections"
          tabs={PLAYER_SECTIONS.filter((entry) => entry.id !== "log").map((entry) =>
            entry.id === "codex" && codexUnread > 0 ? { ...entry, label: `Codex, ${codexUnread} new` } : entry
          )}
          // The log is the table's own panel on a laptop, so the Table tab stays lit there.
          activeId={section === "log" ? "table" : section}
          onChange={(id) => openPlayerSection(id as PlayerSection, section, onCodexSeen)}
          bottom={false}
        />
      )}
      {!phone && <LiveChip role="player" state={state} />}
      <span className="app-bar-grow" />
      <SearchLauncher
        role="player"
        route={route}
        sections={[
          ...PLAYER_SECTIONS.filter((entry) => entry.id !== "log").map((entry) => ({
            label: entry.label,
            path: entry.path
          })),
          { label: "Settings", path: "/settings" }
        ]}
      />
      {phone ? (
        <>
          <ThemeSwitch className="app-bar-theme" />
          <SettingsButton />
        </>
      ) : (
        <FrameMenu role="player" state={state} onLeave={onLeave} />
      )}
    </TopBar>
  );
}

/** A player's sections as the phone's bottom tabs: Table, Sheet, Codex and Log. */
export function PlayerBottomTabs({
  codexUnread,
  onCodexSeen,
  state
}: Readonly<{ codexUnread: number; onCodexSeen: () => void; state?: PlayerView }>) {
  const route = useRoute();
  const section = litPlayerSection(route);
  useCodexNews(codexUnread, "app-bottom-tabs");
  // While a fight runs, Table carries a lit lamp, amber on the player's turn (frame rule 3.2).
  const live = state?.combat.active ? (myTurnNow(state) ? ("mine" as const) : ("live" as const)) : null;
  return (
    <SectionTabs
      ariaLabel="Player sections"
      tabs={PLAYER_SECTIONS.map((entry) =>
        entry.id === "codex" && codexUnread > 0
          ? { ...entry, label: `Codex, ${codexUnread} new` }
          : entry.id === "table" && live
            ? { ...entry, live }
            : entry
      )}
      activeId={section}
      onChange={(id) => openPlayerSection(id as PlayerSection, section, onCodexSeen)}
      bottom
    />
  );
}

/** Puts a Prep page's search or primary at the right end of Prep's section bar. */
export const PrepBarSlot = SectionBarSlot;

/**
 * Prep's section bar over its pages: Encounters, Party, Maps, Tokens, Sound and Replays, with the page's search or
 * primary at the right end. On a phone it is the header row and the strip under it.
 */
export function PrepFrame({ children }: Readonly<{ children: ReactNode }>) {
  const route = useRoute();
  const page = prepPageFor(route.path);
  const shown = useRef<HTMLDivElement>(null);
  return (
    <div className="prep-frame frame-col">
      <SectionBar
        name="Prep"
        navLabel="Prep sections"
        pagesLabel="Prep pages"
        pages={PREP_PAGES}
        activeId={page ?? ""}
        onChange={(id) => void navigate(PREP_PAGES.find((entry) => entry.id === id)!.path)}
        panel={() => shown.current}
      >
        <div ref={shown} className="prep-frame-page frame-col frame-fill">
          {children}
        </div>
      </SectionBar>
    </div>
  );
}
