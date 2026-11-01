import { useEffect, useMemo, useState } from "react";
import type { ContentMonsterSummary } from "@vtt/domain";
import { Button, Modal, Input, Select, Switch, cx } from "@vtt/ui";
import { HomebrewMarks, useHomebrewMarks } from "../homebrew/marks";
import { command, read } from "../lib/command";
import { formatChallenge, titleCase } from "./format";
import { loadMonsterCatalog } from "./monster-catalog";
import { StatBlock, type StatBlockRecord } from "./StatBlock";
import "./monster-browser.css";

/** A monster's stat block, read when the GM opens it. */
function BestiaryStatBlock({ monster }: Readonly<{ monster: ContentMonsterSummary }>) {
  const [definition, setDefinition] = useState<StatBlockRecord | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void read("content:monster-sheet", { definitionId: monster.id }).then((result) => {
      if (!live) return;
      if (result.ok && result.definition) setDefinition(result.definition as unknown as StatBlockRecord);
      else setFailed(result.message ?? "The stat block could not be loaded.");
    });
    return () => {
      live = false;
    };
  }, [monster.id]);
  if (failed) return <p className="monster-browser-status">{failed}</p>;
  if (!definition) return <p className="monster-browser-status">Loading the stat block.</p>;
  return <StatBlock monster={definition} className="monster-browser-statblock" />;
}

/** Challenge-rating bands for the filter: wide enough to browse by, and close to the SRD's tiers of play. */
const CR_BANDS = [
  { id: "any", label: "Any CR", min: 0, max: 30 },
  { id: "0-1", label: "CR 0 to 1", min: 0, max: 1 },
  { id: "2-4", label: "CR 2 to 4", min: 2, max: 4 },
  { id: "5-10", label: "CR 5 to 10", min: 5, max: 10 },
  { id: "11-16", label: "CR 11 to 16", min: 11, max: 16 },
  { id: "17-30", label: "CR 17 and up", min: 17, max: 30 }
] as const;
const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
type Sort = "name" | "cr-up" | "cr-down";

/**
 * The bestiary browser. It adds monsters; visibility comes from the staging tray (`visibility`),
 * so every add path obeys one control. With `joinEncounter`, the roster add and joining the fight
 * are one command.
 */
