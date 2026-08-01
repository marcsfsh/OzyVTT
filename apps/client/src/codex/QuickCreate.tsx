import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Modal, Select } from "@vtt/ui";
import { codexApi, type CodexPage } from "./api";
import { ENTITY_DEFS, ENTITY_TYPE_LIST, type EntityType } from "./entities";
import { newId } from "../lib/ids";

/**
 * D7 — **one quick-create, everywhere.**
 *
 * Seven doors used to create a page seven ways: a template menu, three untyped `createPage` calls, a
 * folder menu item, a pin's "new page", and — worst — clicking an unresolved `[[link]]`, which silently
 * created an untyped page with no dialog at all. All seven now open this: name + kind, one step.
 *
 * A page can therefore no longer start life untyped **by accident**. "Note" is still a kind, and still
 * the default; it is now a choice rather than a consequence of which button you happened to press.
 */

/**
 * The per-kind prose scaffold. These were the template menu's payloads; they move here so a Character
 * created from a pin inspector gets the same "## Description / ## Secrets & hooks" a Character created
 * from the rail does.
 */
const SCAFFOLDS: Readonly<Record<EntityType, Readonly<{ player: string; gm: string }>>> = {
  note: { player: "", gm: "" },
  character: { player: "## Description\n", gm: "## Secrets & hooks\n" },
  location: { player: "## Description\n\n## Points of interest\n", gm: "## Secrets\n\n## Encounters\n" },
  faction: { player: "## Overview\n", gm: "## True agenda\n\n## Assets & allies\n" },
  item: { player: "## Description\n", gm: "## Secrets\n" },
  religion: { player: "## Tenets\n", gm: "## Secrets\n" },
  species: { player: "## Description\n\n## Habitat\n", gm: "## Secrets\n" },
  event: { player: "## What happened\n", gm: "## The truth\n" }
};

/** What opened the dialog, and what it prefills. `null` means the dialog is closed. */
export type QuickCreateRequest = Readonly<{
  /** Prefilled name — a palette query, a pin's label, the text inside an unresolved `[[link]]`. */
  title?: string;
  entityType?: EntityType;
  folder?: string | null;
  /** Shown above the form when the launch context needs explaining (the unresolved-link door). */
  note?: string;
  /** Ran with the new page once it exists, before navigation — e.g. linking it to the pin that made it. */
  onCreated?: (page: CodexPage) => void | Promise<void>;
}>;

export type QuickCreateProps = Readonly<{
  gmToken: string;
  request: QuickCreateRequest;
  onClose: () => void;
  /** Navigates to the new page. The caller owns the address, so this component knows no routes. */
  onOpen: (pageId: string) => void;
  /** Refresh the page list so the new page appears in the rail before the editor mounts. */
  onChanged: () => Promise<void> | void;
}>;

export function QuickCreate({ gmToken, request, onClose, onOpen, onChanged }: QuickCreateProps) {
  const [title, setTitle] = useState(request.title ?? "");
  const [entityType, setEntityType] = useState<EntityType>(request.entityType ?? "note");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A second launch with a different prefill must re-seed the fields; the dialog is mounted once.
  useEffect(() => { setTitle(request.title ?? ""); setEntityType(request.entityType ?? "note"); setError(null); }, [request]);

  const create = async () => {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true); setError(null);
    try {
      const scaffold = SCAFFOLDS[entityType];
      const page = await codexApi.createPage(gmToken, {
        title: name, entityType,
        ...(request.folder ? { folder: request.folder } : {}),
        playerBody: scaffold.player, gmBody: scaffold.gm,
        // D19: a create is exactly the write worth an idempotency key — this button is double-tappable
        // on a phone, and a retry after a flaky connection must not leave two pages behind.
        commandId: newId()
      });
      await request.onCreated?.(page);
      await onChanged();
      onClose();
      onOpen(page.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Couldn't create the page.");
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="New page"
      ariaLabel="New page"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!title.trim() || busy} onClick={() => void create()}>Create</Button>
      </>}
    >
      {request.note && <p className="codex-composer-hint">{request.note}</p>}
      <Field label="Name" htmlFor="codex-quickcreate-name">
        <Input id="codex-quickcreate-name" value={title} autoFocus placeholder="Name the page"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void create(); } }} />
      </Field>
      <Field label="Kind" htmlFor="codex-quickcreate-kind" help="The kind determines which fields appear. You can change it later.">
        <Select id="codex-quickcreate-kind" value={entityType} onChange={(event) => setEntityType(event.target.value as EntityType)}>
          {ENTITY_TYPE_LIST.map((type) => <option key={type} value={type}>{ENTITY_DEFS[type].label}</option>)}
        </Select>
      </Field>
      {request.folder && <p className="codex-composer-hint">Filed in <strong>{request.folder}</strong>.</p>}
      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
  );
}
