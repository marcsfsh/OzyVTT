import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GmView, PlayerView } from "@vtt/domain";
import {
  IconButton,
  IconCog,
  IconDie,
  IconList,
  IconLog,
  IconPage,
  IconScene,
  IconUser,
  Portrait,
  Tabs,
  Wordmark,
  cx
} from "@vtt/ui";
import { pictureOf } from "../actors/actor-picture";
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
import { TvControl } from "../table/TvControl";
import { SearchLauncher } from "./SearchLauncher";
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

/** The sections as a tab bar: the top bar's on a laptop, the bottom tabs on a phone. One name, so each is "the" bar. */
function SectionTabs({
  ariaLabel,
  tabs,
  activeId,
  onChange,
  bottom
}: Readonly<{
  ariaLabel: string;
  tabs: ReadonlyArray<Readonly<{ id: string; label: string; icon?: ReactNode }>>;
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
      tabs={tabs.map((tab) => ({
        id: tab.id,
        label: bottom ? (
          <span className="app-bottom-tab">
            <span className="app-bottom-tab-icon" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.label}
          </span>
        ) : (
          tab.label
        )
      }))}
    />
  );
}

/** The top bar's frame: the wordmark, what goes in it, and the horizon line along its bottom edge. */
function TopBar({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <header className={cx("app-bar", className)}>
      <Wordmark variant="cabinet" className="app-bar-mark" />
      {children}
    </header>
  );
}

/** Who is connected, as the projection says it: the claimed characters whose players are online. */
function Connected({ state }: Readonly<{ state: GmView }>) {
  const online = state.actors.filter(
    (actor) =>
      actor.kind === "player-character" && !actor.archived && actor.ownerSessionId && actor.presence === "online"
  );
  if (online.length === 0) return null;
  const label = `${online.length} ${online.length === 1 ? "character" : "characters"} online`;
  return (
    <span className="app-bar-connected" role="img" aria-label={label} title={online.map((a) => a.name).join(", ")}>
      {online.slice(0, 4).map((actor) => (
        <Portrait key={actor.id} size="xs" frame="party" picture={pictureOf(actor, null, state.definitions)} />
      ))}
      {online.length > 4 && <span className="app-bar-connected-more">+{online.length - 4}</span>}
    </span>
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
 * The GM's top bar. On a laptop: the wordmark, Play, Prep, Codex and Compendium, then the table screen lamp, who is
 * connected, search and settings. On a phone the sections are the bottom tabs, so the bar keeps the utilities alone.
 */
export function GmTopBar({ state, token }: Readonly<{ state: GmView; token: string }>) {
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
      {!phone && section === "play" && (
        <>
          <span className="app-bar-divider" aria-hidden="true" />
          <LiveScenePicker state={state} />
        </>
      )}
      <span className="app-bar-grow" />
      <TvControl gmToken={token} state={state} compact={phone} />
      {!phone && <Connected state={state} />}
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
      <SettingsButton />
    </TopBar>
  );
}

/** The GM's sections as the phone's bottom tabs. */
export function GmBottomTabs() {
  const route = useRoute();
  const section = litGmSection(route.path);
  return (
    <SectionTabs
      ariaLabel="GM sections"
      tabs={GM_SECTIONS.map((entry) => ({ ...entry, icon: GM_SECTION_ICONS[entry.id] }))}
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

/** The character this player plays, beside the bar's end: their portrait and first name. */
function Playing({ state }: Readonly<{ state: PlayerView }>) {
  const mine = state.actors.filter((actor) => actor.kind === "player-character" && actor.claimStatus === "mine");
  const actor = mine[0];
  if (!actor) return <span className="app-bar-playing is-none">No character yet</span>;
  const name = actor.name.split(/\s+/)[0] ?? actor.name;
  return (
    <button type="button" className="app-bar-playing interactive" onClick={() => void navigate("/me")}>
      <Portrait size="xs" frame="party" picture={pictureOf(actor, null)} />
      <span>Playing {mine.length > 1 ? `${name} and ${mine.length - 1} more` : name}</span>
    </button>
  );
}

/**
 * A player's top bar. On a laptop: the wordmark, Table, Sheet and Codex, the character they play, search and settings.
 * On a phone the sections, with Log, are the bottom tabs.
 */
export function PlayerTopBar({
  state,
  codexUnread,
  onCodexSeen
}: Readonly<{ state: PlayerView; codexUnread: number; onCodexSeen: () => void }>) {
  const route = useRoute();
  const phone = usePhoneShell();
  const section = litPlayerSection(route);
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
      <span className="app-bar-grow" />
      {!phone && <Playing state={state} />}
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
      <SettingsButton />
    </TopBar>
  );
}

/** A player's sections as the phone's bottom tabs: Table, Sheet, Codex and Log. */
export function PlayerBottomTabs({
  codexUnread,
  onCodexSeen
}: Readonly<{ codexUnread: number; onCodexSeen: () => void }>) {
  const route = useRoute();
  const section = litPlayerSection(route);
  return (
    <SectionTabs
      ariaLabel="Player sections"
      tabs={PLAYER_SECTIONS.map((entry) =>
        entry.id === "codex" && codexUnread > 0 ? { ...entry, label: `Codex, ${codexUnread} new` } : entry
      )}
      activeId={section}
      onChange={(id) => openPlayerSection(id as PlayerSection, section, onCodexSeen)}
      bottom
    />
  );
}

/** Where a Prep page puts its search or its primary: the right end of the section bar. */
const PrepBarEnd = createContext<HTMLElement | null>(null);

/** Puts a Prep page's search or primary at the right end of Prep's section bar. */
export function PrepBarSlot({ children }: Readonly<{ children: ReactNode }>) {
  const target = useContext(PrepBarEnd);
  return target ? createPortal(children, target) : null;
}

/**
 * Prep's section bar over its pages: Scenes, Party, Maps, Tokens, Sound and Replays, with the page's search or primary
 * at the right end. On a phone it is the strip under the page's header.
 */
export function PrepFrame({ children }: Readonly<{ children: ReactNode }>) {
  const route = useRoute();
  const page = prepPageFor(route.path);
  const [end, setEnd] = useState<HTMLElement | null>(null);
  return (
    <div className="prep-frame frame-col">
      <div className="section-bar">
        <Tabs
          className="section-bar-tabs"
          ariaLabel="Prep pages"
          activeId={page ?? ""}
          onChange={(id) => void navigate(PREP_PAGES.find((entry) => entry.id === id)!.path)}
          tabs={PREP_PAGES.map((entry) => ({ id: entry.id, label: entry.label }))}
        />
        <span className="app-bar-grow" />
        <div className="section-bar-end" ref={setEnd} />
      </div>
      <PrepBarEnd.Provider value={end}>
        <div className="prep-frame-page frame-col frame-fill">{children}</div>
      </PrepBarEnd.Provider>
    </div>
  );
}
