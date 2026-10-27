import { useEffect, useState, type ReactNode } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { IconButton, IconCode, IconCog, IconDie, IconKey, IconLevelUp, IconSearch, IconUser, IconX } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { ApiReference } from "../integrations/ApiReference";
import { useMediaQuery } from "../lib/useMediaQuery";
import { navigate, useRoute } from "../router";
import { AccessSection } from "./AccessSection";
import { CharactersSection } from "./CharactersSection";
import { DeviceSection } from "./DeviceSection";
import { FightsSection } from "./FightsSection";
import { PlayersSection } from "./PlayersSection";
import {
  homeSection,
  isSettingsSection,
  pathForSection,
  sectionsFor,
  settingAnchor,
  settingsFor,
  type SettingEntry,
  type SettingsSectionId
} from "./sections";
import { PrimarySlot, SettingsSection } from "./SettingRow";
import { SettingsSearch } from "./SettingsSearch";
import "../codex/shell/shell.css";
import "./settings.css";

/**
 * Settings: the GM's areas in a section bar with the search (Ctrl K) and the view's one primary at its right end, or
 * on a phone in a tab bar at the bottom with the search in the top bar. Each section is its own address
 * (`/settings/<section>`, and `/settings/api/<operation id>` for one operation of the reference). A player's page is
 * the Device section alone. Who sees what is structural: `sectionsFor` lists a role's sections and only those
 * mount, so GM controls are never in a player's tree. The GM sections take `state` as a `GmView`, which a player
 * projection is not.
 */

const SECTION_ICONS: Readonly<Record<SettingsSectionId, ReactNode>> = {
  players: <IconUser className="cx-icon" />,
  fights: <IconDie className="cx-icon" />,
  characters: <IconLevelUp className="cx-icon" />,
  device: <IconCog className="cx-icon" />,
  access: <IconKey className="cx-icon" />,
  api: <IconCode className="cx-icon" />
};

/**
 * A GM token is not yet a GM view: on a cold deep link to `/settings` the first state can still be
 * player-projected (no `rulesPolicy`, `stagingDefaults` or `combat.healthDisplay`) until the session
 * join lands. So check the GM-only fields the sections read, and leave the role alone; the GM sections mount on
 * the next state.
 */
function gmViewOrNull(state: GmView | PlayerView | null): GmView | null {
  const view = state as GmView | null;
  if (!view) return null;
  const projected =
    view.rulesPolicy !== undefined && view.stagingDefaults !== undefined && view.combat?.healthDisplay !== undefined;
  return projected ? view : null;
}

