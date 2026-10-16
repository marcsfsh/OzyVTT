import { useEffect, useMemo, useState } from "react";
import type { ContentMonsterSummary } from "@vtt/domain";
import { Modal, Input, Select, Switch } from "@vtt/ui";
import { command } from "../lib/command";
import { formatChallenge, titleCase } from "./format";
import { loadMonsterCatalog } from "./monster-catalog";
import "./monster-browser.css";

/** Challenge-rating bands for the filter: wide enough to browse by, matching the SRD's tiers of play. */
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
  joinEncounter = false
}: Readonly<{
  onClose: () => void;
  onAdded?: (actorId: string) => void;
  /** The staging tray's current "New tokens" state. */
  visibility?: "public" | "gm-only";
  /** True while a fight is running: the new monster joins the roster and the turn order. */
  joinEncounter?: boolean;
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

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      className="monster-browser"
      title="Add monsters"
      ariaLabel="Add monsters from the SRD bestiary"
    >
      <div className="monster-browser-controls">
        <Input
          type="search"
          placeholder="Search by name or type…"
          aria-label="Search monsters"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoFocus
        />
        <div className="monster-browser-filters">
          <Select
            aria-label="Challenge rating"
            value={band}
            onChange={(event) => setBand(event.target.value as typeof band)}
          >
            {CR_BANDS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Monster type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="any">Any type</option>
            {types.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </Select>
          <Select aria-label="Size" value={size} onChange={(event) => setSize(event.target.value)}>
            <option value="any">Any size</option>
            {SIZES.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </Select>
          <Select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            <option value="name">By name</option>
            <option value="cr-up">Lowest CR first</option>
            <option value="cr-down">Highest CR first</option>
          </Select>
        </div>
        <Switch
          label="Roll hit points instead of using the average"
          checked={rollHitPoints}
          onChange={setRollHitPoints}
        />
        <p className="monster-browser-target">
          Adds land in the staging tray · <strong>{visibility === "gm-only" ? "GM only" : "Shown to players"}</strong>
        </p>
      </div>
      {error && (
        <p className="monster-browser-status" role="alert">
          {error}
        </p>
      )}
      {!error && !monsters && <p className="monster-browser-status">Loading the bestiary…</p>}
      {monsters && (
        <ol className="monster-browser-list scroll-y">
          {shown.map((monster) => (
            <li key={monster.id}>
              <div className="monster-browser-name">
                <strong>
                  {monster.name}
                  {addedIds.has(monster.id) && <span className="monster-browser-added">Added</span>}
                </strong>
                <small>
                  CR {formatChallenge(monster.challengeRating)}
                  {monster.experiencePoints !== null && ` (${monster.experiencePoints.toLocaleString()} XP)`} ·{" "}
                  {titleCase(monster.size)} {monster.type} · AC {monster.armorClass} · HP {monster.hitPoints}
                </small>
              </div>
              <button
                type="button"
                className="monster-browser-add"
                disabled={busyIds.has(monster.id)}
                onClick={() => add(monster)}
              >
                {busyIds.has(monster.id) ? "Adding…" : "Add"}
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="monster-browser-none">
              {search.trim() ? `No monsters match "${search}" with these filters.` : "No monsters match these filters."}
            </li>
          )}
        </ol>
      )}
      <p className="monster-browser-feedback" role="status">
        {feedback}
      </p>
      {attribution && <p className="monster-browser-attribution">{attribution}</p>}
    </Modal>
  );
}
