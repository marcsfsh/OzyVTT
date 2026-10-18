import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodexPrepSection, CodexSession } from "@vtt/domain";
import { CodexStore } from "../src/codex-store.js";
import { liveBoard, sessionHappened } from "../src/codex/live.js";
import { BUILT_IN_TEMPLATE_ID } from "../src/codex/prep.js";
import { CODEX_MIGRATIONS } from "../src/codex/schema.js";
import { CodexNotFoundError, CodexRevisionConflictError, CodexValidationError } from "../src/codex/validate.js";
import { migrate, openDatabase } from "../src/database.js";
import { prepNotes, prepNotesOf } from "./codex-prep-notes.js";

// Session prep: the template library, sessions copied from templates, re-applying one, the live board's commands and
// reads, party placement, and migration 5. All of it is GM-only; the HTTP tests check that players never see it.

let directory: string;
let store: CodexStore;
let clock = Date.parse("2026-10-17T18:00:00.000Z");

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "vtt-codex-prep-"));
  store = new CodexStore(join(directory, "vtt.sqlite"), () => (clock += 1000));
  await store.initialize();
});
afterEach(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});

const sectionOf = <T extends CodexPrepSection["type"]>(session: CodexSession, type: T) =>
  session.prep.find((section): section is Extract<CodexPrepSection, { type: T }> => section.type === type)!;

describe("the prep template library", () => {
  it("starts with the built-in template as the default, its eight sections in order", () => {
    const { templates, defaultTemplateId } = store.listPrepTemplates();
    expect(defaultTemplateId).toBe(BUILT_IN_TEMPLATE_ID);
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ builtIn: true, isDefault: true, rev: 0, createdAt: null });
    expect(templates[0]!.sections.map((section) => [section.title, section.type])).toEqual([
      ["Strong start", "text"],
      ["Scenes", "scenes"],
      ["Secrets and clues", "checklist"],
      ["Cast", "pages"],
      ["Places", "pages"],
      ["Clocks", "clocks"],
      ["Quests in play", "quests"],
      ["Rewards", "text"]
    ]);
  });

  it("creates, renames, reorders, duplicates and deletes a template, and lists the built-in first", () => {
    const heist = store.createPrepTemplate({
      name: "Heist night",
      sections: [
        { title: "The mark", type: "pages" },
        { title: "Clues", prompt: "One per guard rotation.", type: "checklist" }
      ]
    });
    expect(heist).toMatchObject({ builtIn: false, isDefault: false, rev: 1 });
    const [mark, clues] = heist.sections;
    expect(clues).toMatchObject({ title: "Clues", prompt: "One per guard rotation.", type: "checklist" });

    // Reordering is sending the list in its new order; ids are kept.
    const reordered = store.updatePrepTemplate(heist.id, { name: "Heist", sections: [clues!, mark!] }, heist.rev);
    expect(reordered.name).toBe("Heist");
    expect(reordered.sections.map((section) => section.id)).toEqual([clues!.id, mark!.id]);
    expect(reordered.rev).toBe(2);
    expect(() => store.updatePrepTemplate(heist.id, { name: "Stale" }, 1)).toThrow(CodexRevisionConflictError);

    const copy = store.duplicatePrepTemplate(heist.id);
    expect(copy.name).toBe("Heist copy");
    // The copy keeps the section ids, so a session from the original re-applies the copy cleanly.
    expect(copy.sections.map((section) => section.id)).toEqual(reordered.sections.map((section) => section.id));
    expect(store.listPrepTemplates().templates.map((template) => template.name)).toEqual([
      "Starting template",
      "Heist",
      "Heist copy"
    ]);

    store.deletePrepTemplate(copy.id);
    expect(store.getPrepTemplate(copy.id)).toBeNull();
  });

  it("refuses to change or delete the built-in, and copies it on request", () => {
    expect(() => store.updatePrepTemplate(BUILT_IN_TEMPLATE_ID, { name: "Mine" }, undefined)).toThrow(
      CodexValidationError
    );
    expect(() => store.deletePrepTemplate(BUILT_IN_TEMPLATE_ID)).toThrow(CodexValidationError);
    const mine = store.duplicatePrepTemplate(BUILT_IN_TEMPLATE_ID, "My prep");
    expect(mine).toMatchObject({ name: "My prep", builtIn: false });
    expect(mine.sections).toHaveLength(8);
  });

  it("sets the default, and falls back to the built-in when the default is deleted", () => {
    const heist = store.createPrepTemplate({ name: "Heist" });
    expect(store.setDefaultPrepTemplate(heist.id)).toBe(heist.id);
    expect(store.listPrepTemplates().defaultTemplateId).toBe(heist.id);
    expect(store.getPrepTemplate(heist.id)!.isDefault).toBe(true);
    store.deletePrepTemplate(heist.id);
    expect(store.listPrepTemplates().defaultTemplateId).toBe(BUILT_IN_TEMPLATE_ID);
    expect(() => store.setDefaultPrepTemplate(crypto.randomUUID())).toThrow(CodexNotFoundError);
  });

  it("bounds the library, a template's sections and its titles", () => {
    const sections = Array.from({ length: 25 }, (_, index) => ({ title: `S${index}`, type: "text" as const }));
    expect(() => store.createPrepTemplate({ name: "Too long", sections })).toThrow(/at most 24 sections/);
    expect(() => store.createPrepTemplate({ name: "Blank", sections: [{ title: " ", type: "text" }] })).toThrow(
      CodexValidationError
    );
    const id = crypto.randomUUID();
    expect(() =>
      store.createPrepTemplate({
        name: "Twins",
        sections: [
          { id, title: "A", type: "text" },
          { id, title: "B", type: "text" }
        ]
      })
    ).toThrow(/share an id/);
    for (let index = 0; index < 50; index += 1) store.createPrepTemplate({ name: `T${index}` });
    expect(() => store.createPrepTemplate({ name: "One more" })).toThrow(/at most 50 templates/);
  });
});

