/** One complete wizard-made record of each type goes through the server: POSTed as the save path sends it,
    published through the real four-tier gate, and read back field for field. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOMEBREW_PATHS } from "@vtt/api-contract";
import { bootHomebrewApi, comparableBody, firstDifference, type ApiFixture } from "../api-parity-harness";
import { publishVerdict, storedBody } from "../authoring-harness";
import type { HomebrewType } from "../types";
import { WIZARD_RECORDS } from "./wizard-records";

const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };
const PROBE = "hb-wizard-probe";

describe("a wizard-made record round-trips through the server's validation", () => {
  let api: ApiFixture;
  beforeAll(async () => {
    api = await bootHomebrewApi();
  });
  afterAll(async () => {
    await api.close();
  });

  for (const type of Object.keys(WIZARD_RECORDS) as HomebrewType[]) {
    it(`${type}: POST, publish, GET, and the stored record is the wizard's`, async () => {
      const draft = WIZARD_RECORDS[type]();
      const verdict = publishVerdict(type, draft, PROBE);
      expect(verdict.why, `${type} client checklist`).toBe("");

      const created = await fetch(`${api.base}${HOMEBREW_PATHS.content}`, {
        method: "POST",
        headers: GM,
        body: JSON.stringify({ record: { type, ...storedBody(type, draft, PROBE) } })
      });
      expect(created.status, `${type} create: ${await created.clone().text()}`).toBe(201);
      const { id } = (await created.json()).data.record as { id: string };

      const published = await fetch(`${api.base}${HOMEBREW_PATHS.contentById.replace("{id}", id)}/publish`, {
        method: "POST",
        headers: GM
      });
      expect(published.status, `${type} publish: ${await published.clone().text()}`).toBe(200);

      const fetched = await fetch(`${api.base}${HOMEBREW_PATHS.contentById.replace("{id}", id)}`, { headers: GM });
      const stored = (await fetched.json()).data.record.record as Record<string, unknown>;
      const sent = storedBody(type, draft, id) as Record<string, unknown>;
      const difference = firstDifference(comparableBody(type, stored), comparableBody(type, sent));
      expect(
        difference,
        difference
          ? `${type} differs at ${difference.path}: server ${JSON.stringify(difference.api)}, wizard ${JSON.stringify(difference.editor)}`
          : ""
      ).toBeNull();
    });
  }
});
