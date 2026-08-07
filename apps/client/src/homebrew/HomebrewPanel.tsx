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
import { blankDraft } from "./defaults";
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

  /**
   * The records that have to be copied WITH a class for the copy to stand up.
   *
   * `homebrew-srd-copy.ts` re-points the copy's subclass pick from `fighter-subclasses`
   * to `<newId>-subclasses` — it must, or the copy would offer FIGHTER's subclasses and
   * `character-build.ts` would hard-reject every build made from it. But that family
   * matches nothing until a subclass names the copy, so "duplicate Fighter" landed a
   * record whose Publish was disabled before the GM had touched anything. The route the
   * create modal itself calls "the only tractable one for a class" failed on first use.
   *
   * So the copy brings them: duplicate each subclass through the same endpoint, then
   * re-point its `classId` at the new class. Two calls per subclass and no new server
   * surface. The count was already stated in the modal before Create was pressed.
   *
   * Partial failure is reported, never swallowed: a class with three of its four
   * subclasses is still publishable and still correct, and the GM is told which one is
   * missing rather than discovering the gap at the table.
   */
  const copyCompanions = async (
    classId: string,
    companions: ReadonlyArray<Readonly<{ id: string; name: string }>>
  ): Promise<readonly string[]> => {
    const failed: string[] = [];
    for (const companion of companions) {
      try {
        const copy = await homebrewApi.duplicate(gmToken, companion.id);
        // The server keeps `classId` verbatim — correctly, since it names a SEPARATE
        // record that usually still exists. Here it must follow the copy instead.
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
          ? // No name is sent: the server already derives "{source} (copy)". Passing one
            // ourselves produced "Fireball (copy) (copy)" — naming is the server's job,
            // and doing it in both places is how the two get to disagree.
            await homebrewApi.duplicate(gmToken, request.sourceId)
          : // A blank record is created WITH its type's blank draft, not with a bare
            // `{type, name}` the editor then quietly PATCHes on first open. A draft is
            // allowed to be invalid — that is the whole point of the state — so this does
            // not have to satisfy the type's schema; it just has to be the same body the
            // form is about to show, or opening the record is itself a write.
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
      // Re-read after the companions land: the class's validity is the SERVER's answer
      // and it was computed before its subclasses existed. Without this the record opens
      // with a stale "no subclass names this class yet" that is no longer true.
      setSelected(companions.length > 0 ? await homebrewApi.get(gmToken, created.id) : created);

      const name = typeof created.record.name === "string" ? created.record.name : "";
      const made = name || `New ${typeLabel(request.type)}`;
      const copied = companions.length - failed.length;
      if (failed.length > 0) {
        // `info`, not `error`: the record the GM asked for DID get made, and a class with
        // some of its subclasses is still correct. The sentence names what is missing and
        // what to do; the tone says nothing failed outright, because nothing did.
        toast(`${made} created, but ${failed.join(" and ")} couldn't be copied. Add a subclass before publishing.`, { tone: "info" });
      } else {
        toast(copied > 0 ? `${made} created, with ${copied} ${copied === 1 ? "subclass" : "subclasses"}.` : `${made} created.`, { tone: "success" });
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't create that record.", { tone: "error" });
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
    /* THE FRAME (§7): the modebar is chrome that never moves, the workspace below it is the fill, and
       the library stands on the scene sky. Its two panes each scroll themselves. */
    <div className="hb-root pane-frame pane-scene scanlines frame-col anim-view">
      <div className="pane-sky" aria-hidden="true" />
      {/* Ops (Export / Import) land here next to the count line, Codex-style. Nothing
          is rendered for them yet: a disabled button that never becomes enabled is a
          worse answer than an honest gap. */}
      <div className="hb-modebar">
        <p className="hb-count">
          {counts.total} {counts.total === 1 ? "record" : "records"}
          {counts.drafts > 0 && <> &middot; {counts.drafts} {counts.drafts === 1 ? "draft" : "drafts"}</>}
        </p>
      </div>

      {/* The catalog merge has landed: a published record reaches the GM's own builder and
          pickers at once, and a published + shown one reaches the players' too (measured —
          publishing and revealing one spell took /content/spells from 339 to 340). The
          caveat that used to stand here said the opposite, so it came out rather than
          being reworded: the two states already say this in words on the record itself
          (Draft / Published / Shown to players), and repeating it as a library-wide banner
          would state the same constraint a second time for no new information. */}

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
                  onSelect={(id) => void select(id)}
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