describe("sessions copy a template's sections", () => {
  it("copies the default template when a new session names none, each section empty and linked back", () => {
    const session = store.createSession({ sessionNumber: 1 });
    expect(session.prepTemplateId).toBe(BUILT_IN_TEMPLATE_ID);
    const builtIn = store.getPrepTemplate(BUILT_IN_TEMPLATE_ID)!;
    expect(session.prep.map((section) => section.templateSectionId)).toEqual(
      builtIn.sections.map((section) => section.id)
    );
    // Fresh ids for the session's own copy.
    expect(session.prep.map((section) => section.id)).not.toContain(builtIn.sections[0]!.id);
    expect(sectionOf(session, "text").text).toBe("");
    expect(sectionOf(session, "checklist").items).toEqual([]);
    expect(session.currentSceneId).toBeNull();
  });

  it("copies a chosen template, starts empty with `null`, and refuses a template and sections together", () => {
    const heist = store.createPrepTemplate({ name: "Heist", sections: [{ title: "The mark", type: "pages" }] });
    store.setDefaultPrepTemplate(heist.id);
    expect(store.createSession({}).prep.map((section) => section.title)).toEqual(["The mark"]);
    expect(store.createSession({ templateId: BUILT_IN_TEMPLATE_ID }).prep).toHaveLength(8);
    expect(store.createSession({ templateId: null })).toMatchObject({ prep: [], prepTemplateId: null });
    expect(() => store.createSession({ templateId: heist.id, prep: prepNotes("x") })).toThrow(CodexValidationError);
    expect(() => store.createSession({ templateId: crypto.randomUUID() })).toThrow(CodexNotFoundError);
  });

  it("never changes a session when its template is edited later", () => {
    const heist = store.createPrepTemplate({ name: "Heist", sections: [{ title: "The mark", type: "pages" }] });
    const session = store.createSession({ templateId: heist.id });
    store.updatePrepTemplate(heist.id, { sections: [{ title: "The crew", type: "pages" }] }, undefined);
    store.deletePrepTemplate(heist.id);
    expect(store.getSession(session.id)!.prep.map((section) => section.title)).toEqual(["The mark"]);
    expect(store.getSession(session.id)!.prepTemplateId).toBe(heist.id);
  });

  it("re-applies a template and keeps what was written in the sections that still match", () => {
    const heist = store.createPrepTemplate({
      name: "Heist",
      sections: [
        { title: "Opening", type: "text" },
        { title: "Clues", type: "checklist" },
        { title: "Scratch", type: "text" }
      ]
    });
    const page = store.createPage({ title: "Lantern Order" });
    const session = store.createSession({ templateId: heist.id });
    const [opening, clues, scratch] = session.prep;
    const written = store.updateSession(
      session.id,
      {
        prep: [
          { ...opening!, text: "The vault door is open." } as CodexPrepSection,
          { ...clues!, items: [{ text: "The guard drinks." }] } as never,
          scratch!,
          { type: "pages", title: "Cast", pageIds: [page.id] },
          { type: "text", title: "Empty extra", text: "" }
        ]
      },
      session.rev
    );

    // The new template renames the first section, drops "Scratch" and adds a section of a type nobody wrote in.
    const next = store.duplicatePrepTemplate(heist.id, "Heist v2");
    const [nextOpening, nextClues] = next.sections;
    store.updatePrepTemplate(
      next.id,
      {
        sections: [
          { ...nextOpening!, title: "Strong start", prompt: "Open on the vault." },
          nextClues!,
          { title: "cast", type: "pages" },
          { title: "Rewards", type: "text" }
        ]
      },
      undefined
    );
    const applied = store.applyPrepTemplate(session.id, next.id, written.rev);
    expect(applied.prepTemplateId).toBe(next.id);
    expect(applied.prep.map((section) => [section.title, section.type])).toEqual([
      // Matched by template section: the template's title and prompt win, the text stays.
      ["Strong start", "text"],
      ["Clues", "checklist"],
      // Matched by title, case-insensitive, and type.
      ["cast", "pages"],
      ["Rewards", "text"]
    ]);
    expect(applied.prep[0]).toMatchObject({
      id: opening!.id,
      prompt: "Open on the vault.",
      text: "The vault door is open."
    });
    expect(sectionOf(applied, "checklist").items.map((item) => item.text)).toEqual(["The guard drinks."]);
    expect(sectionOf(applied, "pages").pageIds).toEqual([page.id]);
    // "Scratch" and the empty extra held nothing, so nothing was lost by dropping them.
    expect(applied.prep.map((section) => section.title)).not.toContain("Empty extra");
    expect(() => store.applyPrepTemplate(session.id, next.id, written.rev)).toThrow(CodexRevisionConflictError);
  });

  it("keeps an unmatched section that holds something, after the template's sections", () => {
    const session = store.createSession({ prep: prepNotes("Ambush at the bridge.") });
    const applied = store.applyPrepTemplate(session.id, BUILT_IN_TEMPLATE_ID, undefined);
    expect(applied.prep).toHaveLength(9);
    expect(applied.prep[8]).toMatchObject({ title: "Prep notes", text: "Ambush at the bridge." });
  });

  it("refuses prep that would break a tick or the current scene, and bounds the text", () => {
    const id = crypto.randomUUID();
    expect(() =>
      store.createSession({
        prep: [
          { type: "checklist", title: "Clues", items: [{ id, text: "A" }] },
          { type: "scenes", title: "Scenes", scenes: [{ id, title: "B" }] }
        ]
      })
    ).toThrow(/share an id/);
    expect(() => store.createSession({ prep: [{ type: "text", title: "Long", text: "x".repeat(20_001) }] })).toThrow(
      CodexValidationError
    );
    const many = Array.from({ length: 6 }, (_, index) => ({
      type: "text" as const,
      title: `Part ${index}`,
      text: "x".repeat(19_000)
    }));
    expect(() => store.createSession({ prep: many })).toThrow(/limited to 100000 characters/);
  });
});

