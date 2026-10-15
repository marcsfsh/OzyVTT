/** How a token's health shows on the map; the table default and a token's own override offer the same four. */
export type HealthStyle = "band" | "bar" | "ring" | "aura";

const STYLES: ReadonlyArray<{ value: HealthStyle; label: string; phrase: string }> = [
  { value: "band", label: "Status badge", phrase: "a status badge" },
  { value: "bar", label: "HP bar", phrase: "an HP bar" },
  { value: "ring", label: "Health ring", phrase: "a health ring" },
  { value: "aura", label: "Health aura", phrase: "a health aura" }
];

/** "a status badge", for a confirmation line. */
export const healthStylePhrase = (style: HealthStyle) => STYLES.find((entry) => entry.value === style)?.phrase ?? style;

export function HealthStyleOptions() {
  return (
    <>
      {STYLES.map((entry) => (
        <option key={entry.value} value={entry.value}>
          {entry.label}
        </option>
      ))}
    </>
  );
}

/** Who sees a bar, ring or aura; the status badge is everyone's. */
export function HealthAudienceOptions() {
  return (
    <>
      <option value="gm">GM only</option>
      <option value="all">Shown to players</option>
    </>
  );
}
