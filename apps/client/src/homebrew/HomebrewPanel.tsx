/**
 * The Homebrew tab: one master-detail library over all content types, with library-wide
 * status in a modebar rather than a second tab bar. The panel is conditionally mounted, so a
 * tab switch destroys its state; edits are parked on the server as they are made (`useAutosave`).
 * A failed load shows a named condition with Retry, never an empty library.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Alert, Button, Skeleton, useToast } from "@vtt/ui";
import { IconChevron } from "@vtt/ui";
import { socket } from "../socket";
import { CreateRecordModal, type CreateRequest } from "./CreateRecordModal";
import { HomebrewRail, EMPTY_FILTERS, type RailFilters } from "./HomebrewRail";
import { PackActions } from "./PackActions";
import { RecordDetail, type DetailMode } from "./RecordDetail";
import { homebrewApi, listAllHomebrew, type HomebrewRecordDocument, type HomebrewRecordSummary } from "./api";
import { ApiError } from "../lib/api";
import { closingSave } from "./closingSaves";
import { blankDraft } from "./defaults";
import { typeLabel } from "./types";
import { WIZARDS } from "./wizard";
import "./homebrew.css";

type LoadState = "loading" | "ready" | "unavailable" | "error";

export function HomebrewPanel({ gmToken }: Readonly<{ gmToken: string }>) {
  const { toast } = useToast();
  const [records, setRecords] = useState<readonly HomebrewRecordSummary[]>([]);
  const [load, setLoad] = useState<LoadState>("loading");
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState<RailFilters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<HomebrewRecordDocument | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  /** A record just made opens step by step; one picked from the list opens in the full editor. */
  const [mode, setMode] = useState<DetailMode>("editor");

  const refresh = useCallback(async () => {
    try {
      const rows = await listAllHomebrew(gmToken);
      setRecords(rows);
      setLoad("ready");
      setLoadMessage(null);
    } catch (error) {
      // 404 (router not mounted) or 501 (store not mounted) means "not available", not "broken".
      const status = error instanceof ApiError ? error.status : 0;
      setLoad(status === 404 || status === 501 ? "unavailable" : "error");
      setLoadMessage(error instanceof Error ? error.message : "Couldn't load your homebrew.");
    }
  }, [gmToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** `homebrew:changed` is a content-free ping, so it cannot leak an unpublished record; each
      recipient refetches its own filtered view. It refreshes the list only, never `selected`, so an
      open editor is never clobbered; the editor patches its own row via `patchRow`. */
  useEffect(() => {
    const onChanged = () => void refresh();
    socket.on("homebrew:changed", onChanged);
    return () => {
      socket.off("homebrew:changed", onChanged);
    };
  }, [refresh]);

  // Patch a summary row in place rather than reloading the list under an open editor.
  const patchRow = useCallback((next: HomebrewRecordDocument) => {
    setRecords((rows) => {
      const name = typeof next.record.name === "string" ? next.record.name : "";
      const index = rows.findIndex((row) => row.id === next.id);
      if (index === -1) return rows;
      const merged: HomebrewRecordSummary = {
        ...rows[index],
        name: name || rows[index].name,
        state: next.state,
        visibleToPlayers: next.visibleToPlayers,
        deletedAt: next.deletedAt,
        rev: next.rev,
        updatedAt: next.updatedAt,
        // Pending edits' validity says nothing about the live record the rail marks.
        valid: next.pendingChanges ? rows[index].valid : next.validity.valid
      };
      const copy = rows.slice();
      copy[index] = merged;
      return copy;
    });
  }, []);

  const select = useCallback(
    async (id: string) => {
      // The open editor closes at once and sends its last edit; the record is read after that lands, so reopening
      // the same record never starts from a copy without it.
      flushSync(() => {
        setSelectedId(id);
        setMode("editor");
        setSelected(null);
        setSelectError(null);
      });
      try {
        await closingSave(id);
        setSelected(await homebrewApi.get(gmToken, id));
      } catch (error) {
        setSelectError(error instanceof Error ? error.message : "Couldn't open that record.");
      }
    },
    [gmToken]
  );

  /**
   * Copies a duplicated class's subclasses. The server re-points the copy's subclass pick to
   * `<newId>-subclasses`, which matches nothing until a subclass names the copy, so each subclass
   * is duplicated and its `classId` re-pointed. Failures are returned so the GM is told which
   * subclass is missing.
   */
  const copyCompanions = async (
    classId: string,
    companions: ReadonlyArray<Readonly<{ id: string; name: string }>>
  ): Promise<readonly string[]> => {
    const failed: string[] = [];
    for (const companion of companions) {
      try {
        const copy = await homebrewApi.duplicate(gmToken, companion.id);
        // The server keeps `classId` verbatim; here it must follow the new class.
        await homebrewApi.update(gmToken, copy.id, { ...copy.record, classId }, copy.rev);
      } catch {
        failed.push(companion.name);
      }
    }
    return failed;
  };

  const create = async (request: CreateRequest) => {
    setCreating(true);
    try {
      const created =
        request.mode === "duplicate"
          ? // No name: the server derives "{source} (copy)".
            await homebrewApi.duplicate(gmToken, request.sourceId)
          : // Create with the type's blank draft so opening the record is not itself a write.
            await homebrewApi.create(gmToken, {
              ...blankDraft(request.type),
              type: request.type,
              name: `New ${typeLabel(request.type)}`
            });

      const companions = request.mode === "duplicate" ? request.companions : [];
      const failed = companions.length > 0 ? await copyCompanions(created.id, companions) : [];

      setCreateOpen(false);
      await refresh();
      setSelectedId(created.id);
      setMode("wizard");
      // Re-read after the companions land: the class's validity was computed before they existed.
      setSelected(companions.length > 0 ? await homebrewApi.get(gmToken, created.id) : created);

      const name = typeof created.record.name === "string" ? created.record.name : "";
      const made = name || `New ${typeLabel(request.type)}`;
      const copied = companions.length - failed.length;
      if (failed.length > 0) {
        // `info`, not `error`: the requested record was created.
        toast(`${made} created, but ${failed.join(" and ")} couldn't be copied. Add a subclass before publishing.`, {
          tone: "info"
        });
      } else {
        toast(
          copied > 0
            ? `${made} created, with ${copied} ${copied === 1 ? "subclass" : "subclasses"}.`
            : `${made} created.`,
          { tone: "success" }
        );
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't create that record.", { tone: "error" });
    } finally {
      setCreating(false);
    }
  };

  // Removed rows are excluded from both counts.
  const counts = useMemo(() => {
    const live = records.filter((record) => !record.deletedAt);
    return {
      total: live.length,
      drafts: live.filter((record) => record.state === "draft").length,
      published: live.filter((record) => record.state === "published").length
    };
  }, [records]);

  const usageCount = records.find((record) => record.id === selectedId)?.usageCount ?? 0;
  const hasSelection = selectedId !== null;
  // The wizard is a focused flow: it takes the whole width, and "All homebrew" is the way back to the list.
  const wizardOpen = mode === "wizard" && !!selected && !!WIZARDS[selected.type] && !selected.deletedAt;

  if (load === "loading") {
    return (
      <div className="hb-root">
        <div className="hb-modebar">
          <Skeleton width="12rem" />
        </div>
        {/* Mirrors the real layout so the pane doesn't jump when data lands. */}
        <div className="hb-workspace">
          <aside className="hb-rail">
            <Skeleton variant="block" height="2.75rem" />
            <Skeleton variant="block" height="2.75rem" />
            <Skeleton variant="block" height="12rem" />
          </aside>
          <section className="hb-main">
            <Skeleton variant="block" height="16rem" />
          </section>
        </div>
      </div>
    );
  }

  if (load !== "ready") {
    return (
      <div className="hb-root">
        <Alert
          tone={load === "unavailable" ? "info" : "warning"}
          title={load === "unavailable" ? "Homebrew isn't switched on yet" : "Couldn't load your homebrew"}
        >
          <p className="hb-unavailable-text">
            {load === "unavailable"
              ? "This table's server doesn't have the homebrew library yet, so there's nothing to show. Nothing you've made has been lost — it just isn't reachable from here."
              : loadMessage}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setLoad("loading");
              void refresh();
            }}
          >
            Try again
          </Button>
        </Alert>
      </div>
    );
  }

  return (
    <div className={`hb-root pane-frame pane-scene scanlines frame-col anim-view${wizardOpen ? " is-wizard" : ""}`}>
      <div className="pane-sky" aria-hidden="true" />
      <div className="hb-modebar">
        <p className="hb-count">
          {counts.total} {counts.total === 1 ? "record" : "records"}
          {counts.drafts > 0 && (
            <>
              {" "}
              &middot; {counts.drafts} {counts.drafts === 1 ? "draft" : "drafts"}
            </>
          )}
        </p>
        <PackActions gmToken={gmToken} onImported={() => void refresh()} />
      </div>

      <div className={`hb-workspace frame-fill${hasSelection ? " has-selection" : ""}`}>
        <HomebrewRail
          records={records}
          filters={filters}
          onFilters={setFilters}
          selectedId={selectedId}
          onSelect={(id) => void select(id)}
          onNew={() => setCreateOpen(true)}
        />

        <section className="hb-main">
          {/* Single-pane layout (≤760px) and the wizard: returns to the rail. */}
          {hasSelection && (
            <Button
              variant="ghost"
              size="sm"
              className="hb-back tap-target"
              onClick={() => {
                setSelectedId(null);
                setSelected(null);
              }}
            >
              <span className="hb-back-icon" aria-hidden="true">
                <IconChevron />
              </span>
              All homebrew
            </Button>
          )}

          {selectError ? (
            <Alert tone="warning" title="Couldn't open that record">
              <p>{selectError}</p>
            </Alert>
          ) : selected ? (
            <RecordDetail
              key={selected.id}
              gmToken={gmToken}
              record={selected}
              records={records}
              usageCount={usageCount}
              onChanged={(next) => {
                setSelected(next);
                patchRow(next);
              }}
              onSelect={(id) => void select(id)}
              mode={mode}
              onMode={setMode}
            />
          ) : hasSelection ? (
            <Skeleton variant="block" height="16rem" />
          ) : (
            <div className="nh-empty">
              <span className="nh-empty-title">Select a record</span>
              <span className="nh-empty-text">
                Every record starts as a draft only you can see. Publish it when it&rsquo;s ready, and choose then
                whether players can browse it.
              </span>
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                New homebrew
              </Button>
            </div>
          )}
        </section>
      </div>

      <CreateRecordModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(request) => void create(request)}
        records={records}
        busy={creating}
      />
    </div>
  );
}
