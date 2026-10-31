import { Crumb } from "@vtt/ui";
import { pathForSection } from "../routes";

/** The crumb on a quest's title line (theme rule 14): back to Quests. */
export function QuestsCrumb({ go }: Readonly<{ go: (path: string) => void }>) {
  return <Crumb label="Quests" href={pathForSection("quests")} onClick={() => go(pathForSection("quests"))} />;
}
