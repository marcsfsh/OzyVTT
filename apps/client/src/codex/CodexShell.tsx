import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal } from "@vtt/ui";
import { codexApi } from "./api";
import { navigate, replaceQuery, useRoute } from "../router";
import { useMediaQuery } from "../lib/useMediaQuery";
import {
  codexSectionOf,
  isRetiredSection,
  pathForSection,
  pagePath,
  questPath,
  recordIdOf,
  retiredTarget,
  sessionPath
} from "./routes";
import { NotFoundView } from "../components/NotFoundView";
import { QuickCreate, type QuickCreateRequest } from "./QuickCreate";
import { CalendarPage, calendarPartOf } from "./CalendarPage";
import { createQuest, createSession } from "./creates";
import { provideCodexCommands } from "./codex-commands";
import { openSearch } from "../shell/search-store";
import { PlayerCodex } from "./PlayerCodex";
import { useGmFeeds } from "./useGmFeeds";
import { CodexFrame } from "./shell/CodexFrame";
import { GmMenu, NewMenu } from "./shell/GmMenus";
import { CODEX_SECTIONS } from "./shell/sections";
import {
  CODEX_PHONE_QUERY,
  CodexShellContext,
  GmCodexContext,
  type CodexShellValue,
  type GmCodexValue,
  type WorkspaceActor
} from "./shell/context";
import "./codex.css";

type WorkspaceScene = Readonly<{ id: string; name: string }>;

/**
 * The GM Codex: the shell's frame over the section the address names, with every feed owned here and handed down
 * through context, so two views never disagree about, say, which session is active. `codex:changed` triggers a
 * coarse refetch; the ping carries no payload.
 */
