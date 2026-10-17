import { useState } from "react";
import type { ContentActionSummary } from "@vtt/domain";
import { Button, Stepper, useToast } from "@vtt/ui";
import { command } from "../lib/command";

type Pool = Readonly<{ id: string; name: string; limit: number; per: string }>;

const PER_LABELS: Readonly<Record<string, string>> = {
  "long-rest": "Long Rest",
  "short-rest": "Short Rest",
  encounter: "fight",
  recharge: "recharge"
};

const titleOf = (slug: string) =>
  slug
    .split("-")
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");

/** The sheet's limited-use pools as the server counts them (`uses.pool ?? action.id`, its largest limit), named as
 *  the server names them (`actionPools`): by the action whose id is the pool's, else by the one action that spends
 *  it, else by the pool's own name. One that comes back every turn lives with the turn, so it isn't listed. */
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
      named
    });
  }
  return [...pools.values()].map(({ named: _named, ...pool }) => pool);
}

/**
 * Limited uses on this character: what is left of each pool, and spending several at once (its player or the GM: Lay on
 * Hands' points outside a fight, Focus Points for something the engine doesn't run), and the GM giving uses back.
 * The server checks every amount.
 */
export function SheetPools({
  actorId,
  role,
  actions,
  spent
}: Readonly<{
  actorId: string;
  role: "gm" | "player";
  actions: readonly ContentActionSummary[];
  /** Spent counts by pool, from the live actor. */
  spent: Readonly<Record<string, number>>;
}>) {
  const pools = poolsOf(actions);
  if (pools.length === 0) return null;
  return (
    <div className="sheet-pools-block">
      <span className="sheet-section-label">Limited uses</span>
      <ul className="sheet-pools">
        {pools.map((pool) => (
          <PoolRow key={pool.id} actorId={actorId} role={role} pool={pool} spent={spent[pool.id] ?? 0} />
        ))}
      </ul>
    </div>
  );
}

function PoolRow({
  actorId,
  role,
  pool,
  spent
}: Readonly<{ actorId: string; role: "gm" | "player"; pool: Pool; spent: number }>) {
  const [amount, setAmount] = useState(1);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const left = Math.max(0, pool.limit - spent);
  const move = (event: "actor:spend-uses" | "actor:restore-uses") => {
    setBusy(true);
    void command(event, { actorId, poolId: pool.id, amount }).then((result) => {
      setBusy(false);
      if (!result.ok) toast(result.message ?? "That was refused.", { tone: "error" });
      else setAmount(1);
    });
  };
  return (
    <li className="sheet-pool">
      <span className="sheet-pool-name">{pool.name}</span>
      <span className="sheet-pool-count">
        {left}/{pool.limit} · {PER_LABELS[pool.per] ?? pool.per}
      </span>
      <span className="sheet-pool-actions" role="group" aria-label={`Spend or give back ${pool.name}`}>
        <Stepper
          value={amount}
          onChange={setAmount}
          min={1}
          max={Math.max(1, role === "gm" ? pool.limit : left)}
          disabled={busy}
          aria-label={`How many of ${pool.name}`}
        />
        <Button size="sm" disabled={busy || left === 0} onClick={() => move("actor:spend-uses")}>
          Spend
        </Button>
        {role === "gm" && (
          <Button size="sm" variant="ghost" disabled={busy || spent === 0} onClick={() => move("actor:restore-uses")}>
            Give back
          </Button>
        )}
      </span>
    </li>
  );
}
