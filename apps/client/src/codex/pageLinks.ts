import { useCallback } from "react";
import { navigate } from "../router";
import type { QuickCreateRequest } from "./QuickCreate";
import { pagePath } from "./routes";

/**
 * Where a `[[link]]` in a GM editor leads: the page of that title, or quick-create with the title filled in when no
 * page has it. Cancelling quick-create makes nothing. The page, quest and session editors share it.
 */
export function usePageLinks(
  pages: ReadonlyArray<Readonly<{ id: string; title: string }>>,
  onQuickCreate: (request: QuickCreateRequest) => void
): (target: string) => void {
  return useCallback(
    (target: string) => {
      const bare = target.replace(/^(page|actor|monster|spell|map|marker):/i, "").trim();
      const existing = pages.find((page) => page.title.trim().toLowerCase() === bare.toLowerCase());
      if (existing) {
        navigate(pagePath(existing.id));
        return;
      }
      onQuickCreate({
        title: bare,
        note: "This link doesn't match a page yet. Create it, or cancel and fix the link."
      });
    },
    [pages, onQuickCreate]
  );
}
