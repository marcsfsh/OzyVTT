import { useEffect, useId, useMemo, useState } from "react";
import { Input, Modal, Select, cx } from "@vtt/ui";
import { homebrewApi, type HomebrewSearch } from "../homebrew/api";
import { isHomebrewType } from "../homebrew/types";
import { useCompendium } from "./context";
import { usePacks, useTable } from "./data";
import { KINDS, KindIcon, kindLabel, kindPlural, type Kind } from "./kinds";
import { SourceMark } from "./pieces";
import { recordPath } from "./routes";

const NAME_HITS = 30;

/**
 * Search the SRD and homebrew (Ctrl K): names in every kind's table, and the homebrew's text with the line that
 * matched. Enter opens the first record; the Kind list narrows both.
 */
export function SearchDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const { token, go } = useCompendium();
  const all = useTable(token, null);
  const packs = usePacks(token).data?.packs ?? [];
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [text, setText] = useState<HomebrewSearch["hits"]>([]);
  const inputId = useId();
  const kindId = useId();
  const needle = q.trim().toLowerCase();

  const named = useMemo(() => {
    if (!needle) return [];
    return (all.data ?? [])
      .filter(
        (row) => !row.archived && (kind === "all" || row.kind === kind) && row.name.toLowerCase().includes(needle)
      )
      .sort(
        (left, right) =>
          Number(!left.name.toLowerCase().startsWith(needle)) - Number(!right.name.toLowerCase().startsWith(needle)) ||
          left.name.localeCompare(right.name)
      )
      .slice(0, NAME_HITS);
  }, [all.data, needle, kind]);

  // The text search asks the server once typing pauses.
  useEffect(() => {
    if (!needle) {
      setText([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      homebrewApi.search(token, needle, { ...(kind === "all" ? {} : { kind }), limit: 20 }).then(
        (answer) => {
          if (live) setText(answer.hits);
        },
        () => {
          if (live) setText([]);
        }
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [token, needle, kind]);

  const nameIds = new Set(named.map((row) => row.id));
  const inText = text.filter((hit) => !hit.archived && !nameIds.has(hit.id) && hit.matches.length > 0);
  const open = (target: Kind, id: string) => {
    onClose();
    go(recordPath(target, id));
  };
  const first = named[0] ?? null;

  return (
    <Modal open onClose={onClose} size="md" title="Search the SRD and homebrew" className="cp-search">
      <form
        className="cp-search-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (first) open(first.kind, first.id);
          else if (inText[0]) open(inText[0].kind, inText[0].id);
        }}
      >
        <label className="nh-sr-only" htmlFor={inputId}>
          Search
        </label>
        <Input
          id={inputId}
          autoFocus
          value={q}
          placeholder="A name, or words from a homebrew record"
          onChange={(event) => setQ(event.target.value)}
        />
        <label className="nh-sr-only" htmlFor={kindId}>
          Kind
        </label>
        <Select
          id={kindId}
          value={kind}
          onChange={(event) => setKind(isHomebrewType(event.target.value) ? event.target.value : "all")}
        >
          <option value="all">All kinds</option>
          {KINDS.map((option) => (
            <option key={option} value={option}>
              {kindPlural(option)}
            </option>
          ))}
        </Select>
      </form>
      <div className="cp-search-results scroll-y" aria-live="polite">
        {!needle ? (
          <p className="cp-hint">Type a name. Homebrew text is searched too.</p>
        ) : named.length === 0 && inText.length === 0 ? (
          <p className="cp-hint">{all.data ? "Nothing matches." : "Reading the tables."}</p>
        ) : (
          <>
            {named.length > 0 && (
              <ul className="cp-list" aria-label="Names">
                {named.map((row, index) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={cx("cp-row", index === 0 && "is-first")}
                      onClick={() => open(row.kind, row.id)}
                    >
                      <KindIcon kind={row.kind} />
                      <span className="cp-row-main">
                        <b>{row.name}</b>
                        <small>{kindLabel(row.kind).replace(/^./, (letter) => letter.toUpperCase())}</small>
                      </span>
                      <SourceMark row={row} packs={packs} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {inText.length > 0 && (
              <>
                <p className="cp-eyebrow">In homebrew text</p>
                <ul className="cp-list" aria-label="In homebrew text">
                  {inText.map((hit) => (
                    <li key={hit.id}>
                      <button type="button" className="cp-row" onClick={() => open(hit.kind, hit.id)}>
                        <KindIcon kind={hit.kind} />
                        <span className="cp-row-main">
                          <b>{hit.name}</b>
                          <small>{hit.matches[0]!.line}</small>
                        </span>
                        <SourceMark row={{ source: "homebrew", packId: hit.packId }} packs={packs} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
