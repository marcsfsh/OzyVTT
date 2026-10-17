import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { ActorDerivedSheet, ContentSkillSummary, DerivedAbilityRow, GmActor, GmView } from "@vtt/domain";

// `command()` sends through `socket.timeout(ms).emit` with an error-first ack; routed to `socket.emit` here.
vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { socket } from "../socket";
import { ToastProvider } from "@vtt/ui";
import { setRollInput } from "../dice/roll-preference";
import { CharacterSheet } from "./CharacterSheet";
import { rollModeNotes } from "./roll-mode-notes";

// The sheet's checks and saves are named, never composed: the server works out the bonus and the Advantage or
// Disadvantage and rolls the die, so a chip can't disagree with the roll.

const SKILLS: readonly ContentSkillSummary[] = [
  { id: "athletics", name: "Athletics", description: "", ability: "str" },
  { id: "perception", name: "Perception", description: "", ability: "wis" },
  { id: "stealth", name: "Stealth", description: "", ability: "dex" },
  { id: "survival", name: "Survival", description: "", ability: "wis" }
];
const NORMAL = { mode: "normal", advantage: [], disadvantage: [] } as const;
const ABILITY_IDS = ["str", "dex", "con", "int", "wis", "cha"] as const;

function abilityRows(over: Partial<DerivedAbilityRow> = {}): DerivedAbilityRow[] {
  return ABILITY_IDS.map((ability) => ({
    ability,
    check: 1,
    checkMode: NORMAL,
    save: 1,
    saveMode: NORMAL,
    saveProficient: false,
    saveFromItems: 0,
    saveAutoFails: null,
    ...over
  }));
}

function derivedSheet(over: Partial<ActorDerivedSheet> = {}): ActorDerivedSheet {
  return {
    proficiencyBonus: 2,
    armorClass: 16,
    initiative: 2,
    abilities: abilityRows(),
    skills: [
      {
        id: "stealth",
        name: "Stealth",
        ability: "dex",
        tier: "proficient",
        bonus: 5,
        sources: [],
        mode: NORMAL,
        reliableTalent: false
      }
    ],
    tools: [],
    passivePerception: 11,
    speedFeet: 30,
    defences: { resistances: [], immunities: [], vulnerabilities: [] },
    spellSaveDcBonus: 0,
    attunementSlots: 3,
    ...over
  };
}

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
/** Answers the skill catalog, the sheet's derived numbers, each command in `replies`, and every other one with ok. */
function serve(derived: ActorDerivedSheet, replies: Record<string, unknown> = {}) {
  emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
    if (event === "content:skills") ack?.({ ok: true, skills: SKILLS, attribution: "SRD 5.2.1, CC BY 4.0." });
    else if (event === "actor:available-actions") ack?.({ ok: true, rulesMode: "assisted", actions: [], derived });
    else ack?.(replies[event] ?? { ok: true });
  });
}
/** What was sent for `event`, without the id every command carries. */
const sent = (event: string) =>
  emit.mock.calls
    .filter((call) => call[0] === event)
    .map((call) => {
      const { commandId: _commandId, ...payload } = call[1] as Record<string, unknown>;
      return payload;
    });

const HERO = "10000000-0000-4000-8000-000000000001";
const WOLF = "10000000-0000-4000-8000-000000000003";
function hero(over: Record<string, unknown> = {}): GmActor {
  return {
    id: HERO,
    name: "Aria",
    kind: "player-character",
    visibility: "public",
    hp: { current: 30, maximum: 30, temporary: 0 },
    armorClass: 16,
    speedFeet: 30,
    conditions: [],
    effects: [],
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    heroicInspiration: false,
    definitionId: "srd:player-character",
    definition: ActorDefinitionSchema.parse(loadActorFixture("player-character")),
    ...over
  } as unknown as GmActor;
}
const stateWith = (actors: readonly GmActor[], rolls: readonly unknown[] = []) =>
  ({ actors, combat: { active: false, initiative: [], pendingSaves: [] }, rolls }) as unknown as GmView;
const checkRoll = (id: string) => ({
  id,
  actorId: HERO,
  purpose: "check",
  label: "Strength check",
  visibility: "public",
  formula: "1d20 + 1",
  dice: [{ group: 0, sides: 20, face: 12, kept: true, sign: 1 }],
  total: 13
});

