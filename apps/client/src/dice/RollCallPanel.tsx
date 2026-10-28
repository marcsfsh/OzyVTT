import { useMemo, useRef, useState } from "react";
import type { AbilityId, GmView, RollCall } from "@vtt/domain";
import { Button, Input, RevealSwitch, SegmentedControl, Select, useToast } from "@vtt/ui";
import { useSkillCatalog } from "../content/catalogs";
import { command } from "../lib/command";
import { useCallLight } from "./callLight";
import { ABILITY_WORDS, callLabel, resultWords } from "./roll-call-words";
import { CallSituations, toggled } from "./CallSituations";
import "./roll-calls.css";

const ABILITY_IDS = Object.keys(ABILITY_WORDS) as AbilityId[];

/**
 * The GM calls for a roll: a check (with a skill) or a saving throw, from one or several characters, with a DC. The
 * players see a prompt and roll; a save call opens a save each character answers like any other. Open calls list who
 * has rolled and what they got, and Close ends one (its unanswered saves are dismissed).
 */
export function RollCallPanel({ state }: Readonly<{ state: GmView }>) {
  const { toast } = useToast();
  const skillCatalog = useSkillCatalog();
  const characters = state.actors.filter((actor) => actor.kind === "player-character" && !actor.archived);
  const [kind, setKind] = useState<RollCall["kind"]>("check");
  const [ability, setAbility] = useState<AbilityId>("wis");
  const [skill, setSkill] = useState("perception");
  const [dc, setDc] = useState("");
  const [blind, setBlind] = useState(false);
  // What the check relies on: a Blinded character fails one that needs sight, a Deafened one one that needs hearing.
  const [sense, setSense] = useState<"" | "sight" | "hearing">("");
  // The creature a check is about (Insight into a sphinx's intentions), whose traits can weigh on it.
  const [about, setAbout] = useState("");
  const others = state.actors.filter((actor) => actor.kind !== "player-character" && !actor.archived);
  // Characters left out of the next call; everyone is in until the GM taps them out.
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const skills = [...skillCatalog.items]
    .filter((entry) => entry.ability === ability)
    .sort((a, b) => a.name.localeCompare(b.name));
  const skillName = (id: string) => skillCatalog.items.find((entry) => entry.id === id)?.name;
  const nameOf = (actorId: string) => state.actors.find((actor) => actor.id === actorId)?.name ?? "A character";
  const chosen = characters.filter((actor) => !left.has(actor.id));

  const pickAbility = (next: AbilityId) => {
    setAbility(next);
    // A skill belongs to one ability, so a new ability starts with a plain check.
    if (!skillCatalog.items.some((entry) => entry.id === skill && entry.ability === next)) setSkill("");
  };
  const toggle = (actorId: string) =>
    setLeft((current) => {
      const next = new Set(current);
      if (next.has(actorId)) next.delete(actorId);
      else next.add(actorId);
      return next;
    });

  const call = async () => {
    const dcValue = dc.trim() === "" ? undefined : Number(dc);
    if (dcValue !== undefined && (!Number.isInteger(dcValue) || dcValue < 1 || dcValue > 40)) {
      toast("The DC is a whole number from 1 to 40.", { tone: "error" });
      return;
    }
    if (kind === "save" && dcValue === undefined) {
      toast("A saving throw needs a DC.", { tone: "error" });
      return;
    }
    if (chosen.length === 0) {
      toast("Pick at least one character.", { tone: "error" });
      return;
    }
    setBusy(true);
    const result = await command("roll-call:start", {
      kind,
      ability,
      ...(kind === "check" && skill ? { skill } : {}),
      ...(kind === "check" && sense ? { sense } : {}),
      ...(kind === "check" && about ? { aboutActorId: about } : {}),
      ...(dcValue !== undefined ? { dc: dcValue } : {}),
      actorIds: chosen.map((actor) => actor.id),
      ...(kind === "check" && blind ? { blind: true } : {})
    });
    setBusy(false);
    if (!result.ok) toast(result.message ?? "The call was refused.", { tone: "error" });
  };

  // The situations the GM turned on for each character's check, by call and character.
  const [situations, setSituations] = useState<Readonly<Record<string, readonly string[]>>>({});
  const pickedFor = (callId: string, actorId: string) => situations[`${callId}:${actorId}`] ?? [];
  /** The GM rolls a character's part of a call: the check, with the situations turned on, or the save it opened. */
  const rollFor = async (call: RollCall, actorId: string, saveId: string | undefined) => {
    setBusy(true);
    const picked = pickedFor(call.id, actorId);
    const result =
      call.kind === "save" && saveId
        ? await command("save:answer", { saveId, method: "roll", commit: true })
        : await command("roll-call:answer", {
            callId: call.id,
            actorId,
            ...(picked.length > 0 ? { situations: [...picked] } : {})
          });
    setBusy(false);
    if (!result.ok) toast(result.message ?? "That roll was refused.", { tone: "error" });
  };
  const close = async (callId: string) => {
    setBusy(true);
    const result = await command("roll-call:close", { callId });
    setBusy(false);
    if (!result.ok) toast(result.message ?? "The call could not be closed.", { tone: "error" });
  };

  const openList = useRef<HTMLUListElement>(null);
  const seen = useMemo(
    () =>
      state.rollCalls.map((open) => ({
        id: open.id,
        total: open.entries.length,
        answers: new Map(
          open.entries.flatMap((entry) =>
            entry.result ? [[entry.actorId, entry.result.success ?? null] as const] : []
          )
        )
      })),
    [state.rollCalls]
  );
  useCallLight(openList, seen);

  return (
    <>
      <section className="roll-call-panel" aria-labelledby="roll-call-heading">
        <h2 id="roll-call-heading" className="roll-call-heading">
          Call for a roll
        </h2>
        <p className="roll-call-hint">
          Ask the players for a check or a saving throw. Each one rolls on their own device.
        </p>
        <div className="roll-call-form">
          <SegmentedControl
            size="sm"
            ariaLabel="Check or saving throw"
            value={kind}
            onChange={(value) => setKind(value as RollCall["kind"])}
            options={[
              { value: "check", label: "Check" },
              { value: "save", label: "Saving throw" }
            ]}
          />
          <div className="roll-call-fields">
            <label>
              Ability
              <Select value={ability} onChange={(event) => pickAbility(event.target.value as AbilityId)}>
                {ABILITY_IDS.map((id) => (
                  <option key={id} value={id}>
                    {ABILITY_WORDS[id]}
                  </option>
                ))}
              </Select>
            </label>
            {kind === "check" && (
              <label>
                Skill
                <Select value={skill} onChange={(event) => setSkill(event.target.value)}>
                  <option value="">None</option>
                  {skills.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {kind === "check" && (
              <label>
                Needs
                <Select value={sense} onChange={(event) => setSense(event.target.value as "" | "sight" | "hearing")}>
                  <option value="">Nothing more</option>
                  <option value="sight">Sight</option>
                  <option value="hearing">Hearing</option>
                </Select>
              </label>
            )}
            {kind === "check" && others.length > 0 && (
              <label>
                About
                <Select value={about} onChange={(event) => setAbout(event.target.value)}>
                  <option value="">None</option>
                  {others.map((actor) => (
                    <option key={actor.id} value={actor.id}>
                      {actor.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <label>
              DC
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                value={dc}
                placeholder={kind === "save" ? "15" : "None"}
                onChange={(event) => setDc(event.target.value.replace(/[^0-9]/g, ""))}
              />
            </label>
          </div>
          {characters.length === 0 ? (
            <p className="roll-call-empty">No characters on the roster yet.</p>
          ) : (
            <div className="roll-call-who" role="group" aria-label="Who rolls">
              {characters.map((actor) => (
                <button
                  key={actor.id}
                  type="button"
                  className="roll-call-who-chip"
                  aria-pressed={!left.has(actor.id)}
                  onClick={() => toggle(actor.id)}
                >
                  {actor.name}
                </button>
              ))}
            </div>
          )}
          {kind === "check" && (
            <div className="roll-call-reveal">
              <RevealSwitch
                revealed={!blind}
                onChange={(shown) => setBlind(!shown)}
                ariaLabel="Players see their results"
              />
              <span>{blind ? "Results hidden from players" : "Results shown to players"}</span>
            </div>
          )}
          <Button variant="primary" disabled={busy || chosen.length === 0} onClick={() => void call()}>
            {kind === "check" ? "Call for the check" : "Call for the save"}
          </Button>
        </div>
      </section>
      {state.rollCalls.length > 0 && (
        <ul ref={openList} className="roll-call-open" aria-label="Open calls">
          {state.rollCalls.map((open) => (
            <li key={open.id} className="roll-call-card" data-call={open.id}>
              <div className="roll-call-card-head">
                <strong>{callLabel(open, skillName)}</strong>
                <span className="roll-call-meta">
                  {open.dc !== null ? `DC ${open.dc}` : "No DC"}
                  {open.blind ? " · Hidden from players" : ""}
                  {open.entries.length > 0 && open.entries.every((entry) => entry.result) ? " · All in" : ""}
                </span>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void close(open.id)}>
                  Close
                </Button>
              </div>
              <ul className="roll-call-entries">
                {open.entries.map((entry) => (
                  <li key={entry.actorId} data-actor={entry.actorId}>
                    <span>{nameOf(entry.actorId)}</span>
                    {entry.result ? (
                      <span
                        className={`roll-call-result${entry.result.success === true ? " is-success" : entry.result.success === false ? " is-failure" : ""}`}
                      >
                        {resultWords(entry.result)}
                      </span>
                    ) : (
                      <>
                        <span className="roll-call-waiting">Waiting</span>
                        <CallSituations
                          situations={entry.situations}
                          picked={pickedFor(open.id, entry.actorId)}
                          busy={busy}
                          onToggle={(situation) =>
                            setSituations((current) => ({
                              ...current,
                              [`${open.id}:${entry.actorId}`]: toggled(pickedFor(open.id, entry.actorId), situation)
                            }))
                          }
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy || (open.kind === "save" && !entry.saveId)}
                          onClick={() => void rollFor(open, entry.actorId, entry.saveId)}
                        >
                          Roll for them
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
