import type { GmView } from "@vtt/domain";
import { Badge, Button } from "@vtt/ui";
import { command } from "../lib/command";

type LongRest = NonNullable<NonNullable<GmView["rest"]>["longRest"]>;

/** "3 h 20 min" of a span in minutes. */
const spanWords = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours > 0 ? `${hours} h` : "", rest > 0 || hours === 0 ? `${rest} min` : ""].filter(Boolean).join(" ");
};

/**
 * The party's Long Rest while it is under way, for the GM: who rests, how long each needs (8 hours, and 1 more for
 * each interruption resumed after), and who an interruption stopped. Rolling Initiative, damage and a spell above a
 * cantrip interrupt a member on the server; the GM interrupts one for an hour of exertion here, and resumes one.
 */
export function LongRestUnderWay({
  state,
  rest,
  busy,
  send
}: Readonly<{
  state: GmView;
  rest: LongRest;
  busy: boolean;
  send: (run: () => Promise<Readonly<{ ok: boolean; message?: string }>>, success: string) => Promise<boolean>;
}>) {
  const clock = (state.rest?.clockHours ?? 0) * 60 + (state.rest?.clockMinutes ?? 0);
  const rested = Math.max(0, clock - rest.startedAt);
  return (
    <section className="party-rest-section" aria-label="Long Rest under way">
      <span className="party-rest-heading">Long Rest under way · {spanWords(rested)} so far</span>
      <ul className="party-rest-list">
        {rest.members.map((member) => {
          const actor = state.actors.find((candidate) => candidate.id === member.actorId);
          if (!actor) return null;
          const needs = 8 + member.interruptions;
          return (
            <li key={member.actorId} className="party-rest-request">
              <span className="party-rest-name">{actor.name}</span>
              <span className="party-rest-note">
                {member.interrupted
                  ? member.shortRestEarned
                    ? "Interrupted · has a Short Rest's benefits"
                    : "Interrupted"
                  : `Needs ${needs} h`}
              </span>
              <Badge tone={member.interrupted ? "caution" : "success"}>
                {member.interrupted ? "Stopped" : "Resting"}
              </Badge>
              <span className="party-rest-actions">
                {member.interrupted ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void send(() => command("rest:resume", { actorId: actor.id }), `${actor.name} rests again.`)
                    }
                  >
                    Resume
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void send(
                        () => command("rest:interrupt", { actorId: actor.id }),
                        `${actor.name}'s Long Rest is interrupted.`
                      )
                    }
                  >
                    Interrupt
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="party-rest-hint">
        Rolling Initiative, taking damage or casting a spell above a cantrip interrupts a member. Interrupt one for an
        hour of walking or other exertion. A member that rested an hour first gets a Short Rest&apos;s benefits.
        Finishing passes the rest of the time.
      </p>
    </section>
  );
}
