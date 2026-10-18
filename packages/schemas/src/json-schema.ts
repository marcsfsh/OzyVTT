import { z } from "zod";
import { ActorDefinitionSchema } from "./index.js";

/** Closes every object that doesn't say otherwise: Zod drops an unknown key silently, so an author's typo would
 *  vanish on import; the published schema reports it instead. */
function closeObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closeObjects);
  if (!node || typeof node !== "object") return node;
  const out = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, closeObjects(value)]));
  if (out.type === "object" && "properties" in out && !("additionalProperties" in out))
    out.additionalProperties = false;
  return out;
}

/**
 * The published JSON Schema of an actor definition (`packages/schemas/json/actor-definition.v1.schema.json`),
 * generated from `ActorDefinitionSchema` so the two can't drift. `npm run map` writes it; a test fails when the
 * committed file is stale. Input mode, because authors write the input: fields with defaults are optional there.
 */
export function renderActorDefinitionJsonSchema(): string {
  const generated = z.toJSONSchema(ActorDefinitionSchema, { io: "input", reused: "ref", unrepresentable: "any" });
  // The document's own description below replaces the schema's.
  const { $schema: dialect, description: _described, ...body } = generated;
  const document = {
    $schema: dialect,
    $id: "https://vtt.local/schemas/actor-definition.v1.schema.json",
    title: "VTT actor definition v1",
    description:
      "Generated from the Zod ActorDefinitionSchema (packages/schemas/src/index.ts) by `npm run map`; do not edit by hand. Stricter than the app on one point: unknown keys are errors here, where the app drops them.",
    ...body
  };
  return `${JSON.stringify(closeObjects(document), null, 2)}\n`;
}
