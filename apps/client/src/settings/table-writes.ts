import { useContext } from "react";
import type { BuilderAbilityMethod, GmView } from "@vtt/domain";
import { useToast } from "@vtt/ui";
import { command, type CommandEvent, type CommandPayload } from "../lib/command";
import { SavedFlashContext } from "./SettingRow";

export type BuilderChange = Partial<{
  allowedAbilityMethods: readonly BuilderAbilityMethod[];
  customFormula: string | null;
  maxLevel: number;
  playerBuilder: "open" | "gm-only";
  hitPointRollFloor: "none" | "average";
  playerRandom: "open" | "gm-only";
}>;

/**
 * The writes a GM's Settings section sends. Every one is the same shape: send, flash Saved on the row it came from
 * when it lands, and say why when it fails; the control then shows the state as it is. The
 * builder policy's other fields ride along because `builder:set-policy` requires `allowedAbilityMethods` and keeps
 * omitted keys.
 */
export function useTableWrites(state: GmView) {
  const { toast } = useToast();
  const flash = useContext(SavedFlashContext);
  const send = async <E extends CommandEvent>(event: E, payload: CommandPayload<E>, failure: string) => {
    const result = await command(event, payload);
    if (!result.ok) toast(result.message ?? failure, { tone: "error" });
    else flash?.flashLast();
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
