/**
 * D10 — **a tag is one thing, and it looks and behaves like one thing.**
 *
 * "Clicking a tag anywhere opens a cross-type tag view" was true on some surfaces and not others, and
 * the two were drawn differently as well: a session's tags were clickable buttons in its editor and
 * inert `#tag` spans on its own list row, one line apart in the same feature. A reader cannot learn a
 * rule that holds half the time.
 *
 * One component, two states, and the state is decided by the DATA rather than by the surface: given an
 * `onPick` it is a button, and without one it is a span. A surface that has no tag view to open (the
 * player's pin sheet before it had a route, a static summary) renders the same chip, unclickable, so
 * nothing looks like a control that is not one.
 */
export function TagChip({ tag, onPick }: Readonly<{ tag: string; onPick?: (tag: string) => void }>) {
  if (!onPick) return <span className="codex-hit-tag">#{tag}</span>;
  return (
    <button type="button" className="codex-hit-tag codex-hit-tag--pick tap-target" onClick={() => onPick(tag)}>
      #{tag}
    </button>
  );
}
