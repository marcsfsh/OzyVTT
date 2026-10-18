/**
 * The preview is the page. Every card the Compendium draws as the GM writes (the Card tab, the pinned preview, the
 * phone's preview) is built in the browser from the draft, while players, the builder and the sheet get the server's
 * catalog summary of the published record. Both go through the same components, so the card is the page only if the
 * two summaries are the same. This holds them to each other, kind by kind, on a complete record of each.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import type { ContentCompendiumKind } from "@vtt/domain";
import { ContentLibrary } from "../../../server/src/content-library.js";
import { compendiumEntryOf } from "../../../server/src/homebrew-player.js";
import { HomebrewStore } from "../../../server/src/homebrew-store.js";
import { forStorage } from "../homebrew/defaults";
import { WIZARD_RECORDS } from "../homebrew/wizard/wizard-records";
import { StatBlock } from "../encounter/StatBlock";
import { cardOfBody } from "./CompendiumCard";

const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

async function served(kind: ContentCompendiumKind, body: Readonly<Record<string, unknown>>) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-preview-parity-"));
  directories.push(directory);
  const store = new HomebrewStore(join(directory, "vtt.sqlite"));
  await store.initialize();
  const row = store.create({ type: kind, body: forStorage(body) as never });
  store.setState(row.id, "published", undefined);
  const entry = compendiumEntryOf(new ContentLibrary(store).forAudience("gm"), kind, row.id);
  store.close();
  return { id: row.id, entry };
}

const KINDS: readonly ContentCompendiumKind[] = [
  "spell",
  "equipment",
  "class",
  "subclass",
  "species",
  "background",
  "feat"
];

describe("a Compendium card is the page people meet", () => {
  it.each(KINDS)("%s: the card drawn from the draft is the server's summary of the published record", async (kind) => {
    // One body for both, so the ids a complete record mints match.
    const body = WIZARD_RECORDS[kind]();
    const { id, entry } = await served(kind, body);
    expect(entry, "the published record reaches the GM's catalog").not.toBeNull();
    const server = (entry!.rows as ReadonlyArray<Record<string, unknown>>)[0];
    const card = cardOfBody(kind, { ...forStorage(body), id }, id);
    expect("row" in card ? card.row : null).toEqual(server);
  });
});

describe("a monster's preview is the bestiary's stat block", () => {
  it("prints the draft as the bestiary prints the published creature", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-preview-parity-"));
    directories.push(directory);
    const store = new HomebrewStore(join(directory, "vtt.sqlite"));
    await store.initialize();
    const body = WIZARD_RECORDS.monster();
    const row = store.create({ type: "monster", body: forStorage(body) as never });
    store.setState(row.id, "published", undefined);
    const definition = new ContentLibrary(store).forAudience("gm").monster(row.id);
    store.close();
    expect(definition, "the published creature reaches the bestiary").toBeTruthy();
    const page = renderToStaticMarkup(createElement(StatBlock, { monster: definition as never }));
    const preview = renderToStaticMarkup(createElement(StatBlock, { monster: { ...forStorage(body), id: row.id } }));
    expect(preview).toBe(page);
  });
});
