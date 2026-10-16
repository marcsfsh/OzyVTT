import { useMemo, useState } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { Alert, Button, useToast } from "@vtt/ui";
import { useBuilderCatalogs } from "../content/catalogs";
import { CharacterBuilder } from "./CharacterBuilder";
import { choicesAbove, draftFromLedger, hpRollGap, identityOf, ledgerOf, recordedAbilities } from "./level-ledger";
import { useBuilderOffers } from "./useBuilderOffers";
import "./character-builder.css";

/**
 * Level up and level down (`/characters/<id>/level`): a level rail, then the wizard seeded from this
 * character's own ledger. Every decision at or below a level survives a rebuild at that level, so
 * levelling back up restores earlier choices and HP rolls exactly.
 *
 * Gates: no ledger (a PDF import or pre-wizard sheet) cannot be rebuilt; up stops at the table's max
 * level, down always reaches 1; missing HP rolls use the average and say so. The table reads the ledger
 * back onto the offers at the chosen level before the wizard opens.
 * The server authorizes `character.rebuild` (`canInitiateForActor`) and re-checks cap and policy;
 * this surface mirrors those rules so a player is not walked into a rejection.
 */

type LevelState = GmView | PlayerView;

export function LevelFlow({
  state,
  role,
  actorId,
  connection = "online",
  onClose,
  onDone
}: Readonly<{
  state: LevelState;
  role: "gm" | "player";
  actorId: string;
  connection?: "online" | "reconnecting" | "offline";
  onClose: () => void;
  onDone: (name: string) => void;
}>) {
  const catalogs = useBuilderCatalogs();
  const { toast } = useToast();
  const [target, setTarget] = useState<number | null>(null);

  const actor = state.actors.find((entry) => entry.id === actorId) ?? null;
  /**
   * The stored sheet. A GM reads the definition library; a player has only their own claimed
   * character's definition, so for anyone else this finds nothing, as the server would.
   */
  const definition: ActorDefinition | null = useMemo(() => {
    if (!actor) return null;
    if ("definition" in actor && actor.definition) return actor.definition as ActorDefinition;
    const library = "definitions" in state ? state.definitions : [];
    return (
      (library.find((entry) => entry.id === actor.definitionId)?.definition as ActorDefinition | undefined) ?? null
    );
  }, [actor, state]);

  const cap = state.builderPolicy.maxLevel;
  const identity = identityOf(definition);
  const ledger = ledgerOf(definition);
  const current = identity?.level ?? 1;
  const reading = useBuilderOffers(
    target !== null && identity && ledger
      ? {
          speciesId: identity.speciesId,
          backgroundId: identity.backgroundId,
          classId: identity.classId,
          level: target,
          choices: ledger
        }
      : null
  );

  if (!actor)
    return (
      <Gate title="That character isn't here" onClose={onClose}>
        This sheet isn&rsquo;t on the table any more. It may have been archived or deleted.
      </Gate>
    );

  if (role === "player" && state.builderPolicy.playerBuilder !== "open")
    return (
      <Gate title="Your GM builds the characters at this table" onClose={onClose}>
        Ask them to level {actor.name} for you.
      </Gate>
    );

  if (!identity || !ledger || !definition)
    return (
      <Gate title={`${actor.name} wasn't built here`} onClose={onClose}>
        This sheet wasn&rsquo;t built here, so it can&rsquo;t be releveled step-by-step yet. Edit the sheet directly, or
        rebuild it in the builder.
      </Gate>
    );

  if (target !== null && reading.refusal)
    return (
      <Gate title={`${actor.name}'s choices could not be read`} onClose={() => setTarget(null)}>
        {reading.refusal}
      </Gate>
    );

  if (target !== null && (!reading.current || !reading.reply || !catalogs.loaded))
    return (
      <div className="cb-page cb-level">
        <p className="cb-note" role="status">
          Reading {actor.name}&rsquo;s choices at level {target}…
        </p>
        <Button variant="ghost" onClick={() => setTarget(null)}>
          Back
        </Button>
      </div>
    );

  if (target !== null && reading.reply) {
    const seed = draftFromLedger(identity, ledger, definition, catalogs, target, state.builderPolicy, reading.reply);
    const gap = hpRollGap(ledger, target);
    const recorded = recordedAbilities(ledger);
    return (
      <CharacterBuilder
        state={state}
        connection={connection}
        onClose={() => setTarget(null)}
        onCreated={(name) => {
          toast(`${name} is level ${target}.`, { tone: "success" });
          onDone(name);
        }}
        rebuild={{
          actorId,
          name: actor.name,
          seed,
          ...(recorded ? { recordedMethod: recorded.method } : {}),
          ...(gap
            ? {
                notice: (
                  <Alert tone="info" title="About this character's hit points">
                    The table rolls hit points for level{gap.length > 1 ? "s" : ""} {gap.join(", ")} when you apply
                    this. Rolls already recorded are kept.
                  </Alert>
                )
              }
            : {})
        }}
      />
    );
  }

  const removed = choicesAbove(ledger, current - 1);
  const atCap = current >= cap;

  return (
    <div className="cb-page cb-level">
      <header className="cb-level-head">
        <span className="nh-eyebrow">Level</span>
        <h2>{actor.name}</h2>
        <p>
          Level {current}
          {cap < 20 ? ` · the table's cap is ${cap}` : ""}
        </p>
      </header>

      {/* Buttons, not a slider: a 20-stop scrubber is unusable at 390px. */}
      <ol className="cb-level-rail" aria-label="Levels">
        {Array.from({ length: cap }, (_, index) => index + 1).map((level) => (
          <li
            key={level}
            className={`cb-level-pip${level === current ? " current" : ""}${level < current ? " reached" : ""}`}
            aria-current={level === current ? "step" : undefined}
          >
            {level}
          </li>
        ))}
      </ol>

      <div className="cb-level-actions">
        <Button variant="primary" disabled={atCap} onClick={() => setTarget(current + 1)}>
          Level up to {Math.min(cap, current + 1)}
        </Button>
        <Button variant="secondary" disabled={current <= 1} onClick={() => setTarget(current - 1)}>
          Level down to {Math.max(1, current - 1)}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Back to the sheet
        </Button>
      </div>

      {atCap && <p className="cb-note">At the table&rsquo;s level cap ({cap}).</p>}

      {current > 1 && (
        <section className="cb-level-preview">
          <h3>Leveling down to {current - 1}</h3>
          <p>
            {removed.length > 0 ? (
              <>
                Leveling down removes:{" "}
                {removed
                  .map((row) =>
                    row.id
                      .split("-")
                      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                      .join(" ")
                  )
                  .join(", ")}
                .
              </>
            ) : (
              <>Level {current} added no choices of its own.</>
            )}{" "}
            Your level-{current} choices and HP roll are kept — leveling back up restores them exactly.
          </p>
        </section>
      )}
    </div>
  );
}

function Gate({
  title,
  children,
  onClose
}: Readonly<{ title: string; children: React.ReactNode; onClose: () => void }>) {
  return (
    <div className="cb-page cb-level">
      <section className="cb-level-gate">
        <h2>{title}</h2>
        <p>{children}</p>
        <Button variant="secondary" onClick={onClose}>
          Back
        </Button>
      </section>
    </div>
  );
}