export function SettingsPage({
  role,
  state,
  gmToken,
  onPreviewPlayers,
  onSignOut,
  onRevokeAll,
  onChangePassword,
  onLeave,
  busy = false
}: Readonly<{
  role: "gm" | "player";
  state: GmView | PlayerView | null;
  /** Present exactly when `role === "gm"`; the GM sections need it for the credentials, the reference and tokens. */
  gmToken?: string | null;
  /** Opens the GM's preview of the table screen. */
  onPreviewPlayers?: () => void;
  onSignOut?: () => void;
  onRevokeAll?: () => void;
  /** Resolves with the refusal's message, or null once the password changed. */
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<string | null>;
  /** A player leaving the table on this device. */
  onLeave?: () => void;
  busy?: boolean;
}>) {
  const route = useRoute();
  const phone = useMediaQuery("(max-width: 760px)");
  const gm = role === "gm" && gmToken ? gmViewOrNull(state) : null;
  const sections = sectionsFor(role);
  const requested = route.segments[1];
  const section: SettingsSectionId =
    isSettingsSection(requested) && sections.some((candidate) => candidate.id === requested)
      ? requested
      : homeSection(role);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [searching, setSearching] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const mine = (state?.actors ?? []).find(
    (actor) => "claimStatus" in actor && actor.claimStatus === "mine" && actor.kind === "player-character"
  );
  const leave = async () => {
    const ok = await confirm({
      title: "Leave the table?",
      body: mine
        ? `${mine.name} stays yours. Join again on this device to pick up where you left off.`
        : "Join again on this device whenever you are ready.",
      confirmLabel: "Leave table"
    });
    if (ok) onLeave?.();
  };

  // A pick in the search opens its section, then brings the setting into view and marks it.
  useEffect(() => {
    if (!focus) return;
    const row = document.getElementById(settingAnchor(focus));
    if (!row) return;
    row.scrollIntoView({ block: "center" });
    row.focus({ preventScroll: true });
    row.classList.add("is-flashing");
    const timer = window.setTimeout(() => row.classList.remove("is-flashing"), 1300);
    setFocus(null);
    return () => window.clearTimeout(timer);
  }, [focus, section]);
  const pick = (entry: SettingEntry) => {
    setSearching(false);
    if (entry.section !== section) void navigate(pathForSection(entry.section));
    setFocus(entry.id);
  };
  const go = (id: SettingsSectionId) => void navigate(pathForSection(id));

  const search = <SettingsSearch entries={settingsFor(role)} onPick={pick} autoFocus={phone && searching} />;

  let body: ReactNode = null;
  if (section === "device") body = <DeviceSection role={role} onLeave={onLeave ? () => void leave() : undefined} />;
  else if (gm && gmToken) {
    if (section === "players")
      body = <PlayersSection state={gm} gmToken={gmToken} onPreviewScreen={onPreviewPlayers ?? (() => {})} />;
    else if (section === "fights") body = <FightsSection state={gm} />;
    else if (section === "characters") body = <CharactersSection state={gm} />;
    else if (section === "access")
      body = (
        <AccessSection
          gmToken={gmToken}
          busy={busy}
          onSignOut={onSignOut}
          onRevokeAll={onRevokeAll ?? (() => {})}
          onChangePassword={onChangePassword ?? (async () => "Sign in as the GM first.")}
        />
      );
    else if (section === "api")
      body = (
        <SettingsSection id="api" gmOnly wide>
          <ApiReference
            gmToken={gmToken}
            openKey={route.segments[2] ?? null}
            onOpen={(key) => void navigate(`/settings/api/${encodeURIComponent(key)}`)}
            onClose={() => void navigate("/settings/api")}
          />
        </SettingsSection>
      );
  }

  // A player has one section, so the page is that section with no bar.
  if (role === "player")
    return (
      <div className="settings cx-shell is-single">
        <div className="settings-content scroll-y">{body}</div>
        {dialog}
      </div>
    );

  return (
    <PrimarySlot.Provider value={slot}>
      <div className={`settings cx-shell ${phone ? "is-phone" : "is-laptop"}`}>
        {phone ? (
          <header className="cx-phonebar settings-phonebar">
            {searching ? (
              <>
                {search}
                <IconButton label="Close the search" size="sm" onClick={() => setSearching(false)}>
                  <IconX />
                </IconButton>
              </>
            ) : (
              <>
                <h2 className="cx-phonebar-title">Settings</h2>
                <div className="cx-phonebar-actions">
                  <span ref={setSlot} className="settings-primary-slot" />
                  <IconButton label="Search settings" size="sm" onClick={() => setSearching(true)}>
                    <IconSearch />
                  </IconButton>
                </div>
              </>
            )}
          </header>
        ) : (
          <div className="cx-bar settings-bar">
            <nav className="cx-bar-sections nh-tabs nh-tabs--horizontal" aria-label="Settings sections">
              {sections.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`nh-tab cx-bar-tab${section === item.id ? " nh-tab--active" : ""}`}
                  aria-current={section === item.id ? "page" : undefined}
                  onClick={() => go(item.id)}
                >
                  {SECTION_ICONS[item.id]}
                  {item.label}
                </button>
              ))}
            </nav>
            <span className="cx-grow" />
            {search}
            <span ref={setSlot} className="settings-primary-slot" />
          </div>
        )}
        {phone && (
          <nav className="cx-tabbar settings-tabbar" aria-label="Settings sections">
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`cx-tabbar-tab${section === item.id ? " is-on" : ""}`}
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => go(item.id)}
              >
                {SECTION_ICONS[item.id]}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        )}
        {/* The reference is a frame of its own, with its results as the one scroller, so its filter flyout spans
          what is on screen. Every other section scrolls as one page. */}
        <div className={section === "api" ? "settings-content is-frame" : "settings-content scroll-y"} key={section}>
          {body}
        </div>
        {dialog}
      </div>
    </PrimarySlot.Provider>
  );
}
