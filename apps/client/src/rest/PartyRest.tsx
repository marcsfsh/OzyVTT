import { useState } from "react";
import { gameTimeSpanLabel, isDead, longRestWait, rosterActors, type GmActor, type GmView } from "@vtt/domain";
import { Badge, Button, Modal, Stepper, Switch, useToast } from "@vtt/ui";
import { pathForSection } from "../codex/routes";
import { command } from "../lib/command";
import { navigate } from "../router";
import { NEEDS } from "../sheet/FoodAndWater";
import { gameDate, useGmCalendar } from "./game-date";
import "./rest.css";

const NO_REST = {
  clockHours: 0,
  clockMinutes: 0,
  requests: [] as readonly string[],
  shortRest: null,
  survival: false
};

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
 * Rest stays open while each player spends Hit Dice on their own device, until the GM finishes it. The clock reads
 * the Codex calendar's date with the game's hour, the one clock both share.
 */
export function PartyRest({ state, token }: Readonly<{ state: GmView; token: string | null }>) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hours, setHours] = useState(8);
  const [minuteStep, setMinuteStep] = useState(0);
  const [unpicked, setUnpicked] = useState<ReadonlySet<string>>(new Set());
  const { toast } = useToast();
  // Read defensively: the first state a signing-in GM receives can still be player-shaped.
  const rest = state.rest ?? NO_REST;
  const party = rosterActors(state.actors).filter((actor) => actor.kind === "player-character" && !actor.archived);
  const byId = (actorId: string) => state.actors.find((actor) => actor.id === actorId);
  const requests = rest.requests.map(byId).filter((actor): actor is GmActor => actor !== undefined);
  const shortRest = rest.shortRest;
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
      kind === "long"
        ? "The party finished a Long Rest. 8 hours passed."
        : "The Short Rest is open on each player's device.",
      kind === "long"
    );
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

  const label = shortRest ? "Short Rest open" : "Rest";
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
          shortRest ? (
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void send(() => command("rest:finish", { apply: false }), "The Short Rest was called off.", true)
                }
              >
                Call off
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void send(
                    () => command("rest:finish", { apply: true }),
                    "The Short Rest is over. An hour passed.",
                    true
                  )
                }
              >
                Finish Short Rest
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
                onClick={() => void send(() => command("time:pass", { hours, minutes }), `${span} passed.`)}
              >
                {span ? `Pass ${span}` : "Pass time"}
              </Button>
            </div>
            <p className="party-rest-hint">
              Time that passes here moves the Codex calendar too, and counts down spells and effects: a minute is 10
              rounds. A fight&apos;s rounds don&apos;t move the clock. A Long Rest can start 16 hours after a
              character&apos;s last one ends.
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

          {shortRest ? (
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
                A Long Rest happens at once and passes 8 hours. A Short Rest opens on each player&apos;s device.
              </p>
            </section>
          )}
        </div>
      </Modal>
    </>
  );
}
