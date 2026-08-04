import { useMemo, useState } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { Alert, Button, useToast } from "@vtt/ui";
import { useBuilderCatalogs } from "../content/catalogs";
import { CharacterBuilder } from "./CharacterBuilder";
import { choicesAbove, draftFromLedger, hpRollGap, identityOf, ledgerOf } from "./level-ledger";
import "./character-builder.css";

/**
 * **Level up and level down (`/characters/<id>/level`, D13/D14).**
 *
 * A level rail with the character's current level marked, and below it the wizard — seeded from this
 * character's own ledger — showing the steps the change needs. Both directions, because a preview
 * round-trip is the whole reason level-down exists: "your level-{N} choices and HP roll are kept —
 * leveling back up restores them exactly" is a promise the ledger makes good on, since every decision
 * at or below a level survives a rebuild at that level.
 *
 * Three honest gates, none of them guesses:
 *  - **no ledger** (a PDF import, a pre-wizard sheet): this flow cannot reconstruct what was never
 *    recorded, and says so rather than assembling a plausible character;
 *  - **the cap** (D13): up stops at the table's max party level, down is always allowed to 1;
 *  - **missing HP rolls**: named by level range, average used, said out loud.
 *
 * Authorization is the server's: `character.rebuild` runs `canInitiateForActor` (own claimed character
 * for a player, anyone for the GM) and re-checks the cap and the builder policy inside the
 * transaction. This surface renders the same rules so a player is not walked into a rejection.
 */

type LevelState = GmView | PlayerView;

export function LevelFlow({ state, role, actorId, sessionKey, connection = "online", onClose, onDone }: Readonly<{
  state: LevelState;
  role: "gm" | "player";
  actorId: string;
  sessionKey: string;
  connection?: "online" | "reconnecting" | "offline";
  onClose: () => void;
  onDone: (name: string) => void;
}>) {
  const catalogs = useBuilderCatalogs();
  const { toast } = useToast();
  const [target, setTarget] = useState<number | null>(null);

  const actor = state.actors.find((entry) => entry.id === actorId) ?? null;
  /**
   * The stored sheet. A GM reads it out of the table's definition library; a player only ever has
   * their OWN claimed character's definition, which rides their projection — so a player who reaches
   * this address for anyone else finds nothing here, which is the same answer the server would give.
   */
  const definition: ActorDefinition | null = useMemo(() => {
    if (!actor) return null;
    if ("definition" in actor && actor.definition) return actor.definition as ActorDefinition;
    const library = "definitions" in state ? state.definitions : [];
    return (library.find((entry) => entry.id === actor.definitionId)?.definition as ActorDefinition | undefined) ?? null;
  }, [actor, state]);

  const cap = state.builderPolicy.maxLevel;
  const identity = identityOf(definition);
  const ledger = ledgerOf(definition);
  const current = identity?.level ?? 1;

  if (!actor) return <Gate title="That character isn't here" onClose={onClose}>
    This sheet isn&rsquo;t on the table any more. It may have been archived or deleted.
  </Gate>;

  if (role === "player" && state.builderPolicy.playerBuilder !== "open") return <Gate title="Your GM builds the characters at this table" onClose={onClose}>
    Ask them to level {actor.name} for you.
  </Gate>;

  if (!identity || !ledger || !definition) return <Gate title={`${actor.name} wasn't built here`} onClose={onClose}>
    This sheet wasn&rsquo;t built here, so it can&rsquo;t be releveled step-by-step yet. Edit the sheet directly, or
    rebuild it in the builder.
  </Gate>;

  if (target !== null) {
    const seed = draftFromLedger(identity, ledger, definition, catalogs, target, state.builderPolicy);
    const gap = hpRollGap(ledger, target);
    return <CharacterBuilder
      state={state}
      sessionKey={sessionKey}
      connection={connection}
      onClose={() => setTarget(null)}
      onCreated={(name) => { toast(`${name} is level ${target}.`, { tone: "success" }); onDone(name); }}
      rebuild={{
        actorId,
        name: actor.name,
        seed,
        ...(gap ? {
          notice: <Alert tone="info" title="About this character's hit points">
            Rolled HP wasn&rsquo;t recorded for levels {gap.from}&ndash;{gap.to} — the average is used for those levels.
          </Alert>
        } : {})
      }}
    />;
  }

  const removed = choicesAbove(ledger, current - 1);
  const atCap = current >= cap;

  return <div className="cb-page cb-level">
    <header className="cb-level-head">
      <span className="nh-eyebrow">Level</span>
      <h2>{actor.name}</h2>
      <p>Level {current}{cap < 20 ? ` · the table's cap is ${cap}` : ""}</p>
    </header>

    {/* The rail: every level this table builds to, with the current one marked. Buttons, not a bar —
        at 390px a scrubber for twenty stops is a control nobody can land on. */}
    <ol className="cb-level-rail" aria-label="Levels">
      {Array.from({ length: cap }, (_, index) => index + 1).map((level) => <li
        key={level}
        className={`cb-level-pip${level === current ? " current" : ""}${level < current ? " reached" : ""}`}
        aria-current={level === current ? "step" : undefined}
      >{level}</li>)}
    </ol>

    <div className="cb-level-actions">
      <Button variant="primary" disabled={atCap} onClick={() => setTarget(current + 1)}>Level up to {Math.min(cap, current + 1)}</Button>
      <Button variant="secondary" disabled={current <= 1} onClick={() => setTarget(current - 1)}>Level down to {Math.max(1, current - 1)}</Button>
      <Button variant="ghost" onClick={onClose}>Back to the sheet</Button>
    </div>

    {atCap && <p className="cb-note">At the table&rsquo;s level cap ({cap}).</p>}

    {current > 1 && <section className="cb-level-preview">
      <h3>Leveling down to {current - 1}</h3>
      <p>
        {removed.length > 0
          ? <>Leveling down removes: {removed.map((row) => row.id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")).join(", ")}.</>
          : <>Level {current} added no choices of its own.</>}{" "}
        Your level-{current} choices and HP roll are kept — leveling back up restores them exactly.
      </p>
    </section>}
  </div>;
}

function Gate({ title, children, onClose }: Readonly<{ title: string; children: React.ReactNode; onClose: () => void }>) {
  return <div className="cb-page cb-level">
    <section className="cb-level-gate">
      <h2>{title}</h2>
      <p>{children}</p>
      <Button variant="secondary" onClick={onClose}>Back</Button>
    </section>
  </div>;
}
