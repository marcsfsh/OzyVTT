import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { IconButton, IconChevronLeft, IconSearch, useTheme } from "@vtt/ui";
import { ApiReference } from "../integrations/ApiReference";
import { useMediaQuery } from "../lib/useMediaQuery";
import { navigate, useRoute } from "../router";
import { PhoneHeader, SectionBar } from "../shell/SectionBar";
import { useLeaveTable } from "../shell/useLeaveTable";
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
import { PrimarySlot, SectionLine, SettingsSection } from "./SettingRow";
import { SettingsList } from "./SettingsList";
import { sectionLine } from "./sectionLines";
import { FAMILY_COPY } from "./FightsSection";
import { usePinchZoom } from "./preferences";
import { useRollPreference } from "../dice/roll-preference";
import { useActiveCredentialCount } from "../integrations/credentialCount";
import { SettingsSearch } from "./SettingsSearch";
import "../codex/shell/shell.css";
import "./settings.css";

/**
 * Settings (settings spec 2.1, ADR-0057): on a laptop a title row with the view's one primary at its right, the side
 * list of sections with its search, and the section beside it; on a phone the list first, and each section full
 * screen under a header with Back. Each section is its own address
 * (`/settings/<section>`, and `/settings/api/<operation id>` for one operation of the reference). A player's page is
 * the Device section alone. Who sees what is structural: `sectionsFor` lists a role's sections and only those
 * mount, so GM controls are never in a player's tree. The GM sections take `state` as a `GmView`, which a player
 * projection is not.
 */

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
  const [listQuery, setListQuery] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  // What each section holds now, for its head and the list's counts (settings spec 2.1).
  const { theme } = useTheme();
  const { rollInput } = useRollPreference();
  const pinchZoom = usePinchZoom();
  const activeCredentials = useActiveCredentialCount(gm ? (gmToken ?? null) : null);
  const facts = { theme, rollInput, pinchZoom, activeCredentials };
  const lineOf = (id: SettingsSectionId) => sectionLine(id, gm, facts);

  // Leaving is asked first, as the frame's menu asks it.
  const { leave, dialog } = useLeaveTable(state && !("definitions" in state) ? state : null, onLeave);

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
    if (entry.section !== section) void navigate(pathForSection(entry.section));
    setFocus(entry.id);
  };
  const go = (id: SettingsSectionId) => void navigate(pathForSection(id));

  const listSearch = (
    <SettingsSearch entries={settingsFor(role)} onPick={pick} variant="list" onQueryChange={setListQuery} />
  );
  const counts = gm
    ? {
        players: gm.actors.filter(
          (actor) => actor.kind === "player-character" && !actor.archived && actor.ownerSessionId !== null
        ).length,
        fights:
          gm.rulesPolicy.dial === "freeform"
            ? null
            : FAMILY_COPY.filter(({ family }) => gm.rulesPolicy.exceptions[family] !== "freeform").length,
        access: activeCredentials
      }
    : {};

  // A section's content fades in as the bar's light lands on it.
  const content = useRef<HTMLDivElement>(null);
  let body: ReactNode = null;
  const line = role === "gm" ? lineOf(section) : undefined;
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
        <SettingsSection id="api" wide>
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
        {/* A phone has no top bar, so the page names itself (frame spec 2.2). */}
        <PhoneHeader title="Settings" />
        <div className="settings-content scroll-y">{body}</div>
        {dialog}
      </div>
    );

  // A laptop: the title row with the section's primary at its right, the list of sections, and the section beside it
  // (settings spec 2.1).
  if (!phone)
    return (
      <PrimarySlot.Provider value={slot}>
        <SectionLine.Provider value={line}>
          <div className="settings cx-shell is-laptop">
            <SectionBar
              name="Settings"
              navLabel="Settings"
              pages={[]}
              activeId=""
              onChange={() => undefined}
              end={<span ref={setSlot} className="settings-primary-slot" />}
            >
              <div className="settings-split">
                <SettingsList
                  sections={sections}
                  current={section}
                  counts={counts}
                  search={listSearch}
                  searching={listQuery.trim() !== ""}
                  onGo={go}
                />
                {/* The reference is a frame of its own, with its results as the one scroller, so its filter flyout
                    spans what is on screen. Every other section scrolls as one page. */}
                <div
                  ref={content}
                  className={section === "api" ? "settings-content is-frame" : "settings-content scroll-y"}
                  key={section}
                >
                  {body}
                </div>
              </div>
            </SectionBar>
            {dialog}
          </div>
        </SectionLine.Provider>
      </PrimarySlot.Provider>
    );

  // A phone (settings spec 2.1): `/settings` is the list of sections under the header, its search a field over it; a
  // section opens full screen under a header with Back and its name, Access's New credential as the header's icon.
  const listShown = requested === undefined;
  const sectionName = sections.find((item) => item.id === section)?.label ?? "Settings";
  return (
    <PrimarySlot.Provider value={slot}>
      <SectionLine.Provider value={line}>
        <div className={`settings cx-shell is-phone${listShown ? " is-list" : ""}`}>
          <SectionBar
            name="Settings"
            navLabel="Settings"
            pages={[]}
            activeId=""
            onChange={() => undefined}
            phoneHead={
              listShown ? (
                <>
                  <h1 className="secbar-name">Settings</h1>
                  <span className="secbar-icons">
                    <IconButton
                      label="Search settings"
                      onClick={() =>
                        document.querySelector<HTMLInputElement>(".settings-list .settings-search-input")?.focus()
                      }
                    >
                      <IconSearch />
                    </IconButton>
                  </span>
                </>
              ) : (
                <>
                  <IconButton label="Back to Settings" size="sm" onClick={() => void navigate("/settings")}>
                    <IconChevronLeft />
                  </IconButton>
                  <h1 className="secbar-name">{sectionName}</h1>
                  <span className="secbar-icons">
                    <span ref={setSlot} className="settings-primary-slot" />
                  </span>
                </>
              )
            }
          >
            {listShown ? (
              <SettingsList
                sections={sections}
                current={null}
                counts={counts}
                search={listSearch}
                searching={listQuery.trim() !== ""}
                onGo={go}
              />
            ) : (
              <div
                ref={content}
                className={section === "api" ? "settings-content is-frame" : "settings-content scroll-y"}
                key={section}
              >
                {body}
              </div>
            )}
          </SectionBar>
          {dialog}
        </div>
      </SectionLine.Provider>
    </PrimarySlot.Provider>
  );
}
