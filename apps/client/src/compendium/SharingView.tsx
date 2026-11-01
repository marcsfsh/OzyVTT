import { useMemo, useState } from "react";
import {
  Button,
  SideListGroup,
  SideListRow,
  WhoSeesItMenu,
  cx,
  useToast,
  Dropdown,
  WhoSeesItSwitch,
  HIDDEN,
  type Audience
} from "@vtt/ui";
import { homebrewApi, type HomebrewRecordSummary } from "../homebrew/api";
import { useCompendium } from "./context";
import { refreshCompendium, useHomebrewList } from "./data";
import { KINDS, KindIcon, kindLabel, kindPlural, type Kind } from "./kinds";

/** A kind's word starts a row, where the kit's words are written for the middle of a sentence. */
const upperFirst = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
import { recordPath } from "./routes";

const audienceOf = (row: HomebrewRecordSummary): Audience => ({
  audience: row.audience,
  characterIds: row.characterIds
});

/**
 * Who sees what, as one grid: every published record down the side, and Hidden, Everyone and each party character
 * across the top. A tick sets that record's audience at once; ticked rows take one Who sees it together. The record
 * picked in the grid shows its own row beside it, with where each audience meets it and since when.
 */
export function SharingView() {
  const { token, party, phone, go, query, setQuery } = useCompendium();
  const { toast } = useToast();
  const list = useHomebrewList(token);
  const published = useMemo(
    () =>
      (list.data ?? [])
        .filter((row) => row.state === "published" && !row.deletedAt)
        .sort(
          (left, right) => KINDS.indexOf(left.type) - KINDS.indexOf(right.type) || left.name.localeCompare(right.name)
        ),
    [list.data]
  );
  const kindsHere = KINDS.filter((kind) => published.some((row) => row.type === kind));
  // The kinds and who sees it narrow the rows, one choice each in the address (G pages spec 2.2).
  const kind = (query.get("kind") as Kind | null) ?? null;
  const who = query.get("who");
  const inKind = (row: HomebrewRecordSummary) => kind === null || row.type === kind;
  const inWho = (row: HomebrewRecordSummary, value: string | null) =>
    value === null || (value === "hidden" ? row.audience === "hidden" : row.audience !== "hidden");
  const rows = published.filter((row) => inKind(row) && inWho(row, who));
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const setFilter = (key: string, value: string | null) =>
    setQuery((params) => {
      if (value === null) params.delete(key);
      else params.set(key, value);
    });

  const set = async (row: HomebrewRecordSummary, audience: Audience) => {
    setBusy(row.id);
    try {
      await homebrewApi.setAudience(token, row.id, audience, row.rev);
      refreshCompendium();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "Couldn't change who sees that.", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  const setMany = async (audience: Audience) => {
    const targets = rows.filter((row) => selected.has(row.id));
    if (targets.length === 0) return;
    setBusy("many");
    try {
      await homebrewApi.setSharing(
        token,
        targets.map((row) => ({ id: row.id, expectedRev: row.rev })),
        audience
      );
      refreshCompendium();
      toast(`Who sees it is set for ${targets.length} ${targets.length === 1 ? "record" : "records"}.`, {
        tone: "success"
      });
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "Couldn't change who sees those.", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  if (!list.data) return <p className="cp-hint cp-pad">{list.error ?? "Reading who sees what."}</p>;

  // The row's line: its kind, then who it reached when that is characters by name.
  const lineOf = (row: HomebrewRecordSummary) => {
    const value = audienceOf(row);
    const names =
      value.audience === "characters"
        ? party.filter((character) => value.characterIds.includes(character.id)).map((character) => character.name)
        : [];
    return [upperFirst(kindLabel(row.type)), ...names].join(" · ");
  };

  const kindRows = [
    { value: null as Kind | null, label: "All homebrew" },
    ...kindsHere.map((value) => ({ value, label: upperFirst(kindPlural(value)) }))
  ];
  const side = phone ? (
    <div className="nh-filterchips" role="group" aria-label="Kinds">
      {kindRows.map((entry) => (
        <button
          key={entry.label}
          type="button"
          className={cx("nh-filterchip", "interactive", kind === entry.value && "is-on")}
          aria-pressed={kind === entry.value}
          onClick={() => setFilter("kind", entry.value)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  ) : (
    <>
      <SideListGroup eyebrow="Kinds">
        {kindRows.map((entry) => (
          <SideListRow
            key={entry.label}
            label={entry.label}
            leading={entry.value ? <KindIcon kind={entry.value} /> : undefined}
            count={published.filter((row) => entry.value === null || row.type === entry.value).length}
            current={kind === entry.value}
            onSelect={() => setFilter("kind", entry.value)}
          />
        ))}
      </SideListGroup>
      <SideListGroup eyebrow="Who sees it">
        {(
          [
            ["shared", "Shared"],
            ["hidden", "Hidden"]
          ] as const
        ).map(([value, label]) => (
          <SideListRow
            key={value}
            label={label}
            count={published.filter((row) => inKind(row) && inWho(row, value)).length}
            current={who === value}
            onSelect={() => setFilter("who", who === value ? null : value)}
          />
        ))}
      </SideListGroup>
    </>
  );

  const allTicked = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const toolbar = (
    <div className="cp-sharing-toolbar">
      <span className="cp-sharing-count" role="status">
        {`${rows.length} ${rows.length === 1 ? "record" : "records"}`}
      </span>
      {choosing && (
        <BulkWhoSeesIt count={selected.size} disabled={busy !== null} onSet={(audience) => void setMany(audience)} />
      )}
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={choosing}
        onClick={() => {
          setChoosing((on) => !on);
          setSelected(new Set());
        }}
      >
        {choosing ? "Done choosing" : "Choose"}
      </Button>
    </div>
  );
  const list_ =
    rows.length === 0 ? (
      <p className="cp-hint">Nothing is published yet. A record is shared once it is published.</p>
    ) : (
      <ul className="cp-share-rows" aria-label="Who sees what">
        {choosing && (
          <li className="cp-share-row is-all">
            <input
              type="checkbox"
              className="cp-pick"
              aria-label="Tick every record"
              checked={allTicked}
              onChange={() => setSelected(allTicked ? new Set() : new Set(rows.map((row) => row.id)))}
            />
            <span className="cp-hint">Every record shown</span>
          </li>
        )}
        {rows.map((row) => {
          const value = audienceOf(row);
          return (
            <li key={row.id} className={cx("cp-share-row", phone && "is-phone")}>
              {choosing && (
                <input
                  type="checkbox"
                  className="cp-pick"
                  aria-label={`Tick ${row.name}`}
                  checked={selected.has(row.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(row.id)) next.delete(row.id);
                    else next.add(row.id);
                    setSelected(next);
                  }}
                />
              )}
              <KindIcon kind={row.type} />
              <button
                type="button"
                className="cp-share-name"
                onClick={() => go(`${recordPath(row.type, row.id)}?tab=sharing`)}
              >
                <b className={cx(value.audience === "hidden" && "is-hidden")}>{row.name}</b>
                <small>{lineOf(row)}</small>
              </button>
              <WhoSeesItMenu
                value={value}
                party={party}
                what={row.name}
                disabled={busy !== null}
                onChange={(next) => void set(row, next)}
              />
            </li>
          );
        })}
      </ul>
    );

  if (phone)
    return (
      <div className="cp-sharing scroll-y">
        <div className="cp-phone-body">
          {side}
          {toolbar}
          {list_}
        </div>
      </div>
    );

  return (
    <div className="cp-sharing cp-sharing-split">
      <nav className="cp-sharing-sideList scroll-y" aria-label="Narrow who sees what">
        {side}
      </nav>
      <div className="cp-sharing-main scroll-y">
        {toolbar}
        {list_}
      </div>
    </div>
  );
}

/** The bulk Who sees it: one audience for every ticked row, set in one write. */
function BulkWhoSeesIt({
  count,
  disabled,
  onSet
}: Readonly<{ count: number; disabled: boolean; onSet: (audience: Audience) => void }>) {
  const { party } = useCompendium();
  const [value, setValue] = useState<Audience>(HIDDEN);
  if (count === 0)
    return (
      <Button size="sm" disabled>
        Tick records to set them together
      </Button>
    );
  return (
    <Dropdown label={`Set for ${count} selected`} align="end" panelClassName="cp-bulk">
      {(close) => (
        <div className="cp-bulk-body">
          <WhoSeesItSwitch
            value={value}
            party={party}
            what={count === 1 ? "the ticked record" : `the ${count} ticked records`}
            onChange={setValue}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onSet(value);
              close();
            }}
          >
            Set for {count}
          </Button>
        </div>
      )}
    </Dropdown>
  );
}
