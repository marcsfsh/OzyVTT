import { useState } from "react";
import type { ContentActionSummary } from "@vtt/domain";
import { Button, GmOnlyTag, Stepper, useToast } from "@vtt/ui";
import { afterWords } from "../encounter/action-summary";
import { command } from "../lib/command";

/** One limited-use pool as the server counts it: its key, its name, its largest limit and when it comes back. */
export type Pool = Readonly<{ id: string; name: string; limit: number; per: string; afterHours?: string }>;

/** An action that spends a pool and does something the server applies, by its id and name. */
export type Spender = Readonly<{ id: string; name: string }>;

const titleOf = (slug: string) =>
  slug
    .split("-")
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");

/** The sheet's limited-use pools as the server counts them (`uses.pool ?? action.id`, its largest limit), named as
 *  the server names them: by the action whose id is the pool's, else by the one action that spends it, else by the
 *  pool's own name. One that comes back every turn lives with the turn, so it isn't listed. */
export function poolsOf(actions: readonly ContentActionSummary[]): Pool[] {
  const pools = new Map<string, Pool & { named: boolean }>();
  for (const action of actions) {
    if (action.usesLimit === null || action.usesPer === null || action.usesPer === "turn") continue;
    const id = action.usesPool ?? action.id;
    const known = pools.get(id);
    const named = action.id === id || (known?.named ?? false);
    pools.set(id, {
      id,
      name: action.id === id ? action.name : known ? (known.named ? known.name : titleOf(id)) : action.name,
      limit: Math.max(known?.limit ?? 0, action.usesLimit),
      per: action.usesPer,
      ...(action.usesAfterHours !== undefined ? { afterHours: action.usesAfterHours } : {}),
      named
    });
  }
  return [...pools.values()].map(({ named: _named, ...pool }) => pool);
}

/** When a pool's uses come back, as the sheet says it. */
export const returnsWords = (per: string, afterHours?: string) =>
  per === "long-rest"
    ? "Back on a Long Rest"
    : per === "short-rest"
      ? "Back on a Short Rest"
      : per === "encounter"
        ? "Back when the encounter ends"
        : per === "own-turn"
          ? "Back each round"
          : per === "recharge"
            ? "Recharges"
            : per === "never"
              ? "Doesn't come back"
              : per === "time"
                ? `Back ${afterWords(afterHours)} after its first use`
                : per;

/** Uses left as boxes, the filled ones still to spend; a long pool (Lay on Hands' points) reads as a count. */
export function UseBoxes({ left, limit, label }: Readonly<{ left: number; limit: number; label?: string }>) {
  if (limit > 10)
    return (
      <span className="cs-count" aria-label={label ?? `${left} of ${limit} left`}>
        {left} of {limit}
      </span>
    );
  return (
    <span className="cs-boxes" role="img" aria-label={label ?? `${left} of ${limit} left`}>
      {Array.from({ length: limit }, (_, index) => (
        <i key={index} className={index < left ? "is-on" : undefined} />
      ))}
    </span>
  );
}

/**
 * One pool on the sheet: its name, its boxes and when it comes back, then Use (several at once where it holds more
 * than one, as Lay on Hands' points do) and, for the GM, Give back. The server checks every amount.
 */
export function UseRow({
  actorId,
  role,
  pool,
  spent,
  detail,
  cost,
  actions = true,
  onUse,
  spenders = []
}: Readonly<{
  actorId: string;
  role: "gm" | "player";
  pool: Pool;
  spent: number;
  /** What it costs on a turn ("Bonus Action"), beside its name. */
  cost?: string | null;
  /** What the feature does, in a line. */
  detail?: string | null;
  /** False on the Play tab, which shows what is left without the controls. */
  actions?: boolean;
  /** Uses the pool through one of its actions, which the server applies (Second Wind heals); otherwise Use only counts.
   *  Several spenders get a button each, by name. */
  onUse?: (actionId: string) => void;
  spenders?: readonly Spender[];
}>) {
  const [amount, setAmount] = useState(1);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const left = Math.max(0, pool.limit - spent);
  const through = onUse !== undefined && spenders.length > 0;
  const move = (event: "actor:spend-uses" | "actor:restore-uses") => {
    setBusy(true);
    void command(event, { actorId, poolId: pool.id, amount }).then((result) => {
      setBusy(false);
      if (!result.ok) toast(result.message ?? "That was refused.", { tone: "error" });
      else setAmount(1);
    });
  };
  return (
    <li className="cs-use">
      <span className="cs-use-text">
        <strong className="cs-use-name">
          {pool.name}
          {cost && <span className="cs-use-cost"> · {cost}</span>}
        </strong>
        <span className="cs-sub">
          {returnsWords(pool.per, pool.afterHours)}
          {detail ? ` · ${detail}` : ""}
        </span>
      </span>
      <UseBoxes left={left} limit={pool.limit} label={`${pool.name}: ${left} of ${pool.limit} left`} />
      {actions && (
        <span className="cs-use-actions" role="group" aria-label={`Use or give back ${pool.name}`}>
          {pool.limit > 1 && !through && (
            <Stepper
              value={Math.min(amount, Math.max(1, role === "gm" ? pool.limit : left))}
              onChange={setAmount}
              min={1}
              max={Math.max(1, role === "gm" ? pool.limit : left)}
              disabled={busy}
              aria-label={`How many of ${pool.name}`}
            />
          )}
          {through && spenders.length > 1 ? (
            spenders.map((spender) => (
              <Button
                key={spender.id}
                size="sm"
                disabled={busy || left === 0}
                aria-label={`Use ${pool.name}: ${spender.name}`}
                onClick={() => onUse(spender.id)}
              >
                {spender.name}
              </Button>
            ))
          ) : (
            <Button
              size="sm"
              disabled={busy || left === 0}
              aria-label={`Use ${pool.name}`}
              onClick={() => (through ? onUse(spenders[0]!.id) : move("actor:spend-uses"))}
            >
              Use
            </Button>
          )}
          {role === "gm" && (
            <Button
              size="sm"
              className="cs-gm-control"
              disabled={busy || spent === 0}
              onClick={() => move("actor:restore-uses")}
            >
              Give back
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

/** The pools as a list, with the GM's mark when Give back is offered. */
export function UseList({
  actorId,
  role,
  pools,
  spent,
  details,
  costs,
  actions = true,
  acting,
  onUse
}: Readonly<{
  actorId: string;
  role: "gm" | "player";
  pools: readonly Pool[];
  spent: Readonly<Record<string, number>>;
  details?: ReadonlyMap<string, string>;
  costs?: ReadonlyMap<string, string>;
  actions?: boolean;
  /** The pools used through their own actions, by pool: the actions that spend it. */
  acting?: ReadonlyMap<string, readonly Spender[]>;
  onUse?: (actionId: string) => void;
}>) {
  if (pools.length === 0) return null;
  return (
    <>
      {role === "gm" && actions && (
        <span className="cs-gm-mark">
          Give back <GmOnlyTag />
        </span>
      )}
      <ul className="cs-uses">
        {pools.map((pool) => (
          <UseRow
            key={pool.id}
            actorId={actorId}
            role={role}
            pool={pool}
            spent={spent[pool.id] ?? 0}
            detail={details?.get(pool.id) ?? null}
            cost={costs?.get(pool.id) ?? null}
            actions={actions}
            {...(onUse && acting?.has(pool.id) ? { onUse, spenders: acting.get(pool.id)! } : {})}
          />
        ))}
      </ul>
    </>
  );
}
