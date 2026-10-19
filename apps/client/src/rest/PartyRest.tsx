import { useState } from "react";
import { gameTimeSpanLabel, isDead, longRestWait, rosterActors, type GmActor, type GmView } from "@vtt/domain";
import { Badge, Button, Field, Modal, SegmentedControl, Select, Stepper, Switch, useToast } from "@vtt/ui";
import { pathForSection } from "../codex/routes";
import { CraftingProjects } from "../crafting/CraftingProjects";
import { command } from "../lib/command";
import { navigate } from "../router";
import { NEEDS } from "../sheet/FoodAndWater";
import { gameDate, useGmCalendar } from "./game-date";
import { LongRestUnderWay } from "./LongRestUnderWay";
import "./rest.css";

const NO_REST = {
  clockHours: 0,
  clockMinutes: 0,
  requests: [] as readonly string[],
  dawnHour: null as number | null,
  shortRest: null,
  longRest: null,
  survival: false
};

/** "06:00" for an hour of the day. */
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** "Food 1/1 lb · Water 4/8 pints · 2 days unfed": what a character ate and drank today, against its need. */
function nourishmentNote(actor: GmActor): string {
  const today = actor.nourishment;
  if (!today) return "Not tracked yet";
  const need = NEEDS[actor.size ?? "medium"];
  const unfed = today.daysUnfed > 0 ? ` · ${today.daysUnfed} ${today.daysUnfed === 1 ? "day" : "days"} unfed` : "";
  return `Food ${today.foodPounds}/${need.food} lb · Water ${today.waterPints}/${need.water} pints${unfed}`;
}

/** The minutes the GM can add to the hours passed, from a single minute (10 rounds) up to most of an hour. */
const MINUTE_STEPS = [0, 1, 5, 10, 15, 20, 30, 45] as const;

/** Why a character can't rest at all now (no Short Rest either); null when nothing stands in the way. */
function blockedNote(state: GmView, actor: GmActor): string | null {
  if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actor.id)) return "In the fight";
  if (isDead(actor)) return "Dead";
  if (actor.hp.current < 1) return "Needs 1 HP to rest";
  return null;
}

/** Why a character can't rest now, as a short note on its row; null when nothing stands in the way. The server
 *  decides: the note only says what it will say. */
function restNote(state: GmView, actor: GmActor): string | null {
  const blocked = blockedNote(state, actor);
  if (blocked) return blocked;
  const wait = longRestWait(actor.lastLongRestAt ?? null, state.rest?.clockHours ?? 0);
  return wait > 0 ? `Long Rest in ${wait} h` : null;
}

/**
 * The GM's rests: game time and passing it, players' Long Rest requests, and resting the party together. A Short
 * Rest stays open while each player spends Hit Dice on their own device, and a Long Rest while its 8 hours can be
 * interrupted, until the GM finishes it. Downtime passed here works the party's crafting projects. The clock reads
 * the Codex calendar's date with the game's hour, the one clock both share.
 */
