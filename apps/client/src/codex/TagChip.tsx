/** A tag chip: a button when given `onPick`, otherwise a plain span, so nothing looks clickable that isn't. */
export function TagChip({ tag, onPick }: Readonly<{ tag: string; onPick?: (tag: string) => void }>) {
  if (!onPick) return <span className="codex-hit-tag">#{tag}</span>;
  return (
    <button type="button" className="codex-hit-tag codex-hit-tag--pick tap-target" onClick={() => onPick(tag)}>
      #{tag}
    </button>
  );
}