export function MonsterBrowser({
  onClose,
  onAdded,
  visibility = "public",
  joinEncounter = false,
  targetName
}: Readonly<{
  onClose: () => void;
  onAdded?: (actorId: string) => void;
  /** The staging tray's current "New tokens" state. */
  visibility?: "public" | "gm-only";
  /** True while a fight is running: the new monster joins the roster and the turn order. */
  joinEncounter?: boolean;
  /** The encounter the monsters go to, for the dialog's Add to {name}. */
  targetName?: string;
}>) {
  const [monsters, setMonsters] = useState<readonly ContentMonsterSummary[] | null>(null);
  const [attribution, setAttribution] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [band, setBand] = useState<(typeof CR_BANDS)[number]["id"]>("any");
  const [type, setType] = useState("any");
  const [size, setSize] = useState("any");
  const [sort, setSort] = useState<Sort>("name");
  const [rollHitPoints, setRollHitPoints] = useState(false);
  const [feedback, setFeedback] = useState("");
  /**
   * In-flight rows, as a set so several adds can run at once. Safe: each `actor:add-from-definition`
   * creates a new actor with its own `commandId`.
   */
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * Rows added during this dialog session, so a GM does not add the same monster again before
   * noticing the first worked. Resets when the dialog unmounts. Not named `setMessage`/`setFeedback`,
   * which the one-feedback-channel check reserves.
   */
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [readingId, setReadingId] = useState<string | null>(null);
  // The bestiary is the GM's, so a Hidden homebrew monster is marked from the GM's own homebrew list.
  const marks = useHomebrewMarks(true);

  useEffect(() => {
    void loadMonsterCatalog().then(
      (catalog) => {
        setMonsters(catalog.monsters);
        setAttribution(catalog.attribution);
      },
      (failure: Error) => setError(failure.message)
    );
  }, []);

  const types = useMemo(() => [...new Set((monsters ?? []).map((monster) => monster.type))].sort(), [monsters]);
  const shown = useMemo(() => {
    if (!monsters) return [];
    const query = search.trim().toLowerCase();
    const { min, max } = CR_BANDS.find((candidate) => candidate.id === band)!;
    const matching = monsters.filter(
      (monster) =>
        (!query || monster.name.toLowerCase().includes(query) || monster.type.toLowerCase().includes(query)) &&
        monster.challengeRating >= min &&
        monster.challengeRating <= max &&
        (type === "any" || monster.type === type) &&
        (size === "any" || monster.size === size)
    );
    if (sort === "name") return matching;
    const direction = sort === "cr-up" ? 1 : -1;
    return [...matching].sort(
      (left, right) => direction * (left.challengeRating - right.challengeRating) || left.name.localeCompare(right.name)
    );
  }, [monsters, search, band, type, size, sort]);

  const add = (monster: ContentMonsterSummary) => {
    setBusyIds((current) => new Set(current).add(monster.id));
    void command("actor:add-from-definition", {
      definitionId: monster.id,
      visibility,
      ...(rollHitPoints ? { hitPoints: "roll" as const } : {}),
      ...(joinEncounter ? { joinEncounter: true } : {})
    }).then((result) => {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(monster.id);
        return next;
      });
      if (result.ok && result.actorId) {
        setAddedIds((current) => new Set(current).add(monster.id));
        onAdded?.(result.actorId);
      }
      setFeedback(
        result.ok
          ? `${monster.name} is in the staging tray${visibility === "gm-only" ? ", GM only" : ""}.`
          : (result.message ?? "The monster could not be added.")
      );
    });
  };

  // Counts for each filter's options, with the other filters applied (G's filter panel).
  const query = search.trim().toLowerCase();
  const passes = (monster: ContentMonsterSummary, except: "band" | "type" | "size") => {
    const { min, max } = CR_BANDS.find((candidate) => candidate.id === band)!;
    return (
      (!query || monster.name.toLowerCase().includes(query) || monster.type.toLowerCase().includes(query)) &&
      (except === "band" || (monster.challengeRating >= min && monster.challengeRating <= max)) &&
      (except === "type" || type === "any" || monster.type === type) &&
      (except === "size" || size === "any" || monster.size === size)
    );
  };
  const countOf = (except: "band" | "type" | "size", test: (monster: ContentMonsterSummary) => boolean) =>
    (monsters ?? []).filter((monster) => passes(monster, except) && test(monster)).length;
  const chosen = shown.find((monster) => monster.id === readingId) ?? null;
  const filterGroup = (
    title: string,
    options: readonly Readonly<{ id: string; label: string; count: number }>[],
    value: string,
    onPick: (id: string) => void
  ) => (
    <div className="monster-browser-facet" role="group" aria-label={title}>
      <span className="monster-browser-facet-title">{title}</span>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={cx("monster-browser-option interactive", value === option.id && "is-on")}
          aria-pressed={value === option.id}
          onClick={() => onPick(option.id)}
        >
          <span>{option.label}</span>
          <span className="monster-browser-count">{option.count}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="full"
      className="monster-browser"
      title="Add monsters"
      ariaLabel="Add monsters from the bestiary"
      footer={
        <div className="monster-browser-foot">
          <Switch label="Roll hit points (off uses the average)" checked={rollHitPoints} onChange={setRollHitPoints} />
          <p className="monster-browser-target">
            Adds land in the staging tray · <strong>{visibility === "gm-only" ? "GM only" : "Shown to players"}</strong>
          </p>
          <p className="monster-browser-feedback" role="status">
            {feedback}
          </p>
          {chosen && (
            <Button variant="primary" disabled={busyIds.has(chosen.id)} onClick={() => add(chosen)}>
              {targetName ? `Add to ${targetName}` : `Add ${chosen.name}`}
            </Button>
          )}
        </div>
      }
    >
      {/* The Compendium's browse (C3 running spec 2.4): the search and sort at the head, the filters with their
          counts, the rows, and the chosen monster's stat block. */}
      <div className="monster-browser-head">
        <Input
          type="search"
          placeholder="Search by name or type…"
          aria-label="Search monsters"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoFocus
        />
        <Select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="name">By name</option>
          <option value="cr-up">Lowest CR first</option>
          <option value="cr-down">Highest CR first</option>
        </Select>
      </div>
      {error && (
        <p className="monster-browser-status" role="alert">
          {error}
        </p>
      )}
      {!error && !monsters && <p className="monster-browser-status">Loading the bestiary…</p>}
      {monsters && (
        <div className="monster-browser-panes">
          <div className="monster-browser-filters scroll-y" aria-label="Filters" role="region">
            {filterGroup(
              "CR",
              CR_BANDS.map((option) => ({
                id: option.id,
                label: option.label,
                count: countOf(
                  "band",
                  (monster) => monster.challengeRating >= option.min && monster.challengeRating <= option.max
                )
              })),
              band,
              (id) => setBand(id as typeof band)
            )}
            {filterGroup(
              "Type",
              [
                { id: "any", label: "Any type", count: countOf("type", () => true) },
                ...types.map((option) => ({
                  id: option,
                  label: titleCase(option),
                  count: countOf("type", (monster) => monster.type === option)
                }))
              ],
              type,
              setType
            )}
            {filterGroup(
              "Size",
              [
                { id: "any", label: "Any size", count: countOf("size", () => true) },
                ...SIZES.map((option) => ({
                  id: option,
                  label: titleCase(option),
                  count: countOf("size", (monster) => monster.size === option)
                }))
              ],
              size,
              setSize
            )}
          </div>
          <ol className="monster-browser-list scroll-y">
            {shown.map((monster) => (
              <li key={monster.id} className={cx(readingId === monster.id && "is-reading")}>
                <button
                  type="button"
                  className="monster-browser-name interactive"
                  aria-pressed={readingId === monster.id}
                  onClick={() => setReadingId((open) => (open === monster.id ? null : monster.id))}
                >
                  <strong>
                    {monster.name}
                    <HomebrewMarks source={monster.source} mark={marks.get(monster.id)} />
                    {addedIds.has(monster.id) && <span className="monster-browser-added">Added</span>}
                  </strong>
                  <small>
                    <span className="monster-browser-cr">CR {formatChallenge(monster.challengeRating)}</span>
                    {monster.experiencePoints !== null && ` (${monster.experiencePoints.toLocaleString()} XP)`} ·{" "}
                    {titleCase(monster.size)} {monster.type} · AC {monster.armorClass} · HP {monster.hitPoints}
                  </small>
                </button>
                <Button
                  size="sm"
                  className="monster-browser-add"
                  disabled={busyIds.has(monster.id)}
                  onClick={() => add(monster)}
                >
                  {busyIds.has(monster.id) ? "Adding…" : "Add"}
                </Button>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="monster-browser-none">
                {search.trim()
                  ? `No monsters match "${search}" with these filters.`
                  : "No monsters match these filters."}
              </li>
            )}
          </ol>
          <div className="monster-browser-detail scroll-y" aria-label="The chosen monster" role="region">
            {chosen ? (
              <BestiaryStatBlock monster={chosen} />
            ) : (
              <p className="monster-browser-status">Choose a monster to read its stat block.</p>
            )}
          </div>
        </div>
      )}
      {attribution && <p className="monster-browser-attribution">{attribution}</p>}
    </Modal>
  );
}
