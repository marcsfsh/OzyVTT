import { useMemo, useState, type ReactNode } from "react";
import {
  resolveSpellcasting,
  type ActorDefinition,
  type ContentActionSummary,
  type ContentSpellSummary,
  type Rechoice,
  type SpellChoices
} from "@vtt/domain";
import { Button, GmOnlyTag, IconCheck, SegmentedControl, Select } from "@vtt/ui";
import { spellAttackBonus, spellSaveDc } from "@vtt/rules-5e";
import { signed, titleCase } from "../encounter/format";
import { SpellSwapModal } from "../encounter/SpellChoiceModals";
import { SpellCard, useSpellReference } from "../encounter/spells";
import { summaryOfOwnAction } from "../encounter/PlayerActionRunner";
import { CastDetail } from "./CastDetail";
import { SheetDetail, type DetailPlace } from "./SheetDetail";
import { characterLevel, type SheetActor } from "./sheet-model";
import { SpellbookPanel, type CopyableScroll } from "./SpellbookPanel";
import {
  castOptions,
  freeCastOf,
  keepsPreparedList,
  preparedState,
  slotPools,
  spellEffectAt,
  spellLine,
  type CastOption,
  type SheetSpellEntry,
  type SlotPool
} from "./spell-model";
import type { SheetEdit } from "./useSheetEdit";
import type { SheetRolls } from "./useSheetRolls";

/** "book" is the laptop's and the GM's list (Prepared, Spellbook, Rituals); "list" is a player's phone list (All,
 *  Prepared, Rituals) with a circle that says where each spell stands. */
export type SpellsLook = "book" | "list";

type RowState = ReturnType<typeof preparedState> | "book";

/** One spell as both lists show it. */
type SpellRow = Readonly<{
  id: string;
  name: string;
  level: number;
  /** The sheet's entry; absent for a spell only in the spellbook. */
  spell: SheetSpellEntry | null;
  content: ContentSpellSummary | undefined;
  state: RowState;
  line: string;
  concentration: boolean;
  ritual: boolean;
  free: { left: number | null } | null;
}>;

const STATE_WORDS: Readonly<Record<RowState, string>> = {
  cantrip: "Cantrip",
  always: "Kept prepared by a feature",
  prepared: "Prepared",
  unprepared: "Not prepared",
  book: "Only in the spellbook"
};

/** One pool's slots as tappable pips: a filled pip spends down to it, an empty one restores up to it. */
function SlotPips({
  label,
  pipLabel,
  pool,
  busy,
  onSet
}: Readonly<{ label: string; pipLabel: string; pool: SlotPool; busy: boolean; onSet: (remaining: number) => void }>) {
  return (
    <span className="cs-slotpips" role="group" aria-label={`${label} (${pool.remaining} of ${pool.max} left)`}>
      {Array.from({ length: pool.max }, (_, index) => (
        <button
          key={index}
          type="button"
          className={`cs-pip interactive${index < pool.remaining ? " is-on" : ""}`}
          disabled={busy}
          aria-label={`${index < pool.remaining ? "Spend" : "Restore"} ${pipLabel}`}
          onClick={() => onSet(index < pool.remaining ? index : index + 1)}
        />
      ))}
      <span className="cs-count">
        {pool.remaining}/{pool.max}
      </span>
    </span>
  );
}

/**
 * The Spells tab: the casting numbers, the slots by level, and every spell with one line on what it does. A laptop
 * and the GM get the Prepared, Spellbook and Rituals views; a player's phone gets All, Prepared and Rituals with a
 * circle per spell. Both read the same rows. The step a Long Rest opens turns the prepared marks into switches. A cast
 * opens its detail (each slot level with what it buys), placed by the sheet's width; the server spends the slot and
 * resolves the spell.
 */
