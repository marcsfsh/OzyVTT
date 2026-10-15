import { useEffect, useMemo, useState } from "react";
import type { ContentMonsterSummary } from "@vtt/domain";
import { Modal, Input } from "@vtt/ui";
import { command, read } from "../lib/command";
import { formatChallenge, titleCase } from "./format";
import "./monster-browser.css";

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
    void read("content:monsters", {}).then((result) => {
      if (!result.ok || !result.monsters) {
        setError(result.message ?? "The bundled bestiary could not be loaded.");
        return;
      }
      setMonsters(result.monsters);
      setAttribution(result.attribution ?? "");
    });
  }, []);

  const shown = useMemo(() => {
    if (!monsters) return [];
    const query = search.trim().toLowerCase();
    if (!query) return monsters;
    return monsters.filter(
      (monster) => monster.name.toLowerCase().includes(query) || monster.type.toLowerCase().includes(query)
    );
  }, [monsters, search]);

  const add = (monster: ContentMonsterSummary) => {
    setBusyIds((current) => new Set(current).add(monster.id));
    void command("actor:add-from-definition", {
      definitionId: monster.id,
      visibility,
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
                  CR {formatChallenge(monster.challengeRating)} · {titleCase(monster.size)} {monster.type} · AC{" "}
                  {monster.armorClass} · HP {monster.hitPoints}
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
          {shown.length === 0 && <li className="monster-browser-none">No monsters match "{search}".</li>}
        </ol>
      )}
      <p className="monster-browser-feedback" role="status">
        {feedback}
      </p>
      {attribution && <p className="monster-browser-attribution">{attribution}</p>}
    </Modal>
  );
}