describe("the live board's commands", () => {
  const boardSession = () => {
    const quay = store.createPage({ title: "Emberfall Docks", entityType: "location", revealedToPlayers: true });
    const ysolde = store.createPage({ title: "Ysolde Varn", entityType: "character" });
    const quest = store.createQuest({ title: "The missing cargo", status: "active", revealedToPlayers: true });
    store.setCalendar({
      yearName: "DR",
      months: [{ name: "Emberfall", days: 30 }],
      weekdays: [],
      currentDate: { year: 1492, month: 0, day: 14 }
    });
    const fired = store.createDeadline({
      playerText: "The tide turns.",
      inWorldDate: { year: 1492, month: 0, day: 10 }
    });
    const later = store.createDeadline({
      playerText: "The Tidebound sail.",
      inWorldDate: { year: 1492, month: 0, day: 20 }
    });
    const session = store.createSession({
      sessionNumber: 7,
      prep: [
        {
          type: "scenes",
          title: "Scenes",
          scenes: [
            { title: "The docks at dusk", placePageId: quay.id },
            { title: "The tower", notes: "Ysolde stalls." }
          ]
        },
        { type: "pages", title: "Cast", pageIds: [ysolde.id, crypto.randomUUID()] },
        {
          type: "checklist",
          title: "Secrets and clues",
          items: [
            { text: "Ysolde keeps a second ledger.", link: { recordKind: "page", recordId: ysolde.id, blockId: null } },
            { text: "The cargo is lamp oil.", link: { recordKind: "quest", recordId: quest.id, blockId: null } }
          ]
        },
        { type: "clocks", title: "Clocks", deadlineIds: [fired.id, later.id, fired.id] },
        { type: "quests", title: "Quests in play", questIds: [quest.id] }
      ]
    });
    return { quay, ysolde, quest, fired, later, session };
  };

  it("reads the active session's board, and none without an active session", () => {
    const { quay, ysolde, quest, fired, later, session } = boardSession();
    expect(liveBoard(store)).toBeNull();
    store.setActiveSession(session.id);
    const board = liveBoard(store)!;
    expect(board).toMatchObject({ sessionId: session.id, sessionNumber: 7, rev: session.rev, currentSceneId: null });
    expect(board.scenes.map((scene) => [scene.title, scene.placeTitle, scene.current])).toEqual([
      ["The docks at dusk", quay.title, false],
      ["The tower", null, false]
    ]);
    // A page that no longer exists drops out of its group.
    expect(board.pageGroups).toEqual([
      {
        sectionId: session.prep[1]!.id,
        title: "Cast",
        pages: [{ id: ysolde.id, title: "Ysolde Varn", entityType: "character", revealedToPlayers: false }]
      }
    ]);
    expect(board.checklists[0]!.items.map((item) => [item.linkTitle, item.linkRevealed, item.blockTitle])).toEqual([
      ["Ysolde Varn", false, null],
      ["The missing cargo", true, null]
    ]);
    // Deduped, in prep order, fired by the GM's own date.
    expect(board.clocks.map((clock) => [clock.id, clock.fired])).toEqual([
      [fired.id, true],
      [later.id, false]
    ]);
    expect(board.quests).toEqual([
      { id: quest.id, title: "The missing cargo", status: "active", revealedToPlayers: true }
    ]);
  });

  it("ticks a clue, stamps when, and moves the session's rev so a stale editor can't overwrite it", () => {
    const { session } = boardSession();
    const item = sectionOf(session, "checklist").items[0]!;
    const ticked = store.tickPrepItem(session.id, item.id, true);
    const done = sectionOf(ticked, "checklist").items[0]!;
    expect(done.done).toBe(true);
    expect(done.doneAt).not.toBeNull();
    expect(ticked.rev).toBe(session.rev + 1);
    expect(() => store.updateSession(session.id, { prep: session.prep }, session.rev)).toThrow(
      CodexRevisionConflictError
    );
    // An editor that saves the prep it read back keeps the tick and its time.
    const resaved = store.updateSession(session.id, { prep: ticked.prep }, ticked.rev);
    expect(sectionOf(resaved, "checklist").items[0]).toEqual(done);
    const unticked = store.tickPrepItem(session.id, item.id, false);
    expect(sectionOf(unticked, "checklist").items[0]).toMatchObject({ done: false, doneAt: null });
    expect(() => store.tickPrepItem(session.id, crypto.randomUUID(), true)).toThrow(CodexNotFoundError);
  });

  it("sets and clears the current scene, and clears it when its scene leaves the prep", () => {
    const { session } = boardSession();
    const scenes = sectionOf(session, "scenes");
    const [, tower] = scenes.scenes;
    const set = store.setCurrentScene(session.id, tower!.id);
    expect(set.currentSceneId).toBe(tower!.id);
    store.setActiveSession(session.id);
    expect(liveBoard(store)!.scenes.map((scene) => scene.current)).toEqual([false, true]);
    expect(() => store.setCurrentScene(session.id, crypto.randomUUID())).toThrow(CodexNotFoundError);
    const trimmed = store.updateSession(
      session.id,
      {
        prep: set.prep.map((section) =>
          section.type === "scenes" ? { ...section, scenes: [scenes.scenes[0]!] } : section
        )
      },
      set.rev
    );
    expect(trimmed.currentSceneId).toBeNull();
    expect(store.setCurrentScene(session.id, null).currentSceneId).toBeNull();
  });

  it("logs a line as a hidden note filed under the session at the GM's date", () => {
    const { session } = boardSession();
    const entry = store.logSessionLine(session.id, { text: "  Lyra bribed the dockmaster.  " });
    expect(entry).toMatchObject({
      kind: "note",
      playerText: "Lyra bribed the dockmaster.",
      gmText: null,
      sessionId: session.id,
      sessionNumber: 7,
      revealedToPlayers: false,
      inWorldDate: { year: 1492, month: 0, day: 14 }
    });
    expect(store.logSessionLine(session.id, { text: "Seen.", revealedToPlayers: true }).revealedToPlayers).toBe(true);
    expect(() => store.logSessionLine(session.id, { text: "   " })).toThrow(CodexValidationError);
    expect(() => store.logSessionLine(crypto.randomUUID(), { text: "Lost." })).toThrow(CodexNotFoundError);
    store.setActiveSession(session.id);
    expect(liveBoard(store)!.logged.map((line) => line.text)).toEqual(["Lyra bribed the dockmaster.", "Seen."]);
  });

  it("reads what happened for the recap: what was filed, the clues ticked by when, and no reveals yet", () => {
    const { session } = boardSession();
    const [first, second] = sectionOf(session, "checklist").items;
    store.tickPrepItem(session.id, second!.id, true);
    store.tickPrepItem(session.id, first!.id, true);
    const line = store.logSessionLine(session.id, { text: "The tower door gave way." });
    store.createEntry({ playerText: "Filed elsewhere.", sessionId: null });
    const happened = sessionHappened(store, store.getSession(session.id)!);
    expect(happened.entries.map((entry) => entry.id)).toEqual([line.id]);
    expect(happened.cluesTicked.map((clue) => [clue.id, clue.sectionTitle])).toEqual([
      [second!.id, "Secrets and clues"],
      [first!.id, "Secrets and clues"]
    ]);
    expect(happened.reveals).toEqual([]);
  });
});