export function SpellsTab({
  actor,
  definition,
  role,
  look = "book",
  place = { kind: "inline" },
  busy,
  edit,
  rolls,
  onFeedback,
  serverActions = [],
  aimed = false,
  routeSpell,
  castSpellAction,
  spellSaveDcBonus = 0,
  policeSlots = true,
  canPrepare = true,
  rechoices = [],
  spellChoices = null,
  readiedActionId = null
}: Readonly<{
  actor: SheetActor;
  definition: ActorDefinition;
  role: "gm" | "player";
  look?: SpellsLook;
  place?: DetailPlace;
  busy: boolean;
  edit: SheetEdit;
  rolls: SheetRolls;
  onFeedback: (text: string) => void;
  /** The server's rows for this character, whose numbers include its riders. */
  serverActions?: readonly ContentActionSummary[];
  /** A cast goes on to targeting (the character's turn in a fight); otherwise the server rolls it at once. */
  aimed?: boolean;
  /** Hands a spell with no slot action to the turn's targeting; false when it has none now. */
  routeSpell: (spell: SheetSpellEntry) => boolean;
  /** Casts a spell through its action (with a slot, or a grant's free casting); the server spends it. */
  castSpellAction: (actionId: string, slotLevel?: number) => void;
  /** The server's sum of standing spell-save-DC riders (an item, a feat). */
  spellSaveDcBonus?: number;
  /** Whether a cast with no slot left, or of a spell not prepared, is refused here. */
  policeSlots?: boolean;
  /** The prepared marks work now: in the step a Long Rest opens, and for the GM. */
  canPrepare?: boolean;
  /** Picks the character may re-make after a Long Rest (a Land Druid's land), chosen in the prepare step. */
  rechoices?: readonly Rechoice[];
  /** What a prepared caster may swap in after a Long Rest, and a Wizard's spellbook. */
  spellChoices?: SpellChoices | null;
  /** The cast a Ready holds, already paid for: released by casting it, whatever slots are left. */
  readiedActionId?: string | null;
}>) {
  const spellReference = useSpellReference();
  const spellIndex = useMemo(() => new Map(spellReference.map((entry) => [entry.id, entry])), [spellReference]);
  // The step a Long Rest opens shows the whole list, where the spells to prepare are.
  const [view, setView] = useState<"all" | "prepared" | "rituals">(
    look === "book" && !actor.preparation ? "prepared" : "all"
  );
  const [casting, setCasting] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "add" | "copy">(null);
  const [swapping, setSwapping] = useState(false);
  const [openSpell, setOpenSpell] = useState<ContentSpellSummary | null>(null);
  // The GM changes prepared spells any time, behind one switch; a player in the step a Long Rest opens.
  const [gmEditing, setGmEditing] = useState(false);
  const spellcasting = definition.spellcasting;
  if (!spellcasting) return null;

  const level = characterLevel(definition) ?? 1;
  const inStep = actor.preparation != null;
  const preparing = role === "gm" ? gmEditing || inStep : inStep && canPrepare;
  const keepsList = keepsPreparedList(definition);
  const book = spellChoices?.spellbook ?? null;
  const castable = actor.kind === "player-character";
  const { slots, pact } = slotPools(definition, actor);
  const actionOf = (actionId: string | null | undefined): ContentActionSummary | null => {
    if (!actionId) return null;
    const row = serverActions.find((candidate) => candidate.id === actionId);
    if (row) return row;
    const own = definition.actions.find((candidate) => candidate.id === actionId);
    return own ? summaryOfOwnAction(own) : null;
  };

  // The rows: the sheet's spells, then any only in the spellbook.
  const onSheet = new Set(spellcasting.spells.map((spell) => spell.id));
  const rows: SpellRow[] = [
    ...spellcasting.spells.map((spell): SpellRow => {
      const content = spellIndex.get(spell.id);
      return {
        id: spell.id,
        name: spell.name,
        level: spell.level,
        spell,
        content,
        state: preparedState(spell, actor, definition),
        line: spellLine(spell, content, actionOf(spell.actionId), level),
        concentration: content?.concentration === true,
        ritual: spell.ritualActionId !== undefined || content?.ritual === true,
        free: freeCastOf(spell, definition, actor)
      };
    }),
    ...(book?.spellIds ?? [])
      .filter((id) => !onSheet.has(id))
      .map((id): SpellRow => {
        const content = spellIndex.get(id);
        return {
          id,
          name: content?.name ?? titleCase(id.replace(/-/g, " ")),
          level: content?.level ?? 1,
          spell: null,
          content,
          state: "book",
          line: spellLine({ level: content?.level ?? 1 }, content, null, level),
          concentration: content?.concentration === true,
          ritual: content?.ritual === true,
          free: null
        };
      })
  ];
  const shown = rows.filter((row) =>
    view === "prepared"
      ? row.state === "cantrip" || row.state === "always" || row.state === "prepared"
      : view === "rituals"
        ? row.ritual
        : true
  );
  const levels = [...new Set(shown.map((row) => row.level))].sort((left, right) => left - right);

  // The casting numbers, one line per casting class.
  const casterEntries = spellcasting.classes ?? [];
  const casterLines = (casterEntries.length > 0 ? casterEntries.map((entry) => entry.classId) : [undefined]).flatMap(
    (classId) => {
      const resolved = resolveSpellcasting(spellcasting, classId);
      if (!resolved) return [];
      const dc =
        (resolved.saveDc ?? spellSaveDc(definition.abilityScores[resolved.ability], definition.proficiencyBonus)) +
        spellSaveDcBonus;
      const attack =
        resolved.attackBonus ??
        spellAttackBonus(definition.abilityScores[resolved.ability], definition.proficiencyBonus);
      const className =
        casterEntries.length > 1 && classId
          ? (definition.character?.classes?.find((entry) => entry.id === classId)?.name ?? titleCase(classId))
          : null;
      return [
        `${className ? `${className}: ` : ""}Spell save DC ${dc} · Spell attack ${signed(attack)} · ${resolved.ability.toUpperCase()}`
      ];
    }
  );

  // The prepare step's count: the spells that count against the cap, of the cap.
  const cap = casterEntries.reduce((sum, entry) => sum + (entry.prepared ?? 0), 0);
  const counted = spellcasting.spells.filter(
    (spell) => spell.level > 0 && !spell.alwaysPrepared && (actor.preparedSpellIds ?? []).includes(spell.id)
  ).length;

  const nameOf = (id: string) => spellIndex.get(id)?.name ?? rows.find((row) => row.id === id)?.name ?? id;
  const choicesOf = (row: SpellRow): CastOption[] =>
    row.spell
      ? castOptions({
          spell: row.spell,
          definition,
          actor,
          content: row.content,
          policeSlots: policeSlots && row.spell.actionId !== readiedActionId,
          prepared: row.state !== "unprepared"
        })
      : [];

  /** A slot cast: through the spell's action when it has one, else the slot is spent here and its dice rolled. */
  const castAtSlot = (spell: SheetSpellEntry, content: ContentSpellSummary | undefined, slotLevel: number) => {
    if (spell.actionId && definition.actions.some((action) => action.id === spell.actionId && action.spellSlot)) {
      castSpellAction(spell.actionId, slotLevel);
      return;
    }
    // A Pact Magic slot goes first at its level, as the server spends them.
    const fromPact = pact !== null && pact.level === slotLevel && pact.remaining > 0;
    const pool = slots.find((entry) => entry.level === slotLevel);
    const left = fromPact ? pact.remaining : (pool?.remaining ?? 0);
    const none = !fromPact && left <= 0;
    if (none && policeSlots) {
      onFeedback(`No level ${slotLevel} spell slots left.`);
      return;
    }
    const { formula } = spellEffectAt(content, spell.level, slotLevel);
    const types = content && content.damageTypes.length > 0 ? ` ${content.damageTypes.join("/")}` : "";
    const spend = none
      ? Promise.resolve({ ok: true })
      : edit("character:set-slot", {
          actorId: actor.id,
          level: slotLevel,
          remaining: left - 1,
          ...(fromPact ? { pact: true } : {})
        });
    void spend.then((result) => {
      if (!result.ok) return;
      if (routeSpell(spell)) return;
      if (formula) void rolls.rollFlat(formula, "damage", `${spell.name} at level ${slotLevel}${types}`);
      else onFeedback(`Cast ${spell.name} with a level ${slotLevel} spell slot.`);
    });
  };
  /** A cantrip: through its action, else its die rolled here or a note that it was cast. */
  const castCantrip = (spell: SheetSpellEntry, content: ContentSpellSummary | undefined) => {
    if (spell.actionId) {
      castSpellAction(spell.actionId);
      return;
    }
    if (routeSpell(spell)) return;
    const { formula } = spellEffectAt(content, 0, 0, level);
    const types = content && content.damageTypes.length > 0 ? ` ${content.damageTypes.join("/")}` : "";
    if (formula) void rolls.rollFlat(formula, "damage", `${spell.name}${types}`);
    else onFeedback(`Cast ${spell.name}.`);
  };
  const castWith = (row: SpellRow, choice: CastOption) => {
    const spell = row.spell!;
    setCasting(null);
    if (choice.kind === "cantrip") castCantrip(spell, row.content);
    else if (choice.kind === "free" && spell.freeActionId) castSpellAction(spell.freeActionId);
    else if (choice.kind === "ritual" && spell.ritualActionId) castSpellAction(spell.ritualActionId);
    else castAtSlot(spell, row.content, choice.level);
  };
  /** A tap on Cast: one way to cast it goes at once, several open the cast detail. */
  const startCast = (row: SpellRow) => {
    const choices = choicesOf(row);
    if (choices.length === 1 && choices[0]!.available && choices[0]!.kind !== "slot") castWith(row, choices[0]!);
    else setCasting(row.id);
  };
  const setPrepared = (row: SpellRow, prepared: boolean) =>
    void edit("character:set-prepared", { actorId: actor.id, spellId: row.id, prepared });

  const swappable = (spellChoices?.swaps ?? []).some((swap) => swap.spellIds.length > 0 && swap.replaces.length > 0);
  const copyableScrolls: CopyableScroll[] = (actor.inventory ?? []).flatMap((item) =>
    item.spellId && item.quantity > 0 && book?.addable.includes(item.spellId)
      ? [{ itemId: item.id, spellId: item.spellId }]
      : []
  );
  const swapIn = (spellId: string, replaces: string) =>
    void edit("character:swap-spell", { actorId: actor.id, spellId, replaces }).then((result) => {
      if (!result.ok) return;
      setSwapping(false);
      onFeedback(`${nameOf(spellId)} is prepared in place of ${nameOf(replaces)}.`);
    });
  const addToBook = (spellId: string, from: "level" | "scroll" | "book", itemId?: string) =>
    void edit("character:add-to-spellbook", {
      actorId: actor.id,
      spellId,
      from,
      ...(itemId !== undefined ? { itemId } : {})
    }).then((result) => {
      if (!result.ok) return;
      setPanel(null);
      onFeedback(
        result.inBook === false
          ? `The copy of ${nameOf(spellId)} failed, and the scroll is gone.`
          : `${nameOf(spellId)} is in the spellbook.`
      );
    });

  const castingRow = casting ? rows.find((row) => row.id === casting && row.spell) : undefined;
  const castDetail = castingRow?.spell ? (
    <CastDetail
      spell={castingRow.spell}
      action={actionOf(castingRow.spell.actionId)}
      content={castingRow.content}
      options={choicesOf(castingRow)}
      aimed={aimed}
      busy={busy}
      onBack={() => setCasting(null)}
      onCast={(choice) => castWith(castingRow, choice)}
    />
  ) : null;
  const bookPanel =
    panel && book ? (
      <SpellbookPanel
        mode={panel}
        name={actor.name}
        spellbook={book}
        scrolls={copyableScrolls}
        gm={role === "gm"}
        spellIndex={spellIndex}
        busy={busy}
        onAdd={addToBook}
        onClose={() => setPanel(null)}
      />
    ) : null;

  // On a phone the cast replaces the list, with a way back.
  if (castDetail && place.kind === "inline") return <div className="cs-spells">{castDetail}</div>;

  const rowAction = (row: SpellRow): ReactNode => {
    if (look === "book" && preparing && row.spell && row.state !== "always" && row.state !== "cantrip")
      return (
        <button
          type="button"
          className={`cs-prep interactive${row.state === "prepared" ? " is-on" : ""}${role === "gm" && !inStep ? " is-gm" : ""}`}
          aria-pressed={row.state === "prepared"}
          aria-label={`Prepare ${row.name}`}
          disabled={busy}
          onClick={() => setPrepared(row, row.state !== "prepared")}
        >
          {row.state === "prepared" && <IconCheck />}
          {row.state === "prepared" ? "Prepared" : "Prepare"}
        </button>
      );
    if (!castable) return null;
    if (row.state === "book") return <span className="cs-spell-where">In the book</span>;
    if (row.state === "unprepared" && keepsList) {
      if (row.spell?.ritualActionId)
        return (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            aria-label={`Cast ${row.name} as a Ritual`}
            onClick={() => castSpellAction(row.spell!.ritualActionId!)}
          >
            Ritual
          </Button>
        );
      return <span className="cs-spell-where">{look === "list" && book ? "In the book" : "Not prepared"}</span>;
    }
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        aria-label={`Cast ${row.name}`}
        onClick={() => startCast(row)}
      >
        Cast
      </Button>
    );
  };
  const circle = (row: SpellRow): ReactNode => {
    if (look !== "list") return null;
    const kind =
      row.state === "prepared" ? "is-prepared" : row.state === "always" || row.state === "cantrip" ? "is-kept" : "";
    if (preparing && row.spell && (row.state === "prepared" || row.state === "unprepared"))
      return (
        <button
          type="button"
          role="switch"
          className={`cs-circle interactive ${kind}`}
          aria-checked={row.state === "prepared"}
          aria-label={`${row.name} prepared`}
          disabled={busy}
          onClick={() => setPrepared(row, row.state !== "prepared")}
        />
      );
    return <span className={`cs-circle ${kind}`} role="img" aria-label={STATE_WORDS[row.state]} />;
  };

  return (
    <div className={`cs-spells is-${look}`}>
      {casterLines.map((text) => (
        <p key={text} className="cs-sub cs-caster">
          {text}
        </p>
      ))}
      {inStep && (role === "gm" || canPrepare) && (
        <section className="cs-card cs-caution" role="group" aria-label="Change prepared spells">
          <strong>Change your prepared spells</strong>
          <p className="cs-sub">
            The Long Rest opened this step.
            {keepsList && cap > 0 ? ` ${counted} of ${cap} are prepared; turn one off to prepare another.` : ""}
            {actor.preparation?.changesLeft != null
              ? ` ${actor.preparation.changesLeft} ${actor.preparation.changesLeft === 1 ? "change is" : "changes are"} left.`
              : ""}
          </p>
          {rechoices
            .filter((choice) => choice.per === "long-rest")
            .map((choice) => (
              <label key={choice.offer} className="cs-field">
                <span className="cs-eyebrow">{choice.label}</span>
                <Select
                  aria-label={choice.label}
                  value={choice.chosen ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    const picked = choice.options.find((option) => option.id === event.target.value);
                    if (!picked) return;
                    void edit("actor:rechoose", { actorId: actor.id, offer: choice.offer, id: picked.id }).then(
                      (result) => {
                        if (result.ok) onFeedback(`${choice.label}: ${picked.name}.`);
                      }
                    );
                  }}
                >
                  {choice.chosen === null && <option value="">None</option>}
                  {choice.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          <div className="cs-chiprow">
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void edit("character:finish-preparing", { actorId: actor.id })}
            >
              Done
            </Button>
            {swappable && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setSwapping(true)}>
                Swap in a spell
              </Button>
            )}
          </div>
        </section>
      )}
      {role === "gm" && !inStep && keepsList && (
        <div className="cs-gm-line">
          <Button
            size="sm"
            className="cs-gm-control"
            aria-pressed={gmEditing}
            onClick={() => setGmEditing((on) => !on)}
          >
            {gmEditing ? "Done changing prepared spells" : "Change prepared spells"}
          </Button>
          {swappable && (
            <Button size="sm" className="cs-gm-control" disabled={busy} onClick={() => setSwapping(true)}>
              Swap in a spell
            </Button>
          )}
          <GmOnlyTag />
        </div>
      )}
      <div className="cs-spells-bar">
        <SegmentedControl
          size="sm"
          ariaLabel="Which spells"
          value={view}
          onChange={(value) => setView(value as typeof view)}
          options={
            look === "book"
              ? [
                  { value: "prepared", label: "Prepared" },
                  { value: "all", label: book ? "Spellbook" : "All" },
                  { value: "rituals", label: "Rituals" }
                ]
              : [
                  { value: "all", label: "All" },
                  { value: "prepared", label: "Prepared" },
                  { value: "rituals", label: "Rituals" }
                ]
          }
        />
        <span className="cs-legend" aria-label="Legend">
          {look === "list" ? (
            <>
              <span className="cs-circle is-prepared" aria-hidden="true" /> Prepared
            </>
          ) : (
            <>
              <span className="cs-tag">C</span> Concentration <span className="cs-tag">R</span> Ritual
            </>
          )}
        </span>
      </div>
      {pact && pact.max > 0 && (view !== "rituals" || shown.length > 0) && (
        <div className="cs-spell-head">
          <span className="cs-eyebrow">Pact Magic · level {pact.level}</span>
          <SlotPips
            label="Pact Magic slots"
            pipLabel="a Pact Magic slot"
            pool={pact}
            busy={busy}
            onSet={(next) =>
              void edit("character:set-slot", { actorId: actor.id, level: pact.level, remaining: next, pact: true })
            }
          />
        </div>
      )}
      {shown.length === 0 && <p className="cs-note">{view === "rituals" ? "No Ritual spells." : "No spells here."}</p>}
      {levels.map((spellLevel) => {
        const pool = slots.find((entry) => entry.level === spellLevel);
        const group = shown
          .filter((row) => row.level === spellLevel)
          .sort((left, right) => left.name.localeCompare(right.name));
        return (
          <section
            key={spellLevel}
            className="cs-spell-group"
            aria-label={spellLevel === 0 ? "Cantrips" : `Level ${spellLevel}`}
          >
            <div className="cs-spell-head">
              <span className="cs-eyebrow">{spellLevel === 0 ? "Cantrips" : `Level ${spellLevel}`}</span>
              {pool && (
                <SlotPips
                  label={`Level ${spellLevel} spell slots`}
                  pipLabel={`a level ${spellLevel} slot`}
                  pool={pool}
                  busy={busy}
                  onSet={(next) =>
                    void edit("character:set-slot", { actorId: actor.id, level: spellLevel, remaining: next })
                  }
                />
              )}
            </div>
            <ul className="cs-spell-list">
              {group.map((row) => (
                <li key={row.id} className={`cs-spell is-${row.state}`}>
                  {circle(row)}
                  <span className="cs-spell-text">
                    <span className="cs-spell-name">
                      {row.content ? (
                        <button
                          type="button"
                          className="cs-link"
                          title={`Show the ${row.name} rules`}
                          onClick={() => setOpenSpell(row.content ?? null)}
                        >
                          {row.name}
                        </button>
                      ) : (
                        <strong>{row.name}</strong>
                      )}
                      {row.concentration && (
                        <span className="cs-tag" title="Concentration">
                          C
                        </span>
                      )}
                      {row.ritual && (
                        <span className="cs-tag" title="Ritual">
                          R
                        </span>
                      )}
                      {row.free && row.free.left !== 0 && (
                        <span className="cs-tag is-free">
                          {row.free.left === null ? "At will" : `${row.free.left} free`}
                        </span>
                      )}
                    </span>
                    {row.line && <span className="cs-spell-line">{row.line}</span>}
                  </span>
                  <span className="cs-spell-act">{rowAction(row)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {book && castable && (
        <section className="cs-group" role="group" aria-label="Spellbook">
          <span className="cs-eyebrow">Spellbook</span>
          <div className="cs-chiprow">
            {book.freeLeft > 0 && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPanel("add")}>
                Add from your levels ({book.freeLeft})
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPanel("copy")}>
              Copy a spell
            </Button>
          </div>
        </section>
      )}
      {bookPanel && (
        <SheetDetail
          place={place}
          title={panel === "add" ? "Add to the spellbook" : "Copy a spell"}
          onClose={() => setPanel(null)}
        >
          {bookPanel}
        </SheetDetail>
      )}
      {castDetail && (
        <SheetDetail place={place} title={`Cast ${castingRow!.name}`} onClose={() => setCasting(null)}>
          {castDetail}
        </SheetDetail>
      )}
      {openSpell && <SpellCard spell={openSpell} onClose={() => setOpenSpell(null)} />}
      {swapping && spellChoices && (
        <SpellSwapModal
          swaps={spellChoices.swaps}
          spellIndex={spellIndex}
          preparedIds={new Set(actor.preparedSpellIds ?? [])}
          busy={busy}
          onSwap={swapIn}
          onClose={() => setSwapping(false)}
        />
      )}
    </div>
  );
}
