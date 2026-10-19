import { useState } from "react";
import type { GmView } from "@vtt/domain";
import { Button, Meter, Select } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { command } from "../lib/command";
import { coinWords, workDays } from "./craft-words";
import "./crafting.css";

type Send = (run: () => Promise<Readonly<{ ok: boolean; message?: string }>>, success: string) => Promise<boolean>;

/**
 * The party's crafting projects, for the GM (SRD 5.2.1 Crafting): each with its crafter, what it makes, how far it
 * has come and who helps. Downtime passed on the clock works them; the GM may also log a day by hand, add a helper
 * beyond the one a player may bring, or call a project off.
 */
export function CraftingProjects({ state, busy, send }: Readonly<{ state: GmView; busy: boolean; send: Send }>) {
  const projects = state.crafting?.projects ?? [];
  const { confirm, dialog } = useConfirm();
  const [helperFor, setHelperFor] = useState<Readonly<Record<string, string>>>({});
  const nameOf = (actorId: string) => state.actors.find((actor) => actor.id === actorId)?.name ?? "Someone";
  const party = state.actors.filter((actor) => actor.kind === "player-character" && !actor.archived);
  return (
    <section className="party-rest-section" aria-label="Crafting">
      <span className="party-rest-heading">Crafting</span>
      {projects.length === 0 ? (
        <p className="party-rest-hint">No projects under way. A character starts one from the Gear tab of its sheet.</p>
      ) : (
        <ul className="craft-projects">
          {projects.map((project) => {
            const candidates = party.filter(
              (actor) => actor.id !== project.crafterId && !project.helperIds.includes(actor.id)
            );
            const picked = helperFor[project.id] ?? candidates[0]?.id ?? "";
            return (
              <li key={project.id} className="craft-project">
                <span className="craft-project-head">
                  <span className="party-rest-name">{nameOf(project.crafterId)}</span>
                  <span className="party-rest-note">
                    {project.itemName} · {coinWords(project.paidCp)} paid
                  </span>
                </span>
                <Meter value={workDays(project.doneMinutes)} max={workDays(project.workMinutes)} label="Days of work" />
                {project.helperIds.length > 0 && (
                  <span className="party-rest-note">Helped by {project.helperIds.map(nameOf).join(", ")}</span>
                )}
                <span className="craft-project-actions">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void send(
                        () => command("crafting:work", { projectId: project.id, days: 1 }),
                        `A day of work on ${project.itemName} is logged.`
                      )
                    }
                  >
                    Log a day
                  </Button>
                  {candidates.length > 0 && (
                    <>
                      <Select
                        aria-label={`Helper for ${project.itemName}`}
                        value={picked}
                        disabled={busy}
                        onChange={(event) =>
                          setHelperFor((current) => ({ ...current, [project.id]: event.target.value }))
                        }
                      >
                        {candidates.map((actor) => (
                          <option key={actor.id} value={actor.id}>
                            {actor.name}
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="ghost"
                        disabled={busy || picked === ""}
                        onClick={() =>
                          void send(
                            () => command("crafting:help", { projectId: project.id, actorId: picked, helping: true }),
                            `${nameOf(picked)} helps with ${project.itemName}.`
                          )
                        }
                      >
                        Add helper
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    className="cs-danger"
                    disabled={busy}
                    onClick={() =>
                      void confirm({
                        title: `Call off ${project.itemName}?`,
                        body: `The raw materials ${nameOf(project.crafterId)} paid for it are spent.`,
                        confirmLabel: "Call off",
                        danger: true
                      }).then((ok) => {
                        if (ok)
                          void send(
                            () => command("crafting:cancel", { projectId: project.id }),
                            `${project.itemName} was called off.`
                          );
                      })
                    }
                  >
                    Call off
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="party-rest-hint">
        Pass time as downtime above and each crafter works up to 8 hours a day on its projects, helpers too.
      </p>
      {dialog}
    </section>
  );
}