describe("party position", () => {
  const map = (name: string, revealedToPlayers = false) =>
    store.createMap({ assetId: crypto.randomUUID(), name, kind: "regional", revealedToPlayers });

  it("makes a party pin where there is none, revealed when its map is", () => {
    const shown = map("Barovia", true);
    const placed = store.placeParty({ mapId: shown.id, x: 120, y: 340 });
    expect(placed.created).toBe(true);
    expect(placed.marker).toMatchObject({
      mapId: shown.id,
      x: 120,
      y: 340,
      isParty: true,
      label: "The party",
      revealedToPlayers: true
    });
    expect(store.partyMarker()!.id).toBe(placed.marker.id);
    const hidden = map("Under Vallaki");
    store.deleteMarker(placed.marker.id);
    expect(store.placeParty({ mapId: hidden.id, x: 1, y: 1 }).marker.revealedToPlayers).toBe(false);
  });

  it("moves the one party pin across maps in one write, keeping how it looks and who sees it", () => {
    const world = map("The world", true);
    const city = map("Vallaki", true);
    const pin = store.createMarker(world.id, { x: 5, y: 5, iconId: "flag", iconColor: "#2DE2FF", label: "Us" });
    store.setPartyMarker(pin.id);
    const before = store.revision;
    const moved = store.placeParty({ mapId: city.id, x: 50, y: 60 });
    expect(store.revision).toBe(before + 1);
    expect(moved).toMatchObject({
      created: false,
      marker: { id: pin.id, mapId: city.id, x: 50, y: 60, iconId: "flag", label: "Us", revealedToPlayers: false }
    });
    expect(store.listMarkers(world.id)).toEqual([]);
    expect(store.placeParty({ mapId: city.id, x: 1, y: 1, revealedToPlayers: true }).marker.revealedToPlayers).toBe(
      true
    );
    expect(() => store.placeParty({ mapId: crypto.randomUUID(), x: 1, y: 1 })).toThrow(CodexNotFoundError);
    expect(() => store.placeParty({ mapId: city.id, x: -1, y: 1 })).toThrow(CodexValidationError);
  });
});

