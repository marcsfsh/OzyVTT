import { useEffect, useState } from "react";
import { jsonRequest } from "../lib/api";
import { operationRows } from "../integrations/api-rows";
import type { OpenApiDocument } from "../integrations/openapi-model";
import { codexApi } from "../codex/api";

export type ListFacts = Readonly<{
  /** How many operations the server answers, from its OpenAPI document. */
  operations: number | null;
  /** Whether the Codex autosaves. */
  autosave: boolean | null;
  /** How many earlier versions the Codex keeps. */
  versions: number | null;
}>;

const NONE: ListFacts = { operations: null, autosave: null, versions: null };

/**
 * The counts Settings' side list shows beside API and the Codex's tools (I leftovers spec 2.6), read once through the
 * routes the reference and the Codex already read. A failed read leaves its count off.
 */
export function useListFacts(gmToken: string | null): ListFacts {
  const [facts, setFacts] = useState<ListFacts>(NONE);
  useEffect(() => {
    if (!gmToken) return;
    let live = true;
    jsonRequest<OpenApiDocument>("/api/v1/openapi.json")
      .then((document) => live && setFacts((prev) => ({ ...prev, operations: operationRows(document).length })))
      .catch(() => undefined);
    codexApi
      .getSettings(gmToken)
      .then(
        (settings) =>
          live &&
          setFacts((prev) => ({
            ...prev,
            autosave: settings.autosave.enabled,
            versions: settings.revisionHistory.versionCount
          }))
      )
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [gmToken]);
  return facts;
}
