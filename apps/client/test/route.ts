import { replaceQuery } from "../src/router";

/**
 * Put the test at an address. D3 made every Codex surface route-driven, so a component test that
 * renders `CodexShell` must say which section it means — the same way a browser does.
 *
 * **Not a synthetic `popstate`.** `replaceState` fires no popstate in a real browser, and the router now
 * treats a popstate as a real history traversal a dirty editor is allowed to veto (D6). A fake one here
 * would ask a mounted autosave-off editor for permission before the test could even start, and a refused
 * answer would push the address back underneath it — so the helper adopts the address through the
 * router's own "rewrite in place, no history entry" path instead. A test that means *Back* calls
 * `window.history.back()`, which jsdom implements for real.
 */
export function goTo(path: string): void {
  window.history.replaceState(null, "", path);
  replaceQuery(() => {});
}