describe("migration 5 and the backup", () => {
  it("turns a session's free-text prep into one Text section, and blank prep into none", async () => {
    const legacyDirectory = await mkdtemp(join(tmpdir(), "vtt-codex-prep-legacy-"));
    const path = join(legacyDirectory, "vtt.sqlite");
    try {
      // A Codex file as migration 3 left it, with two sessions written by the old store.
      const database = openDatabase(path);
      migrate(
        database,
        "codex",
        CODEX_MIGRATIONS.filter((migration) => migration.version <= 3),
        { path }
      );
      const insert = database.prepare(
        "INSERT INTO codex_sessions (id, session_number, real_date, attendees_json, prep_body, recap_body, revealed, status, tags_json, scene_ids_json, rev, created_at, updated_at) VALUES (?, ?, NULL, '[]', ?, '', 0, 'planned', '[]', '[]', 1, ?, ?)"
      );
      const written = crypto.randomUUID();
      const blank = crypto.randomUUID();
      const at = "2026-10-01T00:00:00.000Z";
      insert.run(written, 1, "The ambush waits in [[Vallaki]].\nIreena is the target.", at, at);
      insert.run(blank, 2, "  \n", at, at);
      database
        .prepare("INSERT INTO codex_search_gm (kind, record_id, title, body) VALUES ('session', ?, 'Session 1', ?)")
        .run(written, "The ambush waits in [[Vallaki]].\nIreena is the target.");
      database.close();

      const upgraded = new CodexStore(path);
      await upgraded.initialize();
      try {
        const session = upgraded.getSession(written)!;
        expect(session.prep).toEqual([
          {
            id: expect.any(String),
            templateSectionId: null,
            title: "Prep notes",
            prompt: null,
            type: "text",
            text: "The ambush waits in [[Vallaki]].\nIreena is the target."
          }
        ]);
        expect(session).toMatchObject({ prepTemplateId: null, currentSceneId: null });
        expect(upgraded.getSession(blank)!.prep).toEqual([]);
        // The text is the same, so the search row it already had still finds it.
        expect(upgraded.searchAll("gm", "Ireena").hits).toEqual([{ kind: "session", id: written }]);
        expect(upgraded.listPrepTemplates().defaultTemplateId).toBe(BUILT_IN_TEMPLATE_ID);
      } finally {
        upgraded.close();
      }
      const raw = openDatabase(path);
      const columns = (raw.prepare("PRAGMA table_info(codex_sessions)").all() as Array<{ name: string }>).map(
        (column) => column.name
      );
      raw.close();
      expect(columns).not.toContain("prep_body");
      expect(columns).toEqual(expect.arrayContaining(["prep_json", "prep_template_id", "current_scene_id"]));
    } finally {
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });

  it("carries templates, the default and every prep section through a backup, ticks and their times included", () => {
    const heist = store.createPrepTemplate({ name: "Heist", sections: [{ title: "Clues", type: "checklist" }] });
    store.setDefaultPrepTemplate(heist.id);
    const session = store.createSession({});
    const item = store.updateSession(
      session.id,
      { prep: [{ ...session.prep[0]!, items: [{ text: "The guard drinks." }] } as never] },
      undefined
    );
    const ticked = store.tickPrepItem(session.id, sectionOf(item, "checklist").items[0]!.id, true);
    const bundle = store.exportBundle();

    store.createPrepTemplate({ name: "Gone after restore" });
    store.importBundle(JSON.parse(JSON.stringify(bundle)));
    expect(store.listPrepTemplates().templates.map((template) => template.name)).toEqual([
      "Starting template",
      "Heist"
    ]);
    expect(store.listPrepTemplates().defaultTemplateId).toBe(heist.id);
    const restored = store.getSession(session.id)!;
    expect(restored.prep).toEqual(ticked.prep);
    expect(restored.prepTemplateId).toBe(heist.id);
  });

  it("restores an older backup's free-text prep as one Text section, as the migration does", () => {
    const bundle = store.exportBundle() as unknown as Record<string, unknown>;
    const sessionId = crypto.randomUUID();
    const older = {
      ...bundle,
      sessions: [
        {
          id: sessionId,
          sessionNumber: 3,
          attendees: [],
          prepBody: "Strahd waits at the gate.",
          recapBody: "",
          revealedToPlayers: false,
          status: "planned",
          tags: [],
          sceneIds: [],
          rev: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    };
    delete (older as Record<string, unknown>).prepTemplates;
    delete (older as Record<string, unknown>).defaultPrepTemplateId;
    store.importBundle(older);
    expect(prepNotesOf(store.getSession(sessionId)!)).toBe("Strahd waits at the gate.");
    expect(store.getSession(sessionId)!.prep[0]!.title).toBe("Prep notes");
  });
});