describe("the sheet's checks", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => setRollInput("digital"));

  it("rolls an ability check on the server and says what it came to", async () => {
    serve(derivedSheet(), {
      "check:roll": {
        ok: true,
        check: { label: "Strength check", natural: 12, total: 13, dc: null, success: null, rollId: "r1" }
      }
    });
    render(<CharacterSheet actor={hero()} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Roll a Strength check, +1" }));
    expect(sent("check:roll")).toEqual([{ actorId: HERO, ability: "str", visibility: "public" }]);
    // Nothing is composed on the client: no free roll carries a check's bonus.
    expect(sent("dice:roll")).toEqual([]);
    expect(await screen.findByText("Strength check: 13 (d20 12).")).toBeTruthy();
  });

  it("says an before a vowel: Roll an Intelligence check", async () => {
    serve(derivedSheet());
    render(<CharacterSheet actor={hero()} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    expect(await screen.findByRole("button", { name: "Roll an Intelligence check, +1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Roll an Intelligence saving throw/ })).toBeTruthy();
  });

  it("labels who sees the sheet's rolls where it can be read", async () => {
    serve(derivedSheet());
    render(<CharacterSheet actor={hero()} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const picker = await screen.findByRole("combobox", { name: "Visibility" });
    expect(picker.closest("label")?.textContent).toContain("Visibility");
  });

  it("drops an initiative roll from the bar once its fight is over", async () => {
    serve(derivedSheet());
    const initiative = { ...checkRoll("i1"), label: "Initiative", purpose: "manual", formula: "1d20 + 2", total: 14 };
    const fighting = {
      ...stateWith([hero()], [initiative]),
      combat: { active: true, initiative: [], pendingSaves: [], rulesMode: "assisted", ruleExceptions: {} }
    } as unknown as GmView;
    const { rerender } = render(<CharacterSheet actor={hero()} role="gm" state={fighting} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    expect((await screen.findByTitle("Open the dice log")).textContent).toContain("Initiative");
    rerender(<CharacterSheet actor={hero()} role="gm" state={stateWith([hero()], [initiative])} onClose={() => {}} />);
    expect(screen.queryByTitle("Open the dice log")).toBeNull();
    // Any other roll stays until the next one.
    rerender(
      <CharacterSheet actor={hero()} role="gm" state={stateWith([hero()], [checkRoll("c1")])} onClose={() => {}} />
    );
    expect(screen.getByTitle("Open the dice log").textContent).toContain("Strength check");
  });

  it("names the skill, and a typed die sends its face alone", async () => {
    serve(derivedSheet());
    setRollInput("manual");
    render(<CharacterSheet actor={hero()} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Roll Stealth, +5" }));
    await user.type(screen.getByPlaceholderText("1 to 20"), "17");
    await user.click(screen.getByRole("button", { name: "Roll" }));
    expect(sent("check:roll")).toEqual([
      { actorId: HERO, ability: "dex", skill: "stealth", visibility: "public", face: 17 }
    ]);
  });

  it("refuses a typed number that is not a d20's face", async () => {
    serve(derivedSheet());
    setRollInput("manual");
    render(<CharacterSheet actor={hero()} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Roll a Strength check, +1" }));
    await user.type(screen.getByPlaceholderText("1 to 20"), "23");
    await user.click(screen.getByRole("button", { name: "Roll" }));
    expect(sent("check:roll")).toEqual([]);
    const refusal = await screen.findByText("Type the d20's face, a whole number from 1 to 20.");
    // A toast, said in the sheet's own row over the table: the pane scrolls, and a line at its foot is never seen from
    // a skill near its top.
    expect(refusal.closest(".sheet-pane")).toBeNull();
    expect(refusal.closest(".sheet-toast")).not.toBeNull();
  });

  it("leaves an embedded sheet's results to the table's own status line", async () => {
    serve(derivedSheet());
    setRollInput("manual");
    render(<CharacterSheet actor={hero()} role="player" embedded onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Roll a Strength check, +1" }));
    await user.type(screen.getByPlaceholderText("1 to 20"), "23");
    await user.click(screen.getByRole("button", { name: "Roll" }));
    const refusal = await screen.findByText("Type the d20's face, a whole number from 1 to 20.");
    expect(refusal.closest(".sheet-toast")).toBeNull();
    expect(refusal.closest(".nh-toast")).not.toBeNull();
  });

  it("marks and explains Advantage and Disadvantage before the roll", async () => {
    const poisoned = { mode: "disadvantage", advantage: [], disadvantage: ["Poisoned"] } as const;
    serve(
      derivedSheet({
        abilities: abilityRows({ checkMode: poisoned }),
        skills: [
          {
            id: "stealth",
            name: "Stealth",
            ability: "dex",
            tier: "proficient",
            bonus: 5,
            sources: [],
            mode: { mode: "disadvantage", advantage: [], disadvantage: ["Poisoned", "Chain Mail"] },
            reliableTalent: false
          }
        ],
        passivePerception: 6
      })
    );
    render(<CharacterSheet actor={hero()} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    expect(
      await screen.findByRole("button", { name: "Roll a Dexterity check, +1 with Disadvantage (Poisoned)" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Roll Stealth, +5 with Disadvantage (Poisoned, Chain Mail)" })
    ).toBeTruthy();
    const notes = within(screen.getByRole("list", { name: "Advantage and Disadvantage" }));
    expect(notes.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Disadvantage on Stealth checks · Chain Mail",
      "Disadvantage on ability checks · Poisoned"
    ]);
    // Passive Perception is the server's, Disadvantage's -5 included.
    expect(screen.getByText("Passive Perception").nextElementSibling?.textContent).toBe("6");
  });

  it("finds the quarry of the character's Hunter's Mark with Advantage", async () => {
    serve(derivedSheet());
    const wolf = {
      ...hero(),
      id: WOLF,
      name: "Wolf",
      kind: "monster",
      effects: [{ id: "mark", name: "Hunter's Mark", tags: ["hunters-mark"], sourceActorId: HERO }]
    } as unknown as GmActor;
    const actor = hero();
    render(<CharacterSheet actor={actor} role="gm" state={stateWith([actor, wolf])} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Roll Wisdom (Survival) to find Wolf (Hunter's Mark)" })
    );
    expect(sent("check:roll")).toEqual([
      { actorId: HERO, ability: "wis", skill: "survival", visibility: "public", findActorId: WOLF }
    ]);
  });
});

describe("the sheet's saving throws", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks the server, which answers a save the character owes", async () => {
    serve(derivedSheet(), {
      "save:roll": { ok: true, outcome: { success: false, total: 9, dc: 13, natural: 8, appliedDamage: 0 } }
    });
    render(<CharacterSheet actor={hero()} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Roll a Dexterity saving throw, +1" }));
    expect(sent("save:roll")).toEqual([{ actorId: HERO, ability: "dex" }]);
    expect(sent("dice:roll")).toEqual([]);
    expect(await screen.findByText("Dexterity save: 9 (d20 8) vs DC 13 · failure.")).toBeTruthy();
  });

  it("says when a condition fails the save without a roll", async () => {
    serve(derivedSheet({ abilities: abilityRows({ saveAutoFails: "paralyzed" }) }), {
      "save:roll": { ok: true, outcome: { total: 0, autoFailed: "paralyzed" } }
    });
    render(<CharacterSheet actor={hero()} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Roll a Strength saving throw, +1, fails automatically" })
    );
    expect(await screen.findByText("Strength save: fails automatically.")).toBeTruthy();
  });
});

describe("saves owed on a player's sheet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves a save the GM called for to the call's card", () => {
    serve(derivedSheet());
    const save = (id: string, actionName: string) => ({
      id,
      targetActorId: HERO,
      ability: "dex",
      dc: 13,
      sourceName: "The GM",
      actionName,
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [],
      saveBonus: 0,
      createdAt: 0
    });
    const actor = hero();
    const state = {
      actors: [actor],
      combat: {
        active: false,
        initiative: [],
        pendingSaves: [
          save("60000000-0000-4000-8000-000000000001", "Called"),
          save("60000000-0000-4000-8000-000000000002", "Trap")
        ]
      },
      rolls: [],
      rollCalls: [
        {
          id: "70000000-0000-4000-8000-000000000001",
          kind: "save",
          subject: { ability: "dex" },
          dc: 13,
          blind: false,
          entries: [{ actorId: HERO, saveId: "60000000-0000-4000-8000-000000000001", answered: false }],
          createdAt: 0
        }
      ]
    } as unknown as GmView;
    render(<CharacterSheet actor={actor} role="player" state={state} onClose={() => {}} />, { wrapper: ToastProvider });
    expect(screen.getAllByRole("group", { name: "Saving throw for Aria" })).toHaveLength(1);
    expect(screen.getByText(/vs Trap/)).toBeTruthy();
  });
});

describe("a monster's sheet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rolls the stat block's saves and skills like a character's", async () => {
    serve(
      derivedSheet({
        skills: [
          {
            id: "stealth",
            name: "Stealth",
            ability: "dex",
            tier: "none",
            bonus: 6,
            sources: [],
            mode: NORMAL,
            reliableTalent: false
          }
        ]
      })
    );
    const goblin = {
      ...hero(),
      name: "Goblin",
      kind: "monster",
      definitionId: "srd:goblin",
      definition: ActorDefinitionSchema.parse(loadActorFixture("monster"))
    } as unknown as GmActor;
    render(<CharacterSheet actor={goblin} role="gm" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    expect(await screen.findByRole("button", { name: "Roll a Wisdom saving throw, +1" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Roll Stealth, +6" }));
    expect(sent("check:roll")).toEqual([{ actorId: HERO, ability: "dex", skill: "stealth", visibility: "public" }]);
    // A monster's proficiencies are its stat block's: there is nothing to edit.
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("the sheet's Speed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the Speed in force, with the base beside it when they differ", async () => {
    serve(derivedSheet({ speedFeet: 15 }));
    render(<CharacterSheet actor={hero()} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    expect(await screen.findByText("15 ft.")).toBeTruthy();
    expect(screen.getByText("Base 30 ft.")).toBeTruthy();
  });
});

describe("Heroic Inspiration on the sheet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets the GM give it", async () => {
    serve(derivedSheet());
    render(<CharacterSheet actor={hero()} role="gm" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    const block = within(screen.getByRole("group", { name: "Heroic Inspiration" }));
    expect(block.getByText("None")).toBeTruthy();
    await user.click(block.getByRole("button", { name: "Give Heroic Inspiration" }));
    expect(sent("actor:set-heroic-inspiration")).toEqual([{ actorId: HERO, has: true }]);
  });

  it("spends it to reroll the check the sheet just made", async () => {
    serve(derivedSheet(), {
      "check:roll": {
        ok: true,
        check: { label: "Strength check", natural: 2, total: 3, dc: null, success: null, rollId: "r1" }
      },
      "check:reroll": {
        ok: true,
        check: { label: "Strength check reroll", natural: 15, total: 16, dc: null, success: null, rollId: "r2" }
      }
    });
    const actor = hero({ heroicInspiration: true });
    const { rerender } = render(
      <CharacterSheet actor={actor} role="player" state={stateWith([actor])} onClose={() => {}} />,
      { wrapper: ToastProvider }
    );
    const user = userEvent.setup();
    expect(screen.getByText("Held · spend it to reroll one die")).toBeTruthy();
    // A player spends it from a reroll, not from a button of its own.
    expect(screen.queryByRole("button", { name: "Give Heroic Inspiration" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Roll a Strength check, +1" }));
    // The reroll is offered once the check is the character's latest roll.
    expect(screen.queryByRole("button", { name: "Reroll · Heroic Inspiration" })).toBeNull();
    rerender(
      <CharacterSheet actor={actor} role="player" state={stateWith([actor], [checkRoll("r1")])} onClose={() => {}} />
    );
    await user.click(screen.getByRole("button", { name: "Reroll · Heroic Inspiration" }));
    expect(sent("check:reroll")).toEqual([{ actorId: HERO }]);
    expect(await screen.findByText("Strength check reroll: 16 (d20 15).")).toBeTruthy();
  });

  it("offers no reroll without it", async () => {
    serve(derivedSheet(), {
      "check:roll": {
        ok: true,
        check: { label: "Strength check", natural: 2, total: 3, dc: null, success: null, rollId: "r1" }
      }
    });
    const actor = hero();
    const { rerender } = render(
      <CharacterSheet actor={actor} role="player" state={stateWith([actor])} onClose={() => {}} />,
      { wrapper: ToastProvider }
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Roll a Strength check, +1" }));
    rerender(
      <CharacterSheet actor={actor} role="player" state={stateWith([actor], [checkRoll("r1")])} onClose={() => {}} />
    );
    expect(screen.queryByRole("button", { name: /Reroll/ })).toBeNull();
  });
});

describe("rollModeNotes", () => {
  it("groups each reason by the rolls it touches", () => {
    const disadvantage = (...sources: string[]) =>
      ({ mode: "disadvantage", advantage: [], disadvantage: sources }) as const;
    const notes = rollModeNotes(
      derivedSheet({
        abilities: ABILITY_IDS.map((ability) => ({
          ...abilityRows()[0]!,
          ability,
          checkMode: ability === "str" || ability === "dex" ? disadvantage("Plate Armor") : NORMAL,
          saveMode: ability === "dex" ? disadvantage("Restrained") : NORMAL
        })),
        skills: [
          {
            id: "athletics",
            name: "Athletics",
            ability: "str",
            tier: "none",
            bonus: 1,
            sources: [],
            mode: disadvantage("Plate Armor"),
            reliableTalent: false
          },
          {
            id: "perception",
            name: "Perception",
            ability: "wis",
            tier: "none",
            bonus: 1,
            sources: [],
            mode: { mode: "advantage", advantage: ["Keen Senses"], disadvantage: [] },
            reliableTalent: false
          }
        ]
      })
    );
    expect(notes).toEqual([
      { side: "advantage", source: "Keen Senses", rolls: "Perception checks" },
      // Athletics is a Strength check, already named.
      { side: "disadvantage", source: "Plate Armor", rolls: "Strength and Dexterity checks" },
      { side: "disadvantage", source: "Restrained", rolls: "Dexterity saves" }
    ]);
  });
});
