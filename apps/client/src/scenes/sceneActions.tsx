import type { MutationResult, Scene } from "@vtt/domain";
import { useToast } from "@vtt/ui";
import { useConfirm, usePrompt } from "../components/feedback";
import { command } from "../lib/command";

/**
 * What can be done to a scene from its row or its page: make it live, rename, duplicate, move it in the GM's order,
 * and delete it. Each sends one command and says why when the server refuses. Render `dialogs` once.
 */
export function useSceneActions(
  scenes: readonly Scene[],
  options: Readonly<{
    combatActive: boolean;
    onDeleted?: (encounterId: string) => void;
    onDuplicated?: (encounterId: string) => void;
  }>
) {
  const { confirm, dialog } = useConfirm();
  const { prompt, dialog: promptDialog } = usePrompt();
  const { toast } = useToast();
  const report = (failure: string) => (result: MutationResult) => {
    if (!result.ok) toast(result.message ?? failure, { tone: "error" });
    return result.ok;
  };

  /** Players and the shared screen switch at once, so a fight in progress is parked first and the GM is asked. */
  const makeLive = async (scene: Scene): Promise<boolean> => {
    if (
      options.combatActive &&
      !(await confirm({
        title: "Make encounter live?",
        body: `Make "${scene.name}" live? Players and the shared screen switch now. The current encounter is parked and resumes when you switch back.`,
        confirmLabel: "Make live"
      }))
    )
      return false;
    return command("encounter:activate", { encounterId: scene.id }).then(
      report("The encounter could not be switched.")
    );
  };
  const rename = async (scene: Scene) => {
    const next = await prompt({ title: "Rename encounter", defaultValue: scene.name, confirmLabel: "Rename" });
    if (next && next.trim() && next !== scene.name)
      void command("encounter:rename", { encounterId: scene.id, name: next.trim().slice(0, 120) }).then(
        report("The encounter could not be renamed.")
      );
  };
  const duplicate = (scene: Scene) =>
    void command("encounter:duplicate", { encounterId: scene.id }).then((result) => {
      if (report("The encounter could not be duplicated.")(result) && result.encounterId)
        options.onDuplicated?.(result.encounterId);
    });
  // Permanent, so it is "Delete" and says so.
  const remove = async (scene: Scene) => {
    if (
      await confirm({
        title: "Delete encounter?",
        body: `Delete "${scene.name}"? Its staged tokens, fog, walls and lights go with it. This cannot be undone.`,
        confirmLabel: "Delete",
        danger: true
      })
    )
      void command("encounter:remove", { encounterId: scene.id }).then((result) => {
        if (report("The encounter could not be removed.")(result)) options.onDeleted?.(scene.id);
      });
  };
  /** The whole order goes up, which the server checks is every scene once. */
  const reorder = (order: readonly string[]) =>
    void command("encounter:reorder", { order: [...order] }).then(report("The encounters could not be reordered."));
  const move = (encounterId: string, delta: -1 | 1) => {
    const order = scenes.map((scene) => scene.id);
    const index = order.indexOf(encounterId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    reorder(order);
  };
  return {
    makeLive,
    rename,
    duplicate,
    remove,
    move,
    reorder,
    dialogs: (
      <>
        {dialog}
        {promptDialog}
      </>
    )
  };
}
