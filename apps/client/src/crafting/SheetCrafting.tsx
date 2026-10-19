import { useEffect, useState } from "react";
import type { CraftingOffersReply, GmView, PlayerCraftingProject, PlayerView } from "@vtt/domain";
import { Button, Field, Meter, Modal, Select } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { useEquipmentReference } from "../encounter/equipment";
import { titleCase } from "../encounter/format";
import { read } from "../lib/command";
import type { SheetEdit } from "../sheet/useSheetEdit";
import { coinWords, daysWords, workDays } from "./craft-words";
import "./crafting.css";

type Project = Pick<
  PlayerCraftingProject,
  "id" | "crafterId" | "itemName" | "toolId" | "helperIds" | "workMinutes" | "doneMinutes"
>;

/** The party's crafting projects as this viewer received them: all of them for the GM, the visible party's for a player. */
export function craftingProjectsOf(state: GmView | PlayerView | undefined): readonly Project[] {
  const crafting = state?.crafting;
  if (!crafting) return [];
  return "projects" in crafting ? crafting.projects : crafting;
}

/** "Cobbler's Tools" for a catalog id, from the catalog when it has loaded. */
function useCatalogName(): (id: string) => string {
  const { catalog } = useEquipmentReference();
  return (id) => catalog.find((entry) => entry.id === id)?.name ?? id.split("-").map(titleCase).join(" ");
}

/**
 * The sheet's crafting (SRD 5.2.1 Crafting): what the character makes and helps make, with how far each has come, and
 * a dialog to start a project from what its tools make. The server prices it, debits the purse, checks the tool and
 * the proficiency, and counts the days as the GM passes downtime.
 */
export function SheetCrafting({
  actor,
  state,
  busy,
  edit
}: Readonly<{
  actor: Readonly<{ id: string; name: string }>;
  state: GmView | PlayerView | undefined;
  busy: boolean;
  edit: SheetEdit;
}>) {
  const [starting, setStarting] = useState(false);
  const { confirm, dialog } = useConfirm();
  const catalogName = useCatalogName();
  const projects = craftingProjectsOf(state);
  const nameOf = (actorId: string) => state?.actors.find((other) => other.id === actorId)?.name ?? "Someone";
  const mine = projects.filter((project) => project.crafterId === actor.id || project.helperIds.includes(actor.id));
  const others = projects.filter((project) => !mine.includes(project));

  const action = (project: Project) => {
    if (project.crafterId === actor.id)
      return (
        <Button
          size="sm"
          variant="ghost"
          className="cs-danger"
          disabled={busy}
          onClick={() =>
            void confirm({
              title: `Call off ${project.itemName}?`,
              body: `The raw materials ${actor.name} paid for it are spent.`,
              confirmLabel: "Call off",
              danger: true
            }).then((ok) => {
              if (ok) void edit("crafting:cancel", { projectId: project.id });
            })
          }
        >
          Call off
        </Button>
      );
    const helping = project.helperIds.includes(actor.id);
    return (
      <Button
        size="sm"
        variant={helping ? "ghost" : "secondary"}
        disabled={busy}
        onClick={() => void edit("crafting:help", { projectId: project.id, actorId: actor.id, helping: !helping })}
      >
        {helping ? "Stop helping" : "Help"}
      </Button>
    );
  };
  const projectRow = (project: Project) => (
    <li key={project.id} className="craft-project">
      <span className="craft-project-head">
        <strong>{project.itemName}</strong>
        <span className="cs-sub">
          {project.crafterId === actor.id ? catalogName(project.toolId) : `${nameOf(project.crafterId)} crafts`}
          {project.helperIds.length > 0 && ` · helped by ${project.helperIds.map(nameOf).join(", ")}`}
        </span>
      </span>
      <Meter value={workDays(project.doneMinutes)} max={workDays(project.workMinutes)} label="Days of work" />
      <span className="craft-project-actions">{action(project)}</span>
    </li>
  );

  return (
    <section className="cs-group" aria-label="Crafting">
      <span className="cs-section-head">
        <span className="cs-eyebrow">Crafting</span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStarting(true)}>
          Start a project
        </Button>
      </span>
      {mine.length > 0 ? (
        <ul className="craft-projects">{mine.map(projectRow)}</ul>
      ) : (
        <p className="cs-sub">
          {actor.name} makes nothing yet. Each day of downtime the GM passes is 8 hours of work on a project.
        </p>
      )}
      {others.length > 0 && (
        <>
          <span className="cs-eyebrow">The party&apos;s projects</span>
          <ul className="craft-projects">{others.map(projectRow)}</ul>
        </>
      )}
      {starting && <StartProject actor={actor} busy={busy} edit={edit} onClose={() => setStarting(false)} />}
      {dialog}
    </section>
  );
}

type Offers = CraftingOffersReply;
type Choice = Readonly<{ value: string; label: string; cp: number; days: number; toolName: string; carried: boolean }>;

