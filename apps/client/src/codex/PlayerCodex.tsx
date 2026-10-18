import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@vtt/ui";
import { CommandPalette } from "./CommandPalette";
import { NotFoundView } from "../components/NotFoundView";
import { navigate, replaceQuery, useRoute } from "../router";
import { useMediaQuery } from "../lib/useMediaQuery";
import { GM_ONLY_SECTIONS, codexSectionOf, isRetiredSection, pathForHit, recordIdOf, retiredTarget } from "./routes";
import { CodexFrame } from "./shell/CodexFrame";
import { CODEX_SECTIONS } from "./shell/sections";
import { CODEX_PHONE_QUERY, CodexShellContext, PlayerCodexContext, type CodexShellValue } from "./shell/context";
import { usePlayerFeeds } from "./shell/usePlayerFeeds";
import "./codex.css";

/**
 * The player Codex: the same frame and sections as the GM's, minus the GM menu and New, at the same addresses.
 *
 * Viewer safety: every read goes through `playerCodexApi` on this player's token (`usePlayerFeeds`), never the GM
 * feeds, so everything rendered is a field the server chose to send. A GM-only address renders the not-found view,
 * identical to an unknown address, so it confirms nothing.
 */
export function PlayerCodex({ token, embedded = false }: Readonly<{ token: string; embedded?: boolean }>) {
  /**
   * The GM's See as players mounts this in a dialog with a preview token. Embedded, it runs on a local route so it
   * never drives the browser address.
   */
  const globalRoute = useRoute();
  const [localPath, setLocalPath] = useState("/codex");
  const path = embedded ? localPath.split("?")[0] : globalRoute.path;
  const query = useMemo(
    () => (embedded ? new URLSearchParams(localPath.split("?")[1] ?? "") : globalRoute.query),
    [embedded, localPath, globalRoute.query]
  );
  const go = useCallback(
    (next: string, options?: Readonly<{ replace?: boolean }>) => {
      if (embedded) setLocalPath(next);
      else void navigate(next, options);
    },
    [embedded]
  );
  const setQuery = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      if (!embedded) {
        replaceQuery(mutate);
        return;
      }
      setLocalPath((current) => {
        const [base, search] = current.split("?");
        const params = new URLSearchParams(search ?? "");
        mutate(params);
        const next = params.toString();
        return next ? `${base}?${next}` : base;
      });
    },
    [embedded]
  );
  const setFilter = useCallback(
    (next: Readonly<Record<string, string | null>>) =>
      setQuery((params) => {
        for (const [key, value] of Object.entries(next)) {
          if (value) params.set(key, value);
          else params.delete(key);
        }
      }),
    [setQuery]
  );

  const segments = useMemo(() => path.split("/").filter(Boolean), [path]);
  const address = codexSectionOf(segments);
  const gmOnly = address !== null && GM_ONLY_SECTIONS.includes(address);
  const retired = address !== null && !gmOnly && isRetiredSection(address) ? address : null;
  const section = address && !gmOnly && !isRetiredSection(address) ? address : null;
  const recordId = recordIdOf(segments);
  const phone = useMediaQuery(CODEX_PHONE_QUERY);

  useEffect(() => {
    if (retired) go(retiredTarget(retired, query), { replace: true });
  }, [retired, query, go]);

  const feeds = usePlayerFeeds(token);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const shell = useMemo<CodexShellValue | null>(
    () =>
      section && {
        role: "player",
        token,
        embedded,
        section,
        segments,
        recordId,
        query,
        phone,
        go,
        setQuery,
        setFilter,
        openPalette: () => setPaletteOpen(true)
      },
    [section, token, embedded, segments, recordId, query, phone, go, setQuery, setFilter]
  );
  const player = useMemo(() => ({ feeds }), [feeds]);
  const View = section ? CODEX_SECTIONS[section].player : null;

  return (
    <PlayerCodexContext.Provider value={player}>
      <CodexFrame
        section={section}
        phone={phone}
        embedded={embedded}
        className="codex-player"
        go={go}
        paletteOpen={paletteOpen}
        onPaletteChange={setPaletteOpen}
        notices={
          feeds.error && (
            <div className="cx-notices">
              <Alert tone="danger" title="Couldn't load the Codex">
                {feeds.error}
              </Alert>
            </div>
          )
        }
        overlays={
          paletteOpen && (
            <CommandPalette
              gmToken={token}
              player
              onOpenHit={(hit) => go(pathForHit(hit))}
              onNavigate={go}
              onClose={() => setPaletteOpen(false)}
            />
          )
        }
      >
        {shell && View ? (
          <CodexShellContext.Provider value={shell}>
            <View />
          </CodexShellContext.Provider>
        ) : (
          !retired && <NotFoundView role="player" />
        )}
      </CodexFrame>
    </PlayerCodexContext.Provider>
  );
}