export function PartyRest({ state, token }: Readonly<{ state: GmView; token: string | null }>) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hours, setHours] = useState(8);
  // Passing time on the road (SRD Travel Pace): the server logs how far the party went.
  const [pace, setPace] = useState<"stay" | "slow" | "normal" | "fast">("stay");
  // Downtime (SRD 5.2.1 Crafting): crafters work their projects through the time passed.
  const [downtime, setDowntime] = useState(false);
  const [minuteStep, setMinuteStep] = useState(0);
  const [unpicked, setUnpicked] = useState<ReadonlySet<string>>(new Set());
  const { toast } = useToast();
  // Read defensively: the first state a signing-in GM receives can still be player-shaped.
  const rest = state.rest ?? NO_REST;
  const party = rosterActors(state.actors).filter((actor) => actor.kind === "player-character" && !actor.archived);
  const byId = (actorId: string) => state.actors.find((actor) => actor.id === actorId);
  const requests = rest.requests.map(byId).filter((actor): actor is GmActor => actor !== undefined);
  const shortRest = rest.shortRest;
  const longRest = rest.longRest ?? null;
  const projects = state.crafting?.projects ?? [];
  const picked = party.filter((actor) => !unpicked.has(actor.id));
  const calendar = useGmCalendar(token, open);
  const clock = gameDate(calendar.data, rest.clockHours, rest.clockMinutes);
  const minutes = MINUTE_STEPS[minuteStep] ?? 0;
  const span = hours * 60 + minutes > 0 ? gameTimeSpanLabel(hours * 60 + minutes) : null;

  /** Opens with everyone who can rest ticked; a character who can't (down, dead, in the fight) starts unticked. */
  const openDialog = () => {
    setUnpicked(new Set(party.filter((actor) => blockedNote(state, actor) !== null).map((actor) => actor.id)));
    setOpen(true);
  };
  /** Sends a command, says how it went, and closes the dialog when its work is done. */
  const send = async (
    run: () => Promise<Readonly<{ ok: boolean; message?: string }>>,
    success: string,
    closeAfter = false
  ) => {
    setBusy(true);
    const result = await run();
    setBusy(false);
    toast(result.ok ? success : (result.message ?? "That was refused."), { tone: result.ok ? "success" : "error" });
    if (result.ok && closeAfter) setOpen(false);
    return result.ok;
  };
  const toggle = (actorId: string) =>
    setUnpicked((current) => {
      const next = new Set(current);
      if (next.has(actorId)) next.delete(actorId);
      else next.add(actorId);
      return next;
    });
  const startRest = (kind: "short" | "long") =>
    send(
      () => command("rest:party", { kind, actorIds: picked.map((actor) => actor.id) }),
      kind === "long" ? "The Long Rest is under way." : "The Short Rest is open on each player's device."
    );
  const finishRest = (kind: "short" | "long", apply: boolean) =>
    send(
      () => command("rest:finish", { apply, kind }),
      !apply
        ? `The ${kind === "long" ? "Long" : "Short"} Rest was called off.`
        : kind === "long"
          ? "The Long Rest is over."
          : "The Short Rest is over. An hour passed.",
      true
    );
  const openRest = shortRest ? "short" : longRest ? "long" : null;
  const unclaimed = shortRest?.actorIds.some((actorId) => !byId(actorId)?.ownerSessionId) ?? false;
  /** A meal for everyone, or everyone's fill at a source: one command per living character. */
  const feedAll = async (choice: Readonly<{ food?: "meal"; water?: "fill" }>, success: string) => {
    setBusy(true);
    let failure: string | null = null;
    for (const actor of party.filter((member) => !isDead(member))) {
      const result = await command("actor:nourish", { actorId: actor.id, ...choice });
      if (!result.ok) failure ??= result.message ?? "That was refused.";
    }
    setBusy(false);
    toast(failure ?? success, { tone: failure ? "error" : "success" });
  };

  const label = shortRest ? "Short Rest open" : longRest ? "Long Rest open" : "Rest";
  return (
    <>
      <Button className="party-rest-open" onClick={openDialog} aria-haspopup="dialog">
        {label}
        {requests.length > 0 && (
          <Badge tone="info" solid>
            {requests.length} asked
          </Badge>
        )}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Rest"
        size="md"
        footer={
          openRest ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => void finishRest(openRest, false)}>
                Call off
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void finishRest(openRest, true)}>
                {openRest === "long" ? "Finish Long Rest" : "Finish Short Rest"}
              </Button>
            </>
          ) : (
            <>
              <Button disabled={busy || picked.length === 0} onClick={() => void startRest("short")}>
                Short Rest
              </Button>
              <Button disabled={busy || picked.length === 0} onClick={() => void startRest("long")}>
                Long Rest
              </Button>
            </>
          )
        }
      >
        <div className="party-rest">
          <section className="party-rest-section" aria-label="Game time">
            <span className="party-rest-heading">Game time</span>
            <p className="party-rest-clock">{clock.date ? `${clock.date} · ${clock.hour}` : clock.hour}</p>
            {!clock.date && !calendar.loading && (
              <p className="party-rest-hint">
                The date comes from the Codex calendar, which has no date yet.{" "}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    navigate(pathForSection("story"));
                  }}
                >
                  Set the date
                </Button>
              </p>
            )}
            <div className="party-rest-row">
              <SegmentedControl
                size="sm"
                ariaLabel="Travel pace"
                options={[
                  { value: "stay", label: "Stay", title: "The party stays where it is" },
                  { value: "slow", label: "Slow", title: "2 miles an hour, Advantage on Perception and Survival" },
                  { value: "normal", label: "Normal", title: "3 miles an hour, Disadvantage on Stealth" },
                  {
                    value: "fast",
                    label: "Fast",
                    title: "4 miles an hour, Disadvantage on Perception, Survival and Stealth"
                  }
                ]}
                value={pace}
                onChange={(value) => setPace(value as typeof pace)}
              />
            </div>
            <div className="party-rest-row">
              <Stepper
                value={hours}
                onChange={setHours}
                min={0}
                max={72}
                format={(value) => `${value} h`}
                disabled={busy}
                aria-label="Hours to pass"
              />
              <Stepper
                value={minuteStep}
                onChange={setMinuteStep}
                min={0}
                max={MINUTE_STEPS.length - 1}
                format={(value) => `${MINUTE_STEPS[value] ?? 0} min`}
                disabled={busy}
                aria-label="Minutes to pass"
              />
              <Button
                disabled={busy || span === null}
                onClick={() =>
                  void send(
                    () =>
                      command("time:pass", {
                        hours,
                        minutes,
                        ...(pace !== "stay" ? { pace } : {}),
                        ...(downtime && pace === "stay" ? { downtime: true } : {})
                      }),
                    `${span} passed.`
                  )
                }
              >
                {span ? `${pace === "stay" ? "Pass" : "Travel"} ${span}` : "Pass time"}
              </Button>
            </div>
            {pace === "stay" && (
              <Switch
                checked={downtime}
                disabled={busy}
                label="Downtime: crafters work on their projects"
                onChange={setDowntime}
              />
            )}
            <p className="party-rest-hint">
              Time that passes here moves the Codex calendar too, and counts down spells and effects: a minute is 10
              rounds. A fight&apos;s rounds don&apos;t move the clock. A Long Rest can start 16 hours after a
              character&apos;s last one ends. While the party travels, each character&apos;s checks read the pace until
              time passes without one.
            </p>
            <Field label="Dawn" htmlFor="party-rest-dawn">
              <Select
                id="party-rest-dawn"
                value={rest.dawnHour === null || rest.dawnHour === undefined ? "" : String(rest.dawnHour)}
                disabled={busy}
                onChange={(event) => {
                  const hour = event.target.value === "" ? null : Number(event.target.value);
                  void send(
                    () => command("time:set-dawn", { hour }),
                    hour === null
                      ? "Items regain their dawn charges at a Long Rest."
                      : `Dawn comes at ${hourLabel(hour)}.`
                  );
                }}
              >
                <option value="">At each Long Rest</option>
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="party-rest-hint">
              What a magic item regains at dawn comes back when the clock passes this hour. Left at each Long Rest, a
              Long Rest gives it back.
            </p>
          </section>

          <section className="party-rest-section" aria-label="Food and water">
            <span className="party-rest-heading">Food and water</span>
            <Switch
              checked={rest.survival}
              disabled={busy}
              label="Track food and water by the day"
              onChange={(enabled) =>
                void send(
                  () => command("survival:set-tracking", { enabled }),
                  enabled ? "Food and water are tracked now." : "Food and water are no longer tracked."
                )
              }
            />
            {rest.survival && party.length > 0 && (
              <>
                <ul className="party-rest-list">
                  {party.map((actor) => (
                    <li key={actor.id} className="party-rest-member is-static">
                      <span className="party-rest-name">{actor.name}</span>
                      <span className="party-rest-note">{nourishmentNote(actor)}</span>
                    </li>
                  ))}
                </ul>
                <div className="party-rest-row">
                  <Button disabled={busy} onClick={() => void feedAll({ food: "meal" }, "Everyone ate a meal.")}>
                    Everyone eats a meal
                  </Button>
                  <Button disabled={busy} onClick={() => void feedAll({ water: "fill" }, "Everyone drank their fill.")}>
                    Everyone drinks their fill
                  </Button>
                </div>
              </>
            )}
            <p className="party-rest-hint">
              At each midnight a character eats the Rations and drinks from the Waterskins it carries. Less than half a
              day&apos;s water, or less than half its food, can cost a level of Exhaustion that stays until it eats and
              drinks its fill.
            </p>
          </section>

          {requests.length > 0 && (
            <section className="party-rest-section" aria-label="Long Rest requests">
              <span className="party-rest-heading">Asked for a Long Rest</span>
              <ul className="party-rest-list">
                {requests.map((actor) => (
                  <li key={actor.id} className="party-rest-request">
                    <span className="party-rest-name">{actor.name}</span>
                    <span className="party-rest-note">{restNote(state, actor)}</span>
                    <span className="party-rest-actions">
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void send(
                            () => command("rest:answer", { actorId: actor.id, approve: true }),
                            `${actor.name} finished a Long Rest.`
                          )
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void send(
                            () => command("rest:answer", { actorId: actor.id, approve: false }),
                            `Turned down ${actor.name}'s Long Rest.`
                          )
                        }
                      >
                        Turn down
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {longRest ? (
            <LongRestUnderWay state={state} rest={longRest} busy={busy} send={send} />
          ) : shortRest ? (
            <section className="party-rest-section" aria-label="Short Rest under way">
              <span className="party-rest-heading">Short Rest under way</span>
              <ul className="party-rest-list">
                {shortRest.actorIds.map((actorId) => {
                  const actor = byId(actorId);
                  if (!actor) return null;
                  const done = shortRest.done.includes(actorId);
                  // Only a claimed character has a player choosing Hit Dice.
                  const status = done ? "Done" : actor.ownerSessionId ? "Choosing" : "No player";
                  return (
                    <li key={actorId} className="party-rest-member is-static">
                      <span className="party-rest-name">{actor.name}</span>
                      <span className="party-rest-note">
                        {actor.hp.current}/{actor.hp.maximum} HP
                        {actor.hitDice && ` · Hit Dice ${actor.hitDice.remaining}/${actor.hitDice.maximum}`}
                      </span>
                      <Badge tone={done ? "success" : "neutral"}>{status}</Badge>
                    </li>
                  );
                })}
              </ul>
              <p className="party-rest-hint">
                Each player spends Hit Dice on their own device. Finishing passes an hour.
                {unclaimed ? " A character with no player gets the rest when you finish it." : ""}
              </p>
            </section>
          ) : (
            <section className="party-rest-section" aria-label="Rest the party">
              <span className="party-rest-heading">Rest the party</span>
              {party.length === 0 ? (
                <p className="party-rest-hint">No characters yet.</p>
              ) : (
                <ul className="party-rest-list">
                  {party.map((actor) => {
                    const note = restNote(state, actor);
                    return (
                      <li key={actor.id}>
                        <label className="party-rest-member">
                          <input
                            type="checkbox"
                            checked={!unpicked.has(actor.id)}
                            disabled={busy}
                            onChange={() => toggle(actor.id)}
                          />
                          <span className="party-rest-name">{actor.name}</span>
                          <span className="party-rest-note">
                            {actor.hp.current}/{actor.hp.maximum} HP{note ? ` · ${note}` : ""}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="party-rest-hint">
                A Short Rest opens on each player&apos;s device. A Long Rest stays open for its 8 hours, so a fight or
                damage can interrupt it, until you finish it.
              </p>
            </section>
          )}

          {(projects.length > 0 || downtime) && <CraftingProjects state={state} busy={busy} send={send} />}
        </div>
      </Modal>
    </>
  );
}
