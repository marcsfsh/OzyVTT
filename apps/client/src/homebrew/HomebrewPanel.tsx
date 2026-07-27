/**
 * The Homebrew tab: one master-detail library over all nine content types.
 *
 * **No second nav axis.** The Codex's answer to "where do the library-wide operations
 * go" is a modebar (`.codex-modebar-ops`), and homebrew mirrors that structure with no
 * level-2 tab bar at all. A two-item tab bar where one tab holds two buttons is
 * redundancy; packs are stateless files, not a place you navigate to. The modebar's
 * left side carries a derived count line so the bar is informative rather than empty.
 *
 * **The panel is conditionally mounted** (`main.tsx` renders it only while the tab is
 * active), so a tab switch destroys this component and all of its state. That is
 * exactly why every change is parked on the server as it is made (`useAutosave`)
 * rather than held as an in-memory draft.
 *
 * **Honest degradation.** The authoring store is not mounted on the server yet. A
 * failed read renders a named condition with a Retry, never a blank library — an empty
 * grid would be indistinguishable from "you have not made anything", which is the one
 * thing this screen must never be ambiguous about.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Skeleton, useToast } from "@vtt/ui";
import { IconChevron } from "@vtt/ui";
import { socket } from "../socket";
import { CreateRecordModal, type CreateRequest } from "./CreateRecordModal";
import { HomebrewRail, EMPTY_FILTERS, type RailFilters } from "./HomebrewRail";
import { RecordDetail } from "./RecordDetail";
import { HomebrewRequestError, homebrewApi, listAllHomebrew, type HomebrewRecordDocument, type HomebrewRecordSummary } from "./api";
import { typeLabel } from "./types";
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

  const refresh = useCallback(async () => {
    try {
      const rows = await listAllHomebrew(gmToken);
      setRecords(rows);
      setLoad("ready");
      setLoadMessage(null);
    } catch (error) {
      // 404 means the router isn't mounted; 501 would mean it is but the store isn't.
      // Both are "not built yet", and both deserve a different sentence from "it broke".
      const status = error instanceof HomebrewRequestError ? error.status : 0;
      setLoad(status === 404 || status === 501 ? "unavailable" : "error");
      setLoadMessage(error instanceof Error ? error.message : "Couldn't load your homebrew.");
    }
  }, [gmToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * `homebrew:changed` is a content-free ping carrying only a revision, so it can never
   * leak an unpublished record to anyone — every recipient refetches its own
   * audience-filtered view over HTTP. It refreshes **the list only**: `selected` is
   * deliberately untouched, so a refresh can never clobber an open editor out from
   * under the GM's cursor. The summary row is patched in place by the editor itself
   * (`patchRow`), which is the other half of the same rule.
   */
  useEffect(() => {
    const onChanged = () => void refresh();
    socket.on("homebrew:changed", onChanged);
    return () => {
      socket.off("homebrew:changed", onChanged);
    };
  }, [refresh]);

  // A summary row is patched IN PLACE by the detail pane rather than triggering a list
  // reload, so an open editor is never clobbered by a refresh it did not ask for.
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
        valid: next.validity.valid
      };
      const copy = rows.slice();
      copy[index] = merged;
      return copy;
    });
  }, []);

  const select = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setSelected(null);
      setSelectError(null);
      try {
        setSelected(await homebrewApi.get(gmToken, id));
      } catch (error) {
        setSelectError(error instanceof Error ? error.message : "Couldn't open that record.");
      }
    },
    [gmToken]
  );

  const create = async (request: CreateRequest) => {
    setCreating(true);
    try {
      const created =
        request.mode === "duplicate"
          ? // No name is sent: the server already derives "{source} (copy)". Passing one
            // ourselves produced "Fireball (copy) (copy)" — naming is the server's job,
            // and doing it in both places is how the two get to disagree.
            await homebrewApi.duplicate(gmToken, request.sourceId)
          : // Blank records carry only their type discriminator and a placeholder name.
            // A draft is ALLOWED to be invalid — that is the whole point of the state —
            // so the create call does not have to satisfy the type's full schema.
            await homebrewApi.create(gmToken, { type: request.type, name: `New ${typeLabel(request.type)}` });
      setCreateOpen(false);
      await refresh();
      setSelectedId(created.id);
      setSelected(created);
      const name = typeof created.record.name === "string" ? created.record.name : "";
      toast(name ? `${name} created.` : `New ${typeLabel(request.type)} created.`, { tone: "success" });
    } catch (error) {
      // The contract says `/duplicate` accepts an SRD id, and the picker offers SRD
      // records on that basis — but the server answers 404 for one today. "That record
      // no longer exists" is a misleading thing to tell a GM about Acid Arrow, so the
      // one case that has a different cause gets its own sentence. It stops being
      // reachable the moment the server implements it; nothing here needs removing.
      const srdGap =
        request.mode === "duplicate" &&
        request.origin === "srd" &&
        error instanceof HomebrewRequestError &&
        error.status === 404;
      toast(
        srdGap
          ? `Copying SRD records isn't switched on yet, so ${request.sourceName} can't be duplicated. Start from blank instead.`
          : error instanceof Error
            ? error.message
            : "Couldn't create that record.",
        { tone: "error" }
      );
    } finally {
      setCreating(false);
    }
  };

  // Derived, never stored. "12 records · 4 drafts" — removed rows are excluded from
  // both counts, because a removed record is not part of the library you have.
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

  if (load === "loading") {
    return (
      <div className="hb-root">
        <div className="hb-modebar"><Skeleton width="12rem" /></div>
        {/* Mirrors the real layout so the pane doesn't jump when the data lands. */}
        <div className="hb-workspace">
          <aside className="hb-rail">
            <Skeleton variant="block" height="2.75rem" />
            <Skeleton variant="block" height="2.75rem" />
            <Skeleton variant="block" height="12rem" />
          </aside>
          <section className="hb-main"><Skeleton variant="block" height="16rem" /></section>
        </div>
      </div>
    );
  }

  if (load !== "ready") {
    return (
      <div className="hb-root">
        <Alert tone={load === "unavailable" ? "info" : "warning"} title={load === "unavailable" ? "Homebrew isn't switched on yet" : "Couldn't load your homebrew"}>
          <p className="hb-unavailable-text">
            {load === "unavailable"
              ? "This table's server doesn't have the homebrew library yet, so there's nothing to show. Nothing you've made has been lost — it just isn't reachable from here."
              : loadMessage}
          </p>
          <Button variant="secondary" onClick={() => { setLoad("loading"); void refresh(); }}>Try again</Button>
        </Alert>
      </div>
    );
  }

  return (
    <div className="hb-root">
      {/* Ops (Export / Import) land here next to the count line, Codex-style. Nothing
          is rendered for them yet: a disabled button that never becomes enabled is a
          worse answer than an honest gap. */}
      <div className="hb-modebar">
        <p className="hb-count">
          {counts.total} {counts.total === 1 ? "record" : "records"}
          {counts.drafts > 0 && <> &middot; {counts.drafts} {counts.drafts === 1 ? "draft" : "drafts"}</>}
        </p>
      </div>

      {/* The one honest caveat, stated ONCE for the whole library rather than on every
          published record: the store's `publishedFor` returns an empty slice for both
          audiences today, so publishing does not yet put anything in the builder or the
          pickers. Saying nothing would let a GM publish, go looking, and conclude their
          work was lost. It annotates the exception — it appears only once something is
          published — and it comes out the day the catalog merge lands. */}
      {counts.published > 0 && (
        <Alert tone="info" className="hb-caveat">
          Published records don&rsquo;t reach the character builder or the encounter and inventory pickers yet — that merge is still being built. Everything you author here is saved.
        </Alert>
      )}

      <div className={`hb-workspace${hasSelection ? " has-selection" : ""}`}>
        <HomebrewRail
          records={records}
          filters={filters}
          onFilters={setFilters}
          selectedId={selectedId}
          onSelect={(id) => void select(id)}
          onNew={() => setCreateOpen(true)}
        />

        <section className="hb-main">
          {/* Single-pane swap at ≤760px: the rail hides and this returns to it. The
              quarter-turned disclosure caret is the system's own back shape — no bare
              glyph, no drawn arrow (WizardShell.tsx:124-129). */}
          {hasSelection && (
            <Button
              variant="ghost"
              size="sm"
              className="hb-back tap-target"
              onClick={() => { setSelectedId(null); setSelected(null); }}
            >
              <span className="hb-back-icon" aria-hidden="true"><IconChevron /></span>
              All homebrew
            </Button>
          )}

          {selectError
            ? <Alert tone="warning" title="Couldn't open that record"><p>{selectError}</p></Alert>
            : selected
              ? <RecordDetail
                  key={selected.id}
                  gmToken={gmToken}
                  record={selected}
                  records={records}
                  usageCount={usageCount}
                  onChanged={(next) => { setSelected(next); patchRow(next); }}
                  onRemoved={() => setFilters((prev) => ({ ...prev, status: "removed" }))}
                />
              : hasSelection
                ? <Skeleton variant="block" height="16rem" />
                : <div className="nh-empty">
                    <span className="nh-empty-title">Select a record</span>
                    <span className="nh-empty-text">
                      Every record starts as a draft only you can see. Publish it when it&rsquo;s ready, and choose then whether players can browse it.
                    </span>
                    <Button variant="primary" onClick={() => setCreateOpen(true)}>New homebrew</Button>
                  </div>}
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
