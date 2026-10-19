import { CommandRejectedError } from "../game-store.js";
import type { DefinitionAction, ResolveContext } from "./context.js";

type EffectOption = NonNullable<DefinitionAction["effectOptions"]>[number];

/** The effect a use picks among its action's options (Enlarge/Reduce: Enlarge or Reduce): the one named, else the
 *  first. Undefined for an action with no options. */
export function chosenEffectOption(ctx: Pick<ResolveContext, "action" | "input">): EffectOption | undefined {
  const options = ctx.action.effectOptions;
  if (!options) return undefined;
  if (ctx.input.option === undefined) return options[0];
  const picked = options.find((option) => option.id === ctx.input.option);
  if (!picked)
    throw new CommandRejectedError(
      `${ctx.action.name} offers ${options.map((option) => option.name).join(" or ")}. Choose one of them.`
    );
  return picked;
}