/** Every choice the offers allow, keyed for one Select: `tool:<toolId>:<itemId>`, `scroll:<spellId>`, `magic:<itemId>`. */
function choicesOf(
  offers: Offers,
  catalogName: (id: string) => string
): Readonly<{ groups: readonly (readonly [string, readonly Choice[]])[] }> {
  const groups: (readonly [string, readonly Choice[]])[] = offers.tools
    .filter((tool) => tool.items.length > 0)
    .map((tool) => [
      tool.name,
      tool.items.map((item) => ({
        value: `tool:${tool.toolId}:${item.id}`,
        label: item.name,
        cp: item.materialsCp,
        days: item.days,
        toolName: tool.name,
        carried: tool.carried
      }))
    ]);
  if (offers.scrolls && offers.scrolls.spells.length > 0) {
    const scrolls = offers.scrolls;
    groups.push([
      "Spell Scrolls",
      scrolls.spells.map((spell) => ({
        value: `scroll:${spell.id}`,
        label: `Spell Scroll (${spell.name})`,
        cp: spell.materialsCp,
        days: spell.days,
        toolName: "Calligrapher's Supplies",
        carried: scrolls.carried
      }))
    ]);
  }
  if (offers.magicItems.length > 0) {
    const carried = new Set(offers.tools.filter((tool) => tool.carried).map((tool) => tool.toolId));
    groups.push([
      "Magic items",
      offers.magicItems.map((item) => {
        const tool = offers.tools.find((entry) => item.toolIds.includes(entry.toolId));
        return {
          value: `magic:${item.id}`,
          label: `${item.name} (${item.rarity})`,
          cp: item.materialsCp,
          days: item.days,
          toolName: tool?.name ?? catalogName(item.toolIds[0] ?? ""),
          carried: item.toolIds.some((toolId) => carried.has(toolId))
        };
      })
    ]);
  }
  return { groups };
}

/** The dialog that starts a project: one Select over what the character's tools make, its price and days, then Start. */
function StartProject({
  actor,
  busy,
  edit,
  onClose
}: Readonly<{ actor: Readonly<{ id: string; name: string }>; busy: boolean; edit: SheetEdit; onClose: () => void }>) {
  const [offers, setOffers] = useState<Offers | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState("");
  const [baseId, setBaseId] = useState("");
  const catalogName = useCatalogName();
  useEffect(() => {
    let live = true;
    void read("actor:crafting-offers", { actorId: actor.id }).then((result) => {
      if (!live) return;
      if (result.ok && result.tools) setOffers(result as Offers);
      else setFailed(result.message ?? "What the character can make could not be loaded.");
    });
    return () => {
      live = false;
    };
  }, [actor.id]);

  const { groups } = offers ? choicesOf(offers, catalogName) : { groups: [] };
  const choice = groups.flatMap(([, picks]) => picks).find((entry) => entry.value === picked) ?? null;
  const [kind, first, second] = picked.split(":");
  const magic = kind === "magic" ? offers?.magicItems.find((item) => item.id === first) : undefined;
  const bases = magic?.baseIds ?? [];
  const base = bases.includes(baseId) ? baseId : (bases[0] ?? "");
  const short = choice !== null && offers !== null && choice.cp > offers.purseCp;
  const start = () => {
    if (!choice) return;
    const payload =
      kind === "tool"
        ? { actorId: actor.id, itemId: second ?? "", toolId: first ?? "" }
        : kind === "scroll"
          ? { actorId: actor.id, itemId: "spell-scroll", spellId: first ?? "" }
          : { actorId: actor.id, itemId: first ?? "", ...(base ? { baseId: base } : {}) };
    void edit("crafting:start", payload).then((result) => {
      if (result.ok) onClose();
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Start a project"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !choice || !choice.carried || short} onClick={start}>
            Start
          </Button>
        </>
      }
    >
      <div className="craft-start">
        {failed ? (
          <p className="cs-sub">{failed}</p>
        ) : !offers ? (
          <p className="cs-sub">Loading what {actor.name} can make…</p>
        ) : groups.length === 0 ? (
          <p className="cs-sub">
            {actor.name} has no tool proficiency that crafts anything. Crafting needs proficiency with the tool that
            makes the item.
          </p>
        ) : (
          <>
            <p className="cs-sub">
              {actor.name}&apos;s purse holds {coinWords(offers.purseCp)}.
            </p>
            <Field label="What to make" htmlFor="craft-start-item">
              <Select id="craft-start-item" value={picked} onChange={(event) => setPicked(event.target.value)}>
                <option value="">Choose an item</option>
                {groups.map(([group, picks]) => (
                  <optgroup key={group} label={group}>
                    {picks.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label} · {coinWords(entry.cp)} · {daysWords(entry.days * 480)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            {bases.length > 0 && (
              <Field label="Made on" htmlFor="craft-start-base">
                <Select id="craft-start-base" value={base} onChange={(event) => setBaseId(event.target.value)}>
                  {bases.map((id) => (
                    <option key={id} value={id}>
                      {catalogName(id)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {choice && (
              <p className="cs-sub">
                {choice.label} takes {coinWords(choice.cp)} of raw materials and {daysWords(choice.days * 480)} of work
                with {choice.toolName}. Each helper with the proficiency divides the days.
                {!choice.carried && ` Crafting needs ${choice.toolName} in the pack.`}
                {short && ` The purse holds less than that.`}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