export function CodexShell({
  gmToken,
  scenes = [],
  actors = [],
  activeEncounterId = null,
  onActivateScene = () => {},
  onOpenReplay,
  gameHours = null,
  gameMinutes = 0
}: Readonly<{
  gmToken: string;
  scenes?: readonly WorkspaceScene[];
  actors?: readonly WorkspaceActor[];
  activeEncounterId?: string | null;
  onActivateScene?: (encounterId: string) => void;
  onOpenReplay?: (archiveId: number) => void;
  /** The game clock (`rest.clockHours`), whose hour goes with the calendar's date. */
  gameHours?: number | null;
  /** The minutes past that hour (`rest.clockMinutes`). */
  gameMinutes?: number;
}>) {
  const route = useRoute();
  const address = codexSectionOf(route.segments);
  const section = address && !isRetiredSection(address) ? address : null;
  // The calendar is the GM's own page now; an old calendar address with a month in it still lands on the story.
  const calendarPage = address === "calendar" && !route.query.has("y") && !route.query.has("m");
  const recordId = recordIdOf(route.segments);
  const phone = useMediaQuery(CODEX_PHONE_QUERY);

  // An old address lands where its content lives now, replacing itself so Back skips it.
  useEffect(() => {
    if (address && isRetiredSection(address) && !calendarPage)
      void navigate(retiredTarget(address, route.query), { replace: true });
  }, [address, route.query, calendarPage]);

  const [quickCreate, setQuickCreate] = useState<QuickCreateRequest | null>(null);
  // See as players mounts the real player Codex on a short-lived player token the server mints for Everyone or
  // for one character, so the preview walks that viewer's projection. Never the GM token.
  const [preview, setPreview] = useState<Readonly<{ token: string; name: string }> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const feeds = useGmFeeds(gmToken, section);
  /** A failed create or move, reported by whichever view tried it. Fresh data clears it. */
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => setActionError(null), [feeds.list.data]);

  const party = useMemo(
    () =>
      actors
        .filter((actor) => actor.kind === "player-character" && actor.archived !== true)
        .map((actor) => ({ id: actor.id, name: actor.name })),
    [actors]
  );

  const openPreview = useCallback(
    async (characterId: string | null) => {
      setPreviewError(null);
      try {
        const token = await codexApi.createPreviewSession(gmToken, characterId);
        const name = characterId ? (party.find((character) => character.id === characterId)?.name ?? "") : "";
        setPreview({ token, name });
      } catch (previewFailure) {
        setPreviewError(previewFailure instanceof Error ? previewFailure.message : "Couldn't open the player preview.");
      }
    },
    [gmToken, party]
  );

  const setFilter = useCallback((next: Readonly<Record<string, string | null>>) => {
    replaceQuery((query) => {
      for (const [key, value] of Object.entries(next)) {
        if (value) query.set(key, value);
        else query.delete(key);
      }
    });
  }, []);
  const go = useCallback((path: string, options?: Readonly<{ replace?: boolean }>) => void navigate(path, options), []);

  const { sessions, sessionFeed, questFeed } = feeds;
  /** Create-and-open, shared by New and the palette. Errors go to the shell's notice row. */
  const newSession = useCallback(async () => {
    try {
      const session = await createSession(gmToken, sessions);
      await sessionFeed.reload();
      void navigate(sessionPath(session.id));
    } catch (createError) {
      setActionError(createError instanceof Error ? createError.message : "Couldn't create the session.");
    }
  }, [gmToken, sessions, sessionFeed]);
  const newQuest = useCallback(async () => {
    try {
      const quest = await createQuest(gmToken);
      await questFeed.reload();
      void navigate(questPath(quest.id, "edit"));
    } catch (createError) {
      setActionError(createError instanceof Error ? createError.message : "Couldn't create the quest.");
    }
  }, [gmToken, questFeed]);

  // While the Codex is mounted the one search offers its creates after the results.
  useEffect(
    () =>
      provideCodexCommands({
        createPage: (title) => setQuickCreate({ title }),
        createSession: () => void newSession(),
        createQuest: () => void newQuest()
      }),
    [newSession, newQuest]
  );

  const shell = useMemo<CodexShellValue | null>(
    () =>
      section && {
        role: "gm",
        token: gmToken,
        embedded: false,
        section,
        segments: route.segments,
        recordId,
        query: route.query,
        phone,
        go,
        setQuery: replaceQuery,
        setFilter,
        openPalette: () => openSearch("codex")
      },
    [section, gmToken, route.segments, route.query, recordId, phone, go, setFilter]
  );
  const gm = useMemo<GmCodexValue>(
    () => ({
      scenes,
      actors,
      party,
      activeEncounterId,
      onActivateScene,
      onOpenReplay,
      gameHours,
      gameMinutes,
      autosave: feeds.autosave,
      feeds,
      quickCreate: setQuickCreate,
      reportError: setActionError,
      openPreview: (characterId) => void openPreview(characterId)
    }),
    [
      scenes,
      actors,
      party,
      activeEncounterId,
      onActivateScene,
      onOpenReplay,
      gameHours,
      gameMinutes,
      feeds,
      openPreview
    ]
  );

  const View = section ? CODEX_SECTIONS[section].gm : null;
  const menus = (compact: boolean) => (
    <>
      <NewMenu
        compact={compact}
        onNewPage={() => setQuickCreate({})}
        onNewQuest={() => void newQuest()}
        onNewSession={() => void newSession()}
      />
      <GmMenu section={section} party={party} go={go} onPreview={(id) => void openPreview(id)} />
    </>
  );

  return (
    <GmCodexContext.Provider value={gm}>
      <CodexFrame
        role="gm"
        section={section}
        recordId={recordId}
        phone={phone}
        go={go}
        laptopActions={menus(false)}
        phoneActions={menus(true)}
        notices={
          (feeds.list.error || actionError || previewError) && (
            <div className="cx-notices">
              {feeds.list.error && (
                <Alert tone="danger" title="Couldn't load the Codex">
                  {feeds.list.error}
                </Alert>
              )}
              {actionError && <Alert tone="danger">{actionError}</Alert>}
              {previewError && <Alert tone="danger">{previewError}</Alert>}
            </div>
          )
        }
        overlays={
          <>
            {quickCreate && (
              <QuickCreate
                gmToken={gmToken}
                request={quickCreate}
                onClose={() => setQuickCreate(null)}
                onOpen={(pageId) => go(pagePath(pageId, "edit"))}
                onChanged={feeds.list.reload}
              />
            )}
            {/* `codex-preview-modal` gives the embedded shell a real height, so the atlas map has something to fill. */}
            <Modal
              open={!!preview}
              onClose={() => setPreview(null)}
              size="full"
              title={preview?.name ? `What ${preview.name}'s player sees` : "What players see"}
              ariaLabel="Player Codex preview"
              className="codex-preview-modal"
            >
              <p className="codex-inspector-hint">
                This is the real player Codex, read through a preview session. Anything this viewer can't read is absent
                here.
              </p>
              {preview && <PlayerCodex key={preview.token} token={preview.token} embedded />}
            </Modal>
          </>
        }
      >
        {shell && View ? (
          <CodexShellContext.Provider value={shell}>
            <View />
          </CodexShellContext.Provider>
        ) : calendarPage ? (
          <CalendarPage
            gmToken={gmToken}
            phone={phone}
            part={calendarPartOf(route.query.get("part"))}
            onPart={(part) => replaceQuery((query) => query.set("part", part))}
            onBack={() => go(pathForSection("story"))}
          />
        ) : !address || !isRetiredSection(address) ? (
          <NotFoundView role="gm" />
        ) : null}
      </CodexFrame>
    </GmCodexContext.Provider>
  );
}
