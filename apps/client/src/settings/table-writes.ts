import type { BuilderAbilityMethod, GmView } from "@vtt/domain";
import { useToast } from "@vtt/ui";
import { command, type CommandEvent, type CommandPayload } from "../lib/command";

export type BuilderChange = Partial<{
  allowedAbilityMethods: readonly BuilderAbilityMethod[];
  customFormula: string | null;
  maxLevel: number;
  playerBuilder: "open" | "gm-only";
  hitPointRollFloor: "none" | "average";
  playerRandom: "open" | "gm-only";
}>;

/**
 * The writes a GM's Settings section sends. Every one is the same shape: send, and say so only when it fails. The
 * builder policy's other fields ride along because `builder:set-policy` requires `allowedAbilityMethods` and keeps
 * omitted keys.
 */
export function useTableWrites(state: GmView) {
  const { toast } = useToast();
  const send = async <E extends CommandEvent>(event: E, payload: CommandPayload<E>, failure: string) => {
    const result = await command(event, payload);
    if (!result.ok) toast(result.message ?? failure, { tone: "error" });
  };
  const builder = state.builderPolicy;
  const setBuilderPolicy = (change: BuilderChange) =>
    send(
      "builder:set-policy",
      {
        allowedAbilityMethods: builder.allowedAbilityMethods,
        customFormula: builder.customFormula,
        maxLevel: builder.maxLevel,
        playerBuilder: builder.playerBuilder,
        ...change
      },
      "That builder setting was rejected."
    );
  return { send, setBuilderPolicy, toast };
}
