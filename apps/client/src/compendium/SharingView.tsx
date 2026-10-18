import { useEffect, useMemo, useState } from "react";
import { Button, IconCheck, IconChevronRight, IconEyeOff, cx, useToast } from "@vtt/ui";
import { Dropdown } from "../codex/shared/Dropdown";
import { AudienceChip, WhoSeesItSwitch } from "../codex/shared/WhoSeesIt";
import { HIDDEN, toggleCharacter, type Audience } from "../codex/shared/audience";
import { homebrewApi, type HomebrewRecordDocument, type HomebrewRecordSummary } from "../homebrew/api";
import { TickDropdown } from "../scenes/listTools";
import { useCompendium } from "./context";
import { refreshCompendium, useHomebrewList } from "./data";
import { KINDS, KindIcon, kindPlural, type Kind } from "./kinds";
import { NameCell, PhoneHead } from "./pieces";
import { recordPath } from "./routes";
import { SharingTab } from "./record/SharingTab";

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
  const { token, party, phone, wide, go } = useCompendium();
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
  const [kinds, setKinds] = useState<readonly Kind[] | null>(null);
  const shownKinds = kinds ?? kindsHere;
  const rows = published.filter((row) => shownKinds.includes(row.type));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const focused = rows.find((row) => row.id === focus) ?? rows[0] ?? null;

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

  if (phone)
    return (
      <div className="cp-sharing scroll-y">
        <PhoneHead title="Sharing" />
        <div className="cp-phone-body">
          {rows.length === 0 ? (
            <p className="cp-hint">Nothing is published yet. A record is shared once it is published.</p>
          ) : (
            <ul className="cp-list" aria-label="Who sees what">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="cp-row"
                    onClick={() => go(`${recordPath(row.type, row.id)}?tab=sharing`)}
                  >
                    <KindIcon kind={row.type} />
                    <span className="cp-row-main">
                      <b>{row.name}</b>
                      <AudienceChip value={audienceOf(row)} party={party} />
                    </span>
                    <IconChevronRight />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );

  const allTicked = rows.length > 0 && rows.every((row) => selected.has(row.id));
  return (
    // Narrower than 980 the record's row stacks under the grid, and the view scrolls as one.
    <div className={cx("cp-sharing cp-sharing--laptop", !wide && "scroll-y")}>
      <section className="cp-sharing-grid" aria-label="Who sees what">
        <div className="cp-section-head">
          <h3 className="cp-h cp-grow">Who sees what</h3>
          {kindsHere.length > 1 && (
            <TickDropdown
              name="Published"
              options={kindsHere.map((kind) => ({ value: kind, label: kindPlural(kind) }))}
              selected={shownKinds}
              onChange={(next) => setKinds(next)}
            />
          )}
          <BulkWhoSeesIt count={selected.size} disabled={busy !== null} onSet={(audience) => void setMany(audience)} />
        </div>
        {rows.length === 0 ? (
          <p className="cp-hint">Nothing is published yet. A record is shared once it is published.</p>
        ) : (
          <div className="scroll-both cp-grid-wrap">
            <table className="cp-table cp-share-table">
              <thead>
                <tr>
                  <th scope="col" className="cp-pick-cell">
                    <input
                      type="checkbox"
                      className="cp-pick"
                      aria-label="Tick every record"
                      checked={allTicked}
                      onChange={() => setSelected(allTicked ? new Set() : new Set(rows.map((row) => row.id)))}
                    />
                  </th>
                  <th scope="col">Record</th>
                  <th scope="col" className="is-c">
                    Hidden
                  </th>
                  <th scope="col" className="is-c">
                    Everyone
                  </th>
                  {party.map((character) => (
                    <th key={character.id} scope="col" className="is-c">
                      {character.name.split(" ")[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const value = audienceOf(row);
                  const locked = busy !== null;
                  return (
                    <tr key={row.id} className={cx(focused?.id === row.id && "is-selected")}>
                      <td className="cp-pick-cell">
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
                      </td>
                      <th scope="row">
                        <button
                          type="button"
                          className="cp-rowlink"
                          aria-current={focused?.id === row.id ? "true" : undefined}
                          onClick={() => setFocus(row.id)}
                        >
                          <NameCell kind={row.type} name={row.name} />
                        </button>
                      </th>
                      <td className="is-c">
                        <GridBox
                          on={value.audience === "hidden"}
                          hidden
                          label={`${row.name}: Hidden`}
                          disabled={locked}
                          onToggle={() => value.audience !== "hidden" && void set(row, HIDDEN)}
                        />
                      </td>
                      <td className="is-c">
                        <GridBox
                          on={value.audience === "everyone"}
                          label={`${row.name}: Everyone`}
                          disabled={locked}
                          onToggle={() =>
                            void set(
                              row,
                              value.audience === "everyone" ? HIDDEN : { audience: "everyone", characterIds: [] }
                            )
                          }
                        />
                      </td>
                      {party.map((character) => (
                        <td key={character.id} className="is-c">
                          <GridBox
                            on={value.audience === "everyone" || value.characterIds.includes(character.id)}
                            covered={value.audience === "everyone"}
                            label={`${row.name}: ${character.name}`}
                            disabled={locked || value.audience === "everyone"}
                            onToggle={() => void set(row, toggleCharacter(value, character.id))}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <aside className="cp-sharing-side scroll-y" aria-label={focused ? focused.name : "A record"}>
        {focused ? <FocusedRecord row={focused} /> : <p className="cp-hint">Pick a record to see its row.</p>}
      </aside>
    </div>
  );
}

/** One square of the grid: ticked, Hidden's crossed eye, or ticked but covered by Everyone. */
function GridBox({
  on,
  hidden = false,
  covered = false,
  label,
  disabled,
  onToggle
}: Readonly<{
  on: boolean;
  hidden?: boolean;
  covered?: boolean;
  label: string;
  disabled: boolean;
  onToggle: () => void;
}>) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={cx("cp-gridbox", "interactive", on && "is-on", hidden && "is-hidden", covered && "is-covered")}
      onClick={onToggle}
    >
      {on && (hidden ? <IconEyeOff /> : <IconCheck />)}
    </button>
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

/** The picked record's own row: the full record, read for its reveal dates. */
function FocusedRecord({ row }: Readonly<{ row: HomebrewRecordSummary }>) {
  const { token, party } = useCompendium();
  const { toast } = useToast();
  const [doc, setDoc] = useState<HomebrewRecordDocument | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    homebrewApi.get(token, row.id).then(
      (answer) => {
        if (live) setDoc(answer);
      },
      () => {
        if (live) setDoc(null);
      }
    );
    return () => {
      live = false;
    };
  }, [token, row.id, row.rev]);
  if (!doc || doc.id !== row.id) return <p className="cp-hint">Reading {row.name}.</p>;
  return (
    <>
      <h3 className="cp-h">{row.name}</h3>
      <SharingTab
        doc={doc}
        kind={doc.type}
        name={row.name}
        party={party}
        busy={busy}
        onAudience={(audience) => {
          setBusy(true);
          homebrewApi
            .setAudience(token, doc.id, audience, doc.rev)
            .then(
              (next) => {
                setDoc(next);
                refreshCompendium();
              },
              (failure: unknown) =>
                toast(failure instanceof Error ? failure.message : "Couldn't change who sees that.", { tone: "error" })
            )
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}
